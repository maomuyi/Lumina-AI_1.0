/**
 * refine.ts — POST /api/refine
 *
 * 多轮微调路由（轻量 SSE 流式响应）。
 * 前端只发 session_id + new_intent，后端从 Redis 取图和数据，
 * 调用 Text-only LLM（不传图），速度快 3~5x。
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { createHash } from 'node:crypto';
import { streamTextRefine, streamVisionAnalysis } from '../services/llm.js';
import { buildRefinePrompt } from '../services/prompt.js';
import {
    compareSessionRevisionAndFingerprint,
    getSession,
    updateSession,
} from '../services/session.js';
import { safeParseAIResponse } from '../utils/parseAI.js';
import { clampLightroomParams } from '../utils/clampParams.js';
import { generateXMP } from '../services/xmp.js';
import { writeXmpFile } from '../services/xmpFiles.js';
import { enrichDiagnosticReport } from '../services/reportEnhancer.js';
import { createRedisRateLimitStore, hitRateLimit } from '../services/rate-limit.js';
import { validateRefineBody } from '../utils/requestValidation.js';
import {
    prepareVisionImageSource,
    type PreparedVisionImageSource,
} from '../services/vision-source.js';
import { writeVisionPreviewFile } from '../services/visionPreviewFiles.js';

const refineRateLimitStore = createRedisRateLimitStore();
const REFINE_RATE_LIMIT_MAX = parseInt(process.env.REFINE_RATE_LIMIT_MAX || '40', 10);
const REFINE_RATE_LIMIT_WINDOW_SECONDS = parseInt(
    process.env.REFINE_RATE_LIMIT_WINDOW_SECONDS || '300',
    10
);

export async function refineRoutes(fastify: FastifyInstance) {
    fastify.post('/api/refine', async (request: FastifyRequest, reply: FastifyReply) => {
        const rateLimit = await hitRateLimit(
            refineRateLimitStore,
            'refine',
            request.ip,
            REFINE_RATE_LIMIT_MAX,
            REFINE_RATE_LIMIT_WINDOW_SECONDS
        );
        if (!rateLimit.allowed) {
            return reply
                .status(429)
                .header('Retry-After', String(rateLimit.retryAfterSeconds))
                .send({
                    error: `Refine rate limit exceeded. Retry in ${rateLimit.retryAfterSeconds}s.`,
                });
        }

        let body: {
            session_id: string;
            revision: number;
            image_fingerprint: string;
            new_intent: string;
        };
        try {
            if (request.isMultipart()) {
                const parts = request.parts();
                let previewImageBuffer: Buffer | null = null;
                let sessionId = '';
                let revision = '';
                let imageFingerprint = '';
                let newIntent = '';

                for await (const part of parts) {
                    if (part.type === 'file' && part.fieldname === 'preview_image') {
                        const chunks: Buffer[] = [];
                        for await (const chunk of part.file) {
                            chunks.push(chunk);
                        }
                        previewImageBuffer = Buffer.concat(chunks);
                    } else if (part.type === 'field') {
                        const value = part.value as string;
                        if (part.fieldname === 'session_id') sessionId = value;
                        if (part.fieldname === 'revision') revision = value;
                        if (part.fieldname === 'image_fingerprint') imageFingerprint = value;
                        if (part.fieldname === 'new_intent') newIntent = value;
                    }
                }

                body = validateRefineBody({
                    session_id: sessionId,
                    revision,
                    image_fingerprint: imageFingerprint,
                    new_intent: newIntent,
                });

                if (previewImageBuffer) {
                    const previewFingerprint = createHash('sha256')
                        .update(previewImageBuffer)
                        .digest('hex');
                    if (previewFingerprint !== body.image_fingerprint) {
                        return reply.status(409).send({
                            error: 'Refine image_fingerprint does not match preview_image',
                        });
                    }
                }

                const session = await getSession(body.session_id);
                if (!session) {
                    return reply.status(404).send({
                        error: 'Session expired or not found. Please re-upload and analyze.',
                    });
                }

                const matchResult = compareSessionRevisionAndFingerprint(session, {
                    revision: body.revision,
                    imageFingerprint: body.image_fingerprint,
                });
                if (matchResult === 'revision_conflict') {
                    return reply.status(409).send({
                        error: 'Refine revision conflict. Please refresh the latest analysis state.',
                    });
                }
                if (matchResult === 'fingerprint_mismatch') {
                    return reply.status(409).send({
                        error: 'Refine image_fingerprint mismatch. Please analyze the current image again.',
                    });
                }

                return runRefineFlow(request, reply, {
                    body,
                    session,
                    previewImageBuffer,
                });
            }

            body = validateRefineBody(request.body);
        } catch (err) {
            return reply.status(400).send({
                error: 'Invalid refine request',
                details: err instanceof Error ? err.message : String(err),
            });
        }

        const session = await getSession(body.session_id);
        if (!session) {
            return reply.status(404).send({
                error: 'Session expired or not found. Please re-upload and analyze.',
            });
        }

        const matchResult = compareSessionRevisionAndFingerprint(session, {
            revision: body.revision,
            imageFingerprint: body.image_fingerprint,
        });
        if (matchResult === 'revision_conflict') {
            return reply.status(409).send({
                error: 'Refine revision conflict. Please refresh the latest analysis state.',
            });
        }
        if (matchResult === 'fingerprint_mismatch') {
            return reply.status(409).send({
                error: 'Refine image_fingerprint mismatch. Please analyze the current image again.',
            });
        }

        return runRefineFlow(request, reply, {
            body,
            session,
            previewImageBuffer: null,
        });
    });
}

async function runRefineFlow(
    _request: FastifyRequest,
    reply: FastifyReply,
    input: {
        body: {
            session_id: string;
            revision: number;
            image_fingerprint: string;
            new_intent: string;
        };
        session: Awaited<ReturnType<typeof getSession>> extends infer T ? Exclude<T, null> : never;
        previewImageBuffer: Buffer | null;
    }
) {
    const { body, session, previewImageBuffer } = input;
    let preparedVisionSource: PreparedVisionImageSource | null = null;

    if (previewImageBuffer) {
        try {
            preparedVisionSource = prepareVisionImageSource({
                configuredMode: process.env.LLM_VISION_INPUT_MODE || 'auto',
                baseUrl: process.env.OPENAI_BASE_URL,
                publicBaseUrl: process.env.PUBLIC_API_BASE_URL,
                previewBuffer: previewImageBuffer,
                createPreviewResource: writeVisionPreviewFile,
            });
        } catch (err) {
            return reply.status(422).send({
                error: err instanceof Error ? err.message : 'Failed to prepare vision input',
            });
        }
    }

        reply.raw.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
            'X-Accel-Buffering': 'no',
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

    try {
        await new Promise<void>((resolve) => {
            let firstTokenReceived = false;
            sendProgress(35, 'llm_started', '已提交微调任务，AI 正在重新计算参数...');

            const streamPromise = preparedVisionSource
                ? streamVisionAnalysis(userPrompt, preparedVisionSource.imageUrl, {
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

                            const xmpContent = generateXMP(clamped);
                            const { downloadUrl } = writeXmpFile(xmpContent);
                            const updatedSession = await updateSession(body.session_id, {
                                lastLrParams: clamped,
                                lastReport: enrichedReport,
                                intent: body.new_intent,
                            });
                            if (!updatedSession) {
                                sendSSE({
                                    type: 'error',
                                    message:
                                        'Refine revision conflict detected during save. Please refresh and retry.',
                                });
                                reply.raw.end();
                                resolve();
                                return;
                            }

                            sendProgress(95, 'xmp_ready', '新 XMP 已生成，准备返回结果...');
                            sendSSE({
                                type: 'final',
                                session_id: body.session_id,
                                revision: updatedSession.revision,
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
                })
                : streamTextRefine(userPrompt, {
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

                            const xmpContent = generateXMP(clamped);
                            const { downloadUrl } = writeXmpFile(xmpContent);
                            const updatedSession = await updateSession(body.session_id, {
                                lastLrParams: clamped,
                                lastReport: enrichedReport,
                                intent: body.new_intent,
                            });
                            if (!updatedSession) {
                                sendSSE({
                                    type: 'error',
                                    message:
                                        'Refine revision conflict detected during save. Please refresh and retry.',
                                });
                                reply.raw.end();
                                resolve();
                                return;
                            }

                            sendProgress(95, 'xmp_ready', '新 XMP 已生成，准备返回结果...');
                            sendSSE({
                                type: 'final',
                                session_id: body.session_id,
                                revision: updatedSession.revision,
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
                });

            streamPromise.catch((err) => {
                sendSSE({
                    type: 'error',
                    message: err instanceof Error ? err.message : 'Refine stream failed before completion',
                });
                reply.raw.end();
                resolve();
            });
        });
    } finally {
        await preparedVisionSource?.cleanup();
    }
}
