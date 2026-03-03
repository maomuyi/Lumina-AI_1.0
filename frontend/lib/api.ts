/**
 * api.ts — 后端 API 通信层
 *
 * 封装 SSE 流式 fetch 和普通 JSON 请求。
 * 所有与后端的通信都通过此模块，前端其他代码不直接使用 fetch。
 */

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

// ─── SSE 事件类型 ─────────────────────────────────────────────────────
export interface SSETextEvent {
    type: 'text';
    content: string;
}

export interface SSEFinalEvent {
    type: 'final';
    session_id?: string;
    diagnostic_report: {
        module_1_diagnosis: string;
        module_2_physics: string;
        module_3_strategy: string;
        module_4_core_actions: string[];
    };
    lightroom_params: Record<string, number | number[]>;
    download_url: string;
}

export interface SSEErrorEvent {
    type: 'error';
    message: string;
}

export type SSEEvent = SSETextEvent | SSEFinalEvent | SSEErrorEvent;

// ─── SSE 回调 ──────────────────────────────────────────────────────────
export interface SSECallbacks {
    onText?: (text: string) => void;
    onFinal?: (data: SSEFinalEvent) => void;
    onError?: (message: string) => void;
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
                        } else if (event.type === 'final') {
                            callbacks.onFinal?.(event as SSEFinalEvent);
                        } else if (event.type === 'error') {
                            callbacks.onError?.(event.message);
                        }
                    } catch {
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
    callbacks: SSECallbacks
): Promise<void> {
    const formData = new FormData();
    formData.append('preview_image', previewBlob, 'preview.jpg');
    formData.append('raw_data', JSON.stringify(rawData));
    formData.append('user_intent', userIntent);
    formData.append('style', style);

    const response = await fetch(`${API_BASE}/api/analyze`, {
        method: 'POST',
        body: formData,
    });

    if (!response.ok) {
        const err = await response.text();
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
export async function refineWithSSE(
    sessionId: string,
    newIntent: string,
    callbacks: SSECallbacks
): Promise<void> {
    const response = await fetch(`${API_BASE}/api/refine`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: sessionId, new_intent: newIntent }),
    });

    if (!response.ok) {
        const err = await response.text();
        throw new Error(`Refine API failed: ${response.status} ${err}`);
    }

    await consumeSSEStream(response, callbacks);
}

/**
 * POST /api/xmp — 根据当前参数生成新的 XMP 下载链接
 */
export async function generateXmp(
    lightroomParams: Record<string, number | number[]>
): Promise<{ download_url: string }> {
    const response = await fetch(`${API_BASE}/api/xmp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lightroom_params: lightroomParams }),
    });

    if (!response.ok) {
        const err = await response.text();
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
