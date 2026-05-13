/**
 * llm.ts — LLM API 调用层
 *
 * 支持 SSE 流式输出：
 * - diagnostic_report 文字部分流式推给前端
 * - lightroom_params JSON 等完整后一次性返回
 *
 * 模型分层调度：
 * - 第 1 轮：Vision-LLM（传图）
 * - 第 2+ 轮：风格/审美微调优先 Vision-LLM，未配置时降级 Text/本地规则
 */

import OpenAI from 'openai';
import { SYSTEM_PROMPT } from './prompt.js';

const LLM_MAX_OUTPUT_TOKENS = parseInt(process.env.LLM_MAX_OUTPUT_TOKENS || '2048', 10);
const LLM_PRIMARY_TIMEOUT_MS = parseInt(process.env.LLM_PRIMARY_TIMEOUT_MS || '120000', 10);
const LLM_FALLBACK_TIMEOUT_MS = parseInt(process.env.LLM_FALLBACK_TIMEOUT_MS || '90000', 10);
const LLM_PRIMARY_RETRY_COUNT = Math.max(0, parseInt(process.env.LLM_PRIMARY_RETRY_COUNT || '1', 10));
const DEFAULT_TEXT_BASE_URL = 'https://api.deepseek.com';
const DEFAULT_VISION_BASE_URL = 'https://api.openai.com/v1';
const DEFAULT_TEXT_MODEL = 'deepseek-v4-flash';
const DEFAULT_VISION_MODEL = 'gpt-5-2025-08-07';

type LLMChannel = 'text' | 'vision';

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

function cleanEnv(name: string): string {
    return (process.env[name] || '').trim();
}

function isConfiguredSecret(value: string): boolean {
    if (!value) return false;
    return ![
        'sk-your-key-here',
        'your-text-api-key-here',
        'your-vision-api-key-here',
        'your-deepseek-api-key-here',
        'your-openai-vision-api-key-here',
    ].includes(value);
}

function getApiKey(channel: LLMChannel): string {
    return cleanEnv(channel === 'text' ? 'TEXT_API_KEY' : 'VISION_API_KEY');
}

function getBaseURL(channel: LLMChannel): string {
    if (channel === 'text') return cleanEnv('TEXT_BASE_URL') || DEFAULT_TEXT_BASE_URL;
    return cleanEnv('VISION_BASE_URL') || DEFAULT_VISION_BASE_URL;
}

function getModel(channel: LLMChannel): string {
    if (channel === 'text') {
        return cleanEnv('TEXT_MODEL') || cleanEnv('LLM_TEXT_MODEL') || DEFAULT_TEXT_MODEL;
    }
    return cleanEnv('VISION_MODEL') || cleanEnv('LLM_VISION_MODEL') || DEFAULT_VISION_MODEL;
}

function shouldDisableThinking(model: string): boolean {
    return /^deepseek-v4/i.test(model) && cleanEnv('TEXT_ENABLE_THINKING') !== 'true';
}

function maybeAddTextModelOptions(
    model: string,
    body: Record<string, unknown>
): Record<string, unknown> {
    if (!shouldDisableThinking(model)) return body;
    return {
        ...body,
        thinking: {
            type: 'disabled',
        },
    };
}

function createClient(channel: LLMChannel): OpenAI {
    return new OpenAI({
        apiKey: getApiKey(channel),
        baseURL: getBaseURL(channel),
    });
}

export function isTextLLMConfigured(): boolean {
    return isConfiguredSecret(getApiKey('text'));
}

export function isVisionLLMConfigured(): boolean {
    return isConfiguredSecret(getApiKey('vision'));
}

function assertChannelConfigured(channel: LLMChannel): void {
    const envName = channel === 'text' ? 'TEXT_API_KEY' : 'VISION_API_KEY';
    const label = channel === 'text' ? 'Text-only LLM' : 'Vision LLM';
    if (!isConfiguredSecret(getApiKey(channel))) {
        throw new Error(`${label} is not configured. Please set ${envName} in backend/.env.`);
    }
}


/**
 * 把 Buffer 或已编码 base64 字符串统一变成 base64 字符串。
 * 关键点：Buffer 路径直接 toString，避免外层提前持有 67MB 字符串。
 */
function asBase64(input: Buffer | string): string {
    return typeof input === 'string' ? input : input.toString('base64');
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
    client: OpenAI,
    model: string,
    userPrompt: string,
    previewImage: Buffer | string,
    callbacks: StreamCallbacks,
    signal: AbortSignal
): Promise<string> {
    const stream = await client.chat.completions.create({
        model,
        stream: true,
        max_tokens: LLM_MAX_OUTPUT_TOKENS,
        temperature: 0.3,
        messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            {
                role: 'user',
                content: [
                    {
                        type: 'image_url',
                        image_url: {
                            url: `data:image/jpeg;base64,${asBase64(previewImage)}`,
                            detail: 'high',
                        },
                    },
                    { type: 'text', text: userPrompt },
                ],
            },
        ],
    }, { signal });

    let fullText = '';
    for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta?.content;
        if (delta) {
            fullText += delta;
            callbacks.onTextChunk(delta);
        }
    }

    if (!fullText.trim()) {
        throw new Error('Vision stream path returned empty content');
    }
    return fullText;
}

async function completeVisionViaResponses(
    client: OpenAI,
    model: string,
    userPrompt: string,
    previewImage: Buffer | string,
    signal: AbortSignal
): Promise<string> {
    const response = await client.responses.create({
        model,
        temperature: 0.3,
        max_output_tokens: LLM_MAX_OUTPUT_TOKENS,
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
                        image_url: `data:image/jpeg;base64,${asBase64(previewImage)}`,
                    },
                    {
                        type: 'input_text',
                        text: userPrompt,
                    },
                ],
            },
        ],
    } as never, { signal });

    const text = extractResponsesText(response);
    if (!text.trim()) {
        throw new Error('Vision fallback path returned empty content');
    }
    return text;
}

async function streamTextViaChatCompletions(
    client: OpenAI,
    model: string,
    userPrompt: string,
    callbacks: StreamCallbacks,
    signal: AbortSignal
): Promise<string> {
    const requestBody = maybeAddTextModelOptions(model, {
        model,
        stream: true,
        max_tokens: LLM_MAX_OUTPUT_TOKENS,
        temperature: 0.3,
        messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: userPrompt },
        ],
    });
    const stream = await client.chat.completions.create(requestBody as unknown as Parameters<typeof client.chat.completions.create>[0] & { stream: true }, { signal });

    let fullText = '';
    for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta?.content;
        if (delta) {
            fullText += delta;
            callbacks.onTextChunk(delta);
        }
    }

    if (!fullText.trim()) {
        throw new Error('Text stream path returned empty content');
    }
    return fullText;
}

async function completeTextViaResponses(
    client: OpenAI,
    model: string,
    userPrompt: string,
    signal: AbortSignal
): Promise<string> {
    const response = await client.responses.create({
        model,
        temperature: 0.3,
        max_output_tokens: LLM_MAX_OUTPUT_TOKENS,
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
    } as never, { signal });

    const text = extractResponsesText(response);
    if (!text.trim()) {
        throw new Error('Text fallback path returned empty content');
    }
    return text;
}

async function withTimeout<T>(
    timeoutMs: number,
    label: string,
    fn: (signal: AbortSignal) => Promise<T>
): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        return await fn(controller.signal);
    } catch (err) {
        if (controller.signal.aborted) {
            throw new Error(`${label} timed out after ${timeoutMs}ms`);
        }
        throw err;
    } finally {
        clearTimeout(timer);
    }
}

async function runWithFallback(
    primary: (signal: AbortSignal) => Promise<string>,
    fallback: (signal: AbortSignal) => Promise<string>,
    callbacks: StreamCallbacks,
    purpose: string
): Promise<void> {
    let primaryMessage = '';
    for (let attempt = 0; attempt <= LLM_PRIMARY_RETRY_COUNT; attempt += 1) {
        try {
            const fullText = await withTimeout(
                LLM_PRIMARY_TIMEOUT_MS,
                `${purpose} primary attempt ${attempt + 1}`,
                primary
            );
            callbacks.onComplete(fullText);
            return;
        } catch (primaryErr) {
            primaryMessage = toErrorMessage(primaryErr);
            console.warn(
                `[LLM] ${purpose} primary attempt ${attempt + 1} failed: ${primaryMessage}`
            );
            if (attempt < LLM_PRIMARY_RETRY_COUNT) {
                console.warn(`[LLM] ${purpose} retrying primary path...`);
            }
        }
    }

    try {
        const fullText = await withTimeout(LLM_FALLBACK_TIMEOUT_MS, `${purpose} fallback`, fallback);
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

/**
 * 流式调用 Vision-LLM（首轮分析，传图 + 物理数据）
 */
export async function streamVisionAnalysis(
    userPrompt: string,
    previewImage: Buffer | string,
    callbacks: StreamCallbacks
): Promise<void> {
    try {
        assertChannelConfigured('vision');
    } catch (err) {
        callbacks.onError(err instanceof Error ? err : new Error(String(err)));
        return;
    }
    const client = createClient('vision');
    const model = getModel('vision');
    const preferResponsesPrimary = /^gpt-5/i.test(model);

    if (preferResponsesPrimary) {
        await runWithFallback(
            async (signal) => {
                const fullText = await completeVisionViaResponses(client, model, userPrompt, previewImage, signal);
                callbacks.onTextChunk(fullText);
                return fullText;
            },
            (signal) => streamVisionViaChatCompletions(client, model, userPrompt, previewImage, callbacks, signal),
            callbacks,
            'Vision analysis'
        );
        return;
    }

    await runWithFallback(
        (signal) => streamVisionViaChatCompletions(client, model, userPrompt, previewImage, callbacks, signal),
        (signal) => completeVisionViaResponses(client, model, userPrompt, previewImage, signal),
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
    try {
        assertChannelConfigured('text');
    } catch (err) {
        callbacks.onError(err instanceof Error ? err : new Error(String(err)));
        return;
    }
    const client = createClient('text');
    const model = getModel('text');
    const preferResponsesPrimary = /^gpt-5/i.test(model);

    if (preferResponsesPrimary) {
        await runWithFallback(
            async (signal) => {
                const fullText = await completeTextViaResponses(client, model, userPrompt, signal);
                callbacks.onTextChunk(fullText);
                return fullText;
            },
            (signal) => streamTextViaChatCompletions(client, model, userPrompt, callbacks, signal),
            callbacks,
            'Text refine'
        );
        return;
    }

    await runWithFallback(
        (signal) => streamTextViaChatCompletions(client, model, userPrompt, callbacks, signal),
        (signal) => completeTextViaResponses(client, model, userPrompt, signal),
        callbacks,
        'Text refine'
    );
}

/**
 * 流式调用 Vision-LLM（多轮风格微调，复用 session 缓存的预览图）
 */
export async function streamVisionRefine(
    userPrompt: string,
    previewImage: Buffer | string,
    callbacks: StreamCallbacks
): Promise<void> {
    try {
        assertChannelConfigured('vision');
    } catch (err) {
        callbacks.onError(err instanceof Error ? err : new Error(String(err)));
        return;
    }
    const client = createClient('vision');
    const model = getModel('vision');
    const preferResponsesPrimary = /^gpt-5/i.test(model);

    if (preferResponsesPrimary) {
        await runWithFallback(
            async (signal) => {
                const fullText = await completeVisionViaResponses(client, model, userPrompt, previewImage, signal);
                callbacks.onTextChunk(fullText);
                return fullText;
            },
            (signal) => streamVisionViaChatCompletions(client, model, userPrompt, previewImage, callbacks, signal),
            callbacks,
            'Vision refine'
        );
        return;
    }

    await runWithFallback(
        (signal) => streamVisionViaChatCompletions(client, model, userPrompt, previewImage, callbacks, signal),
        (signal) => completeVisionViaResponses(client, model, userPrompt, previewImage, signal),
        callbacks,
        'Vision refine'
    );
}
