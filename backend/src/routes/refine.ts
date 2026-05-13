/**
 * refine.ts — POST /api/refine
 *
 * 多轮微调路由（SSE 流式响应）。
 * 前端只发 session_id + new_intent，后端从 Session 复用预览图和 RAW/JPG 数据。
 * 优先图文混合微调；未配置 Vision 时降级文本/本地规则。
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { isTextLLMConfigured, isVisionLLMConfigured, streamTextRefine, streamVisionRefine } from '../services/llm.js';
import { buildRefinePrompt } from '../services/prompt.js';
import { getSession, updateSession } from '../services/session.js';
import { safeParseAIResponse } from '../utils/parseAI.js';
import type { LLMResponse } from '../utils/parseAI.js';
import { clampLightroomParams } from '../utils/clampParams.js';
import { generateXMP } from '../services/xmp.js';
import { writeXmpFile } from '../services/xmpFiles.js';
import { enrichDiagnosticReport } from '../services/reportEnhancer.js';
import { buildLocalRefine, detectScene, getSceneChips } from '../services/localAnalyzer.js';
import { shouldSearchStyleContext } from '../services/styleIntent.js';
import { searchStyleContext } from '../services/styleSearch.js';
import { enhanceParamsForStyleIntent } from '../services/styleParamEnhancer.js';
import { resolveStyleIntentProfile } from '../services/styleProfiles.js';
import {
    buildAssistantSummary,
    buildChangedParams,
    buildReportSummary,
} from '../services/refineChanges.js';

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

        const styleProfile = resolveStyleIntentProfile(body.new_intent);
        const canUseVisionRefine = isVisionLLMConfigured();
        const canUseTextRefine = isTextLLMConfigured();

        const finalizeRefine = async (result: LLMResponse) => {
            sendProgress(85, 'parsing', '正在校验参数并生成新的 XMP...');
            const styleEnhancedParams = enhanceParamsForStyleIntent(
                result.lightroom_params,
                body.new_intent,
                styleProfile?.label ?? '',
                session.rawData,
                session.lastLrParams
            );
            const clamped = clampLightroomParams(styleEnhancedParams);
            const enrichedReport = enrichDiagnosticReport(
                result.diagnostic_report,
                session.rawData,
                clamped
            );

            const xmpContent = generateXMP(clamped);
            const { downloadUrl } = writeXmpFile(xmpContent);
            const changedParams = buildChangedParams(
                session.lastLrParams,
                clamped,
                enrichedReport
            );
            const assistantSummary = buildAssistantSummary(body.new_intent, changedParams);
            const reportSummary = buildReportSummary(enrichedReport, assistantSummary);
            const sceneLabel = detectScene(session.rawData, body.new_intent, 'auto');

            await updateSession(body.session_id, {
                lastLrParams: clamped,
                round: session.round + 1,
            });

            sendProgress(95, 'xmp_ready', '新 XMP 已生成，准备返回结果...');
            sendSSE({
                type: 'final',
                session_id: body.session_id,
                assistant_summary: assistantSummary,
                changed_params: changedParams,
                report_summary: reportSummary,
                scene_label: sceneLabel,
                quick_chips: getSceneChips(sceneLabel),
                diagnostic_report: enrichedReport,
                lightroom_params: clamped,
                download_url: downloadUrl,
            });
        };

        sendProgress(20, 'prompt_ready', '正在根据你的新意图重组参数策略...');

        if (!canUseVisionRefine && !canUseTextRefine) {
            try {
                sendProgress(35, 'local_rules_started', '未配置图文/文本 API，正在使用本地风格微调规则引擎...');
                const localResult = buildLocalRefine(
                    session.lastLrParams,
                    session.rawData,
                    body.new_intent
                );
                sendSSE({
                    type: 'text',
                    content: '本地微调引擎已沿用首轮物理数据和上一轮参数，正在按新意图重新计算 XMP。',
                });
                sendProgress(70, 'local_rules_ready', '本地微调建议已生成，正在写入 XMP...');
                await finalizeRefine(localResult);
            } catch (err) {
                sendSSE({
                    type: 'error',
                    message: err instanceof Error ? err.message : 'Local refine failed',
                });
            }
            reply.raw.end();
            return;
        }

        let styleContext = null;
        if (shouldSearchStyleContext(body.new_intent)) {
            try {
                sendProgress(26, 'style_search_started', '检测到风格化意图，正在检索实时风格参考...');
                styleContext = await searchStyleContext(body.new_intent);
                if (styleContext) {
                    sendProgress(32, 'style_search_ready', '已整理联网风格参考，将作为微调倾向输入。');
                } else {
                    sendProgress(32, 'style_search_skipped', '未配置或未命中联网检索，继续使用本地风格库与底片安全规则。');
                }
            } catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                console.warn(`[Style Search] skipped: ${message}`);
                sendProgress(32, 'style_search_skipped', '联网风格检索暂不可用，继续使用本地风格库与底片安全规则。');
            }
        } else {
            sendProgress(26, 'style_search_skipped', '本轮为局部参数微调，无需联网风格检索。');
        }

        // ── 构建 Prompt（上轮参数 + 摘要 + 本地风格 profile + 可选联网参考） ─────────
        const userPrompt = buildRefinePrompt(
            session.lastLrParams,
            body.new_intent,
            session.rawDataSummary,
            styleContext,
            styleProfile,
            canUseVisionRefine
        );

        // ── 流式调用图文/文本 LLM ──────────────────────────────────────────
        await new Promise<void>((resolve) => {
            let firstTokenReceived = false;
            sendProgress(
                35,
                canUseVisionRefine ? 'vision_refine_started' : 'llm_started',
                canUseVisionRefine
                    ? '已提交图文混合微调任务，AI 正在重新观察图片并计算参数...'
                    : '已提交文本微调任务，AI 正在重新计算参数...'
            );
            const callbacks = {
                onTextChunk(text: string) {
                    if (!firstTokenReceived) {
                        firstTokenReceived = true;
                        sendProgress(65, 'llm_first_token', '模型开始返回微调建议，正在整理中...');
                    }
                    sendSSE({ type: 'text', content: text });
                },

                async onComplete(fullText: string) {
                    try {
                        if (!firstTokenReceived) {
                            sendProgress(65, 'llm_buffer_ready', '模型已返回完整微调结果，正在整理中...');
                        }
                        const parsed = safeParseAIResponse(fullText);
                        await finalizeRefine(parsed);
                    } catch (err) {
                        sendSSE({
                            type: 'error',
                            message: err instanceof Error ? err.message : 'Refine failed',
                        });
                    }

                    reply.raw.end();
                    resolve();
                },

                onError(error: Error) {
                    sendSSE({ type: 'error', message: error.message });
                    reply.raw.end();
                    resolve();
                },
            };

            const runner = canUseVisionRefine
                ? streamVisionRefine(userPrompt, session.previewImageBase64, callbacks)
                : streamTextRefine(userPrompt, callbacks);

            runner.catch((err) => {
                sendSSE({
                    type: 'error',
                    message: err instanceof Error ? err.message : 'Refine stream failed before completion',
                });
                reply.raw.end();
                resolve();
            });
        });
    });
}
