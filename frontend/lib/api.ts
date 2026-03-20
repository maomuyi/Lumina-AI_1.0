/**
 * api.ts — 后端 API 通信层
 *
 * 封装 SSE 流式 fetch 和普通 JSON 请求。
 * 所有与后端的通信都通过此模块，前端其他代码不直接使用 fetch。
 */

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

interface ApiErrorPayload {
    error?: string;
    details?: string;
}

// ─── SSE 事件类型 ─────────────────────────────────────────────────────
export interface SSETextEvent {
    type: 'text';
    content: string;
}

export interface SSEFinalEvent {
    type: 'final';
    session_id?: string;
    revision?: number;
    diagnostic_report: {
        module_1_diagnosis: string;
        module_2_physics: string;
        module_3_strategy: string;
        module_4_core_actions: string[];
    };
    lightroom_params: Record<string, number | number[]>;
    download_url: string;
}

export interface SSEProgressEvent {
    type: 'progress';
    stage: string;
    message: string;
    progress: number;
}

export interface SSEErrorEvent {
    type: 'error';
    message: string;
}

export type SSEEvent = SSETextEvent | SSEFinalEvent | SSEProgressEvent | SSEErrorEvent;

// ─── SSE 回调 ──────────────────────────────────────────────────────────
export interface SSECallbacks {
    onText?: (text: string) => void;
    onProgress?: (data: SSEProgressEvent) => void;
    onFinal?: (data: SSEFinalEvent) => void;
    onError?: (message: string) => void;
}

async function readApiError(response: Response): Promise<string> {
    const contentType = response.headers.get("content-type") || ""

    if (contentType.includes("application/json")) {
        try {
            const payload = (await response.json()) as ApiErrorPayload
            const parts = [payload.error, payload.details].filter(Boolean)
            if (parts.length > 0) return parts.join(": ")
        } catch {
            // fall through to text parsing
        }
    }

    const text = await response.text()
    return text.trim() || response.statusText || "Unknown API error"
}

export function isPublicVisionUrlRequirementError(message: string): boolean {
    return message.includes("publicly reachable image URL") || message.includes("PUBLIC_API_BASE_URL")
}

export function isRateLimitError(message: string): boolean {
    return message.toLowerCase().includes("rate limit")
}

export async function computeImageFingerprint(blob: Blob): Promise<string> {
    const buffer = await blob.arrayBuffer()
    const digest = await crypto.subtle.digest("SHA-256", buffer)
    return Array.from(new Uint8Array(digest))
        .map((byte) => byte.toString(16).padStart(2, "0"))
        .join("")
}

/**
 * 解析 SSE 流（text/event-stream），逐行 dispatch 事件。
 */
async function consumeSSEStream(
    response: Response,
    callbacks: SSECallbacks
): Promise<void> {
    const reader = response.body?.getReader();
    if (!reader) throw new Error('Response body is not readable');

    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // SSE 格式：每条消息以 \n\n 分隔
        const lines = buffer.split('\n\n');
        buffer = lines.pop() || ''; // 最后一段可能不完整，留在 buffer

        for (const block of lines) {
            for (const line of block.split('\n')) {
                if (line.startsWith('data: ')) {
                    try {
                        const event = JSON.parse(line.slice(6)) as SSEEvent;
                        if (event.type === 'text') {
                            callbacks.onText?.(event.content);
                        } else if (event.type === 'progress') {
                            callbacks.onProgress?.(event as SSEProgressEvent);
                        } else if (event.type === 'final') {
                            callbacks.onFinal?.(event as SSEFinalEvent);
                        } else if (event.type === 'error') {
                            callbacks.onError?.(event.message);
                            throw new Error(event.message);
                        }
                    } catch (error) {
                        if (error instanceof Error && error.message) {
                            throw error;
                        }
                        // JSON 解析失败，跳过
                    }
                }
            }
        }
    }
}

/**
 * POST /api/analyze — 首次分析（SSE 流式）
 *
 * @param previewBlob  WASM 提取的内嵌 JPEG Blob
 * @param rawData      WASM 提取的物理数据 JSON
 * @param userIntent   用户自然语言意图
 * @param style        风格预设
 * @param callbacks    SSE 事件回调
 */
export async function analyzeWithSSE(
    previewBlob: Blob,
    rawData: object,
    userIntent: string,
    style: string,
    imageFingerprint: string,
    callbacks: SSECallbacks
): Promise<void> {
    const formData = new FormData();
    formData.append('preview_image', previewBlob, 'preview.jpg');
    formData.append('raw_data', JSON.stringify(rawData));
    formData.append('user_intent', userIntent);
    formData.append('style', style);
    formData.append('image_fingerprint', imageFingerprint);

    const response = await fetch(`${API_BASE}/api/analyze`, {
        method: 'POST',
        body: formData,
    });

    if (!response.ok) {
        const err = await readApiError(response)
        if (response.status === 413) {
            throw new Error('Analyze API failed: 413 上传体积过大，请尝试更小尺寸图片或重新压缩后重试');
        }
        throw new Error(`Analyze API failed: ${response.status} ${err}`);
    }

    await consumeSSEStream(response, callbacks);
}

/**
 * POST /api/refine — 多轮微调（SSE 流式）
 *
 * @param sessionId   首轮 analyze 返回的 session_id
 * @param newIntent   用户新的微调意图
 * @param callbacks   SSE 事件回调
 */
export async function refineWithSSE(input: {
    sessionId: string
    revision: number
    imageFingerprint: string
    newIntent: string
    previewBlob: Blob
    rawData?: object
    callbacks: SSECallbacks
}): Promise<void> {
    const formData = new FormData()
    formData.append("preview_image", input.previewBlob, "preview.jpg")
    formData.append("session_id", input.sessionId)
    formData.append("revision", String(input.revision))
    formData.append("image_fingerprint", input.imageFingerprint)
    formData.append("new_intent", input.newIntent)
    if (input.rawData) {
        formData.append("raw_data", JSON.stringify(input.rawData))
    }

    const response = await fetch(`${API_BASE}/api/refine`, {
        method: 'POST',
        body: formData,
    });

    if (!response.ok) {
        const err = await readApiError(response)
        throw new Error(`Refine API failed: ${response.status} ${err}`);
    }

    await consumeSSEStream(response, input.callbacks);
}

/**
 * POST /api/xmp — 根据当前参数生成新的 XMP 下载链接
 */
export async function generateXmp(
    lightroomParams: Record<string, number | number[]>,
    options?: {
        sessionId?: string
        revision?: number
    }
): Promise<{ download_url: string }> {
    const response = await fetch(`${API_BASE}/api/xmp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            lightroom_params: lightroomParams,
            session_id: options?.sessionId,
            revision: options?.revision,
        }),
    });

    if (!response.ok) {
        const err = await readApiError(response)
        throw new Error(`Generate XMP failed: ${response.status} ${err}`);
    }

    return response.json() as Promise<{ download_url: string }>;
}

/**
 * 获取 XMP 下载完整 URL
 */
export function getDownloadUrl(path: string): string {
    if (path.startsWith('http')) return path;
    return `${API_BASE}${path}`;
}
