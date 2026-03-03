/**
 * llm.ts — LLM API 调用层
 *
 * 支持 SSE 流式输出：
 * - diagnostic_report 文字部分流式推给前端
 * - lightroom_params JSON 等完整后一次性返回
 *
 * 模型分层调度：
 * - 第 1 轮：Vision-LLM（传图）
 * - 第 2+ 轮：Text-only LLM（不传图，速度快 3~5x）
 */

import OpenAI from 'openai';
import { SYSTEM_PROMPT } from './prompt.js';

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY || '',
    baseURL: process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
});

export interface StreamCallbacks {
    /** 每收到一个文本 chunk 时触发（用于 SSE 推送给前端） */
    onTextChunk: (text: string) => void;
    /** 完整的 LLM 原始输出拼接完毕后触发 */
    onComplete: (fullText: string) => void;
    /** 发生错误时触发 */
    onError: (error: Error) => void;
}

function toErrorMessage(err: unknown): string {
    if (err instanceof Error) return err.message;
    return String(err);
}

function extractResponsesText(response: unknown): string {
    const r = response as {
        output_text?: string;
        output?: Array<{ content?: Array<{ text?: string }> }>;
    };

    if (typeof r.output_text === 'string' && r.output_text.trim()) {
        return r.output_text;
    }

    if (!Array.isArray(r.output)) return '';

    return r.output
        .flatMap((item) => (Array.isArray(item.content) ? item.content : []))
        .map((part) => (typeof part.text === 'string' ? part.text : ''))
        .join('');
}

async function streamVisionViaChatCompletions(
    model: string,
    userPrompt: string,
    previewImageBase64: string,
    callbacks: StreamCallbacks
): Promise<string> {
    const stream = await openai.chat.completions.create({
        model,
        stream: true,
        max_tokens: 4096,
        temperature: 0.3,
        messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            {
                role: 'user',
                content: [
                    {
                        type: 'image_url',
                        image_url: {
                            url: `data:image/jpeg;base64,${previewImageBase64}`,
                            detail: 'high',
                        },
                    },
                    { type: 'text', text: userPrompt },
                ],
            },
        ],
    });

    let fullText = '';
    for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta?.content;
        if (delta) {
            fullText += delta;
            callbacks.onTextChunk(delta);
        }
    }

    return fullText;
}

async function completeVisionViaResponses(
    model: string,
    userPrompt: string,
    previewImageBase64: string
): Promise<string> {
    const response = await openai.responses.create({
        model,
        temperature: 0.3,
        max_output_tokens: 4096,
        input: [
            {
                role: 'system',
                content: [{ type: 'input_text', text: SYSTEM_PROMPT }],
            },
            {
                role: 'user',
                content: [
                    {
                        type: 'input_image',
                        image_url: `data:image/jpeg;base64,${previewImageBase64}`,
                    },
                    {
                        type: 'input_text',
                        text: userPrompt,
                    },
                ],
            },
        ],
    } as never);

    return extractResponsesText(response);
}

async function streamTextViaChatCompletions(
    model: string,
    userPrompt: string,
    callbacks: StreamCallbacks
): Promise<string> {
    const stream = await openai.chat.completions.create({
        model,
        stream: true,
        max_tokens: 4096,
        temperature: 0.3,
        messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: userPrompt },
        ],
    });

    let fullText = '';
    for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta?.content;
        if (delta) {
            fullText += delta;
            callbacks.onTextChunk(delta);
        }
    }

    return fullText;
}

async function completeTextViaResponses(
    model: string,
    userPrompt: string
): Promise<string> {
    const response = await openai.responses.create({
        model,
        temperature: 0.3,
        max_output_tokens: 4096,
        input: [
            {
                role: 'system',
                content: [{ type: 'input_text', text: SYSTEM_PROMPT }],
            },
            {
                role: 'user',
                content: [{ type: 'input_text', text: userPrompt }],
            },
        ],
    } as never);

    return extractResponsesText(response);
}

async function runWithFallback(
    primary: () => Promise<string>,
    fallback: () => Promise<string>,
    callbacks: StreamCallbacks,
    purpose: string
): Promise<void> {
    try {
        const fullText = await primary();
        callbacks.onComplete(fullText);
        return;
    } catch (primaryErr) {
        const primaryMessage = toErrorMessage(primaryErr);
        console.warn(`[LLM] ${purpose} primary path failed: ${primaryMessage}`);

        try {
            const fullText = await fallback();
            if (fullText) {
                callbacks.onTextChunk(fullText);
            }
            callbacks.onComplete(fullText);
            return;
        } catch (fallbackErr) {
            const fallbackMessage = toErrorMessage(fallbackErr);
            callbacks.onError(
                new Error(
                    `${purpose} failed on both paths. primary="${primaryMessage}", fallback="${fallbackMessage}"`
                )
            );
        }
    }
}

/**
 * 流式调用 Vision-LLM（首轮分析，传图 + 物理数据）
 */
export async function streamVisionAnalysis(
    userPrompt: string,
    previewImageBase64: string,
    callbacks: StreamCallbacks
): Promise<void> {
    const model = process.env.LLM_VISION_MODEL || 'gpt-5-2025-08-07';
    await runWithFallback(
        () => streamVisionViaChatCompletions(model, userPrompt, previewImageBase64, callbacks),
        () => completeVisionViaResponses(model, userPrompt, previewImageBase64),
        callbacks,
        'Vision analysis'
    );
}

/**
 * 流式调用 Text-only LLM（多轮微调，不传图）
 */
export async function streamTextRefine(
    userPrompt: string,
    callbacks: StreamCallbacks
): Promise<void> {
    const model = process.env.LLM_TEXT_MODEL || 'gpt-5-2025-08-07';
    await runWithFallback(
        () => streamTextViaChatCompletions(model, userPrompt, callbacks),
        () => completeTextViaResponses(model, userPrompt),
        callbacks,
        'Text refine'
    );
}
