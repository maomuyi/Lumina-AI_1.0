/**
 * refine.ts — POST /api/refine
 *
 * 多轮微调路由（轻量 SSE 流式响应）。
 * 前端只发 session_id + new_intent，后端从 Redis 取图和数据，
 * 调用 Text-only LLM（不传图），速度快 3~5x。
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { streamTextRefine } from '../services/llm.js';
import { buildRefinePrompt } from '../services/prompt.js';
import { getSession, updateSession } from '../services/session.js';
import { safeParseAIResponse } from '../utils/parseAI.js';
import { clampLightroomParams } from '../utils/clampParams.js';
import { generateXMP } from '../services/xmp.js';
import { writeXmpFile } from '../services/xmpFiles.js';
import { enrichDiagnosticReport } from '../services/reportEnhancer.js';

interface RefineBody {
    session_id: string;
    new_intent: string;
}

export async function refineRoutes(fastify: FastifyInstance) {
    fastify.post('/api/refine', async (request: FastifyRequest, reply: FastifyReply) => {
        const body = request.body as RefineBody;

        if (!body?.session_id || !body?.new_intent) {
            return reply.status(400).send({
                error: 'Missing required fields: session_id and new_intent',
            });
        }

        // ── 从 Redis 取 Session ─────────────────────────────────────────────
        const session = await getSession(body.session_id);
        if (!session) {
            return reply.status(404).send({
                error: 'Session expired or not found. Please re-upload and analyze.',
            });
        }

        // ── SSE 响应头 ──────────────────────────────────────────────────────
        const requestOrigin = request.headers.origin;
        reply.raw.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
            'X-Accel-Buffering': 'no',
            ...(requestOrigin
                ? {
                    'Access-Control-Allow-Origin': requestOrigin,
                    'Access-Control-Allow-Credentials': 'true',
                    'Vary': 'Origin',
                }
                : {}),
        });

        const sendSSE = (data: Record<string, unknown>) => {
            reply.raw.write(`data: ${JSON.stringify(data)}\n\n`);
        };
        const sendProgress = (progress: number, stage: string, message: string) => {
            sendSSE({
                type: 'progress',
                progress: Math.max(0, Math.min(100, progress)),
                stage,
                message,
            });
        };

        // ── 构建 Prompt（不传图，只传上轮参数 + 摘要） ───────────────────────
        const userPrompt = buildRefinePrompt(
            session.lastLrParams,
            body.new_intent,
            session.rawDataSummary
        );
        sendProgress(20, 'prompt_ready', '正在根据你的新意图重组参数策略...');

        // ── 流式调用 Text-only LLM ──────────────────────────────────────────
        await new Promise<void>((resolve) => {
            let firstTokenReceived = false;
            sendProgress(35, 'llm_started', '已提交微调任务，AI 正在重新计算参数...');
            streamTextRefine(userPrompt, {
                onTextChunk(text) {
                    if (!firstTokenReceived) {
                        firstTokenReceived = true;
                        sendProgress(65, 'llm_first_token', '模型开始返回微调建议，正在整理中...');
                    }
                    sendSSE({ type: 'text', content: text });
                },

                async onComplete(fullText) {
                    try {
                        if (!firstTokenReceived) {
                            sendProgress(65, 'llm_buffer_ready', '模型已返回完整微调结果，正在整理中...');
                        }
                        sendProgress(85, 'parsing', '正在校验参数并生成新的 XMP...');
                        const parsed = safeParseAIResponse(fullText);
                        const clamped = clampLightroomParams(parsed.lightroom_params);
                        const enrichedReport = enrichDiagnosticReport(
                            parsed.diagnostic_report,
                            session.rawData,
                            clamped
                        );

                        // 生成新 XMP
                        const xmpContent = generateXMP(clamped);
                        const { downloadUrl } = writeXmpFile(xmpContent);

                        // 更新 Session
                        await updateSession(body.session_id, {
                            lastLrParams: clamped,
                            round: session.round + 1,
                        });

                        sendProgress(95, 'xmp_ready', '新 XMP 已生成，准备返回结果...');
                        sendSSE({
                            type: 'final',
                            session_id: body.session_id,
                            diagnostic_report: enrichedReport,
                            lightroom_params: clamped,
                            download_url: downloadUrl,
                        });
                    } catch (err) {
                        sendSSE({
                            type: 'error',
                            message: err instanceof Error ? err.message : 'Refine failed',
                        });
                    }

                    reply.raw.end();
                    resolve();
                },

                onError(error) {
                    sendSSE({ type: 'error', message: error.message });
                    reply.raw.end();
                    resolve();
                },
            }).catch((err) => {
                sendSSE({
                    type: 'error',
                    message: err instanceof Error ? err.message : 'Text stream failed before completion',
                });
                reply.raw.end();
                resolve();
            });
        });
    });
}
