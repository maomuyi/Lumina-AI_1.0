/**
 * analyze.ts — POST /api/analyze
 *
 * 首次分析路由（SSE 流式响应）。
 * 接收前端上传的 preview_image + raw_data + user_intent，
 * 调用 Vision-LLM 流式推理，生成 XMP 文件并返回下载链接。
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { streamVisionAnalysis } from '../services/llm.js';
import { buildFirstRoundPrompt, type RawDataForPrompt } from '../services/prompt.js';
import { createSession, summarizeRawData } from '../services/session.js';
import { safeParseAIResponse } from '../utils/parseAI.js';
import { clampLightroomParams } from '../utils/clampParams.js';
import { generateXMP } from '../services/xmp.js';
import { writeXmpFile } from '../services/xmpFiles.js';
import { enrichDiagnosticReport } from '../services/reportEnhancer.js';

const rawDataSchema = z.object({
    file_type: z.enum(['NEF', 'JPG']),
    exif: z.object({
        camera_model: z.string().optional(),
        iso: z.number().optional(),
        shutter: z.string().optional(),
        aperture: z.number().optional(),
        focal_length: z.number().optional(),
    }),
    sensor_physics: z.object({
        bit_depth: z.number().positive(),
        shadow_survival_rate: z.number().min(0).max(1),
        highlight_clipping_rate: z.number().min(0).max(1),
        raw_channel_multipliers: z.array(z.number()).optional(),
        banding_risk: z.string(),
        black_level: z.number().optional(),
        sensor_white_level: z.number().optional(),
    }),
    linear_histogram: z.array(z.number()).min(1),
    color_space: z.string().optional(),
    icc_profile: z.string().optional(),
}).passthrough();

export async function analyzeRoutes(fastify: FastifyInstance) {
    fastify.post('/api/analyze', async (request: FastifyRequest, reply: FastifyReply) => {
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
                const value = part.value as string;
                if (part.fieldname === 'raw_data') rawDataStr = value;
                if (part.fieldname === 'user_intent') userIntent = value;
                if (part.fieldname === 'style') style = value;
            }
        }

        if (!previewImageBase64 || !rawDataStr) {
            return reply.status(400).send({
                error: 'Missing required fields: preview_image and raw_data',
            });
        }

        let rawData: RawDataForPrompt;
        try {
            const parsedJson = JSON.parse(rawDataStr);
            rawData = rawDataSchema.parse(parsedJson) as unknown as RawDataForPrompt;
        } catch (err) {
            return reply.status(400).send({
                error: 'Invalid raw_data JSON schema',
                details: err instanceof Error ? err.message : String(err),
            });
        }

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

        sendProgress(6, 'upload_received', '已收到图片，正在读取底层数据...');
        sendProgress(11, 'dual_track_validated', '双轨校验通过：视觉轨与物理数据轨均已就绪。');

        const userPrompt = buildFirstRoundPrompt(rawData, userIntent, style);
        sendProgress(18, 'prompt_ready', '数据轨准备完成，正在组织分析提示...');

        await new Promise<void>((resolve) => {
            let firstTokenReceived = false;
            let heartbeatProgress = 30;
            sendProgress(30, 'llm_started', '已提交到 AI 模型，开始深度分析...');

            const heartbeat = setInterval(() => {
                if (firstTokenReceived) return;
                heartbeatProgress = Math.min(56, heartbeatProgress + 2);
                sendProgress(heartbeatProgress, 'llm_waiting', 'AI 正在推理中，这一步通常需要几十秒...');
            }, 5000);

            streamVisionAnalysis(userPrompt, previewImageBase64, {
                onTextChunk(text) {
                    if (!firstTokenReceived) {
                        firstTokenReceived = true;
                        sendProgress(64, 'llm_first_token', '模型开始返回内容，正在汇总建议...');
                    }
                    sendSSE({ type: 'text', content: text });
                },

                async onComplete(fullText) {
                    try {
                        clearInterval(heartbeat);
                        if (!firstTokenReceived) {
                            sendProgress(64, 'llm_buffer_ready', '模型已返回完整内容，正在整理结果...');
                        }
                        sendProgress(84, 'parsing', '正在校验参数并生成 XMP...');

                        const parsed = safeParseAIResponse(fullText);
                        const clamped = clampLightroomParams(parsed.lightroom_params);
                        const enrichedReport = enrichDiagnosticReport(
                            parsed.diagnostic_report,
                            rawData,
                            clamped
                        );

                        const xmpContent = generateXMP(clamped);
                        const { downloadUrl } = writeXmpFile(xmpContent);

                        const sessionId = await createSession({
                            previewImageBase64,
                            rawData,
                            lastLrParams: clamped,
                            rawDataSummary: summarizeRawData(rawData),
                        });

                        sendProgress(96, 'xmp_ready', 'XMP 已生成，准备返回结果...');
                        sendSSE({
                            type: 'final',
                            session_id: sessionId,
                            diagnostic_report: enrichedReport,
                            lightroom_params: clamped,
                            download_url: downloadUrl,
                        });
                    } catch (err) {
                        sendSSE({
                            type: 'error',
                            message: err instanceof Error ? err.message : 'XMP generation failed',
                        });
                    }

                    clearInterval(heartbeat);
                    reply.raw.end();
                    resolve();
                },

                onError(error) {
                    clearInterval(heartbeat);
                    sendSSE({ type: 'error', message: error.message });
                    reply.raw.end();
                    resolve();
                },
            });
        });
    });
}
