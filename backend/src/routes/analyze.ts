/**
 * analyze.ts — POST /api/analyze
 *
 * 首次分析路由（SSE 流式响应）。
 * 接收前端 WASM 解析的 preview_image + raw_data + user_intent，
 * 调用 Vision-LLM 流式推理，生成 XMP 文件，返回下载链接。
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { streamVisionAnalysis } from '../services/llm.js';
import { buildFirstRoundPrompt, type RawDataForPrompt } from '../services/prompt.js';
import { createSession, summarizeRawData } from '../services/session.js';
import { safeParseAIResponse } from '../utils/parseAI.js';
import { clampLightroomParams } from '../utils/clampParams.js';
import { generateXMP } from '../services/xmp.js';
import { writeXmpFile } from '../services/xmpFiles.js';

export async function analyzeRoutes(fastify: FastifyInstance) {
    fastify.post('/api/analyze', async (request: FastifyRequest, reply: FastifyReply) => {
        // ── 解析 multipart 请求 ────────────────────────────────────────────
        const parts = request.parts();
        let previewImageBase64 = '';
        let rawDataStr = '';
        let userIntent = '';
        let style = 'auto';

        for await (const part of parts) {
            if (part.type === 'file' && part.fieldname === 'preview_image') {
                const chunks: Buffer[] = [];
                for await (const chunk of part.file) {
                    chunks.push(chunk);
                }
                previewImageBase64 = Buffer.concat(chunks).toString('base64');
            } else if (part.type === 'field') {
                const val = part.value as string;
                if (part.fieldname === 'raw_data') rawDataStr = val;
                if (part.fieldname === 'user_intent') userIntent = val;
                if (part.fieldname === 'style') style = val;
            }
        }

        if (!previewImageBase64 || !rawDataStr) {
            return reply.status(400).send({
                error: 'Missing required fields: preview_image and raw_data',
            });
        }

        let rawData: RawDataForPrompt;
        try {
            rawData = JSON.parse(rawDataStr);
        } catch {
            return reply.status(400).send({ error: 'Invalid raw_data JSON' });
        }

        // ── 设置 SSE 响应头 ─────────────────────────────────────────────────
        reply.raw.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
            'X-Accel-Buffering': 'no', // Nginx 不缓冲
        });

        const sendSSE = (data: Record<string, unknown>) => {
            reply.raw.write(`data: ${JSON.stringify(data)}\n\n`);
        };

        // ── 构建 Prompt ──────────────────────────────────────────────────────
        const userPrompt = buildFirstRoundPrompt(rawData, userIntent, style);

        // ── 流式调用 Vision-LLM ──────────────────────────────────────────────
        await new Promise<void>((resolve) => {
            streamVisionAnalysis(userPrompt, previewImageBase64, {
                onTextChunk(text) {
                    sendSSE({ type: 'text', content: text });
                },

                async onComplete(fullText) {
                    try {
                        // ── 解析 LLM 输出 ────────────────────────────────────────
                        const parsed = safeParseAIResponse(fullText);
                        const clamped = clampLightroomParams(parsed.lightroom_params);

                        // ── 生成 XMP 文件 ─────────────────────────────────────────
                        const xmpContent = generateXMP(clamped);
                        const { downloadUrl } = writeXmpFile(xmpContent);

                        // ── 创建 Session ──────────────────────────────────────────
                        const sessionId = await createSession({
                            previewImageBase64,
                            rawData,
                            lastLrParams: clamped,
                            rawDataSummary: summarizeRawData(rawData),
                        });

                        // ── 发送最终结果 ───────────────────────────────────────────
                        sendSSE({
                            type: 'final',
                            session_id: sessionId,
                            diagnostic_report: parsed.diagnostic_report,
                            lightroom_params: clamped,
                            download_url: downloadUrl,
                        });
                    } catch (err) {
                        sendSSE({
                            type: 'error',
                            message: err instanceof Error ? err.message : 'XMP generation failed',
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
            });
        });
    });
}
