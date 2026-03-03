/**
 * raw-parser.worker.ts
 *
 * Web Worker：在独立线程中运行 LibRaw WASM，完全不阻塞主线程 UI。
 *
 * 主线程通过 postMessage 与本 Worker 通信：
 *
 * 发送给 Worker 的消息格式：
 *   { type: 'PARSE', buffer: ArrayBuffer }      ← 原始 RAW 文件的 ArrayBuffer
 *   { type: 'TERMINATE' }                        ← 主动销毁 Worker
 *
 * Worker 回传给主线程的消息格式：
 *   { type: 'PROGRESS', stage: string, pct: number }    ← 解析进度
 *   { type: 'DONE', result: RawAnalysisResult }         ← 完整解析结果
 *   { type: 'ERROR', message: string }                  ← 错误
 *
 * 使用示例（主线程）：
 *   const worker = new Worker(new URL('./raw-parser.worker.ts', import.meta.url));
 *   worker.postMessage({ type: 'PARSE', buffer: file.arrayBuffer() }, [buffer]);
 *   worker.onmessage = ({ data }) => { ... };
 */

// ─────────────────────────────────────────────────────────────────────────────
// 类型定义
// ─────────────────────────────────────────────────────────────────────────────

export interface ExifData {
    camera_make: string;
    camera_model: string;
    iso: number;
    shutter: string;
    aperture: number;
    focal_length: number;
    raw_bits: number;
    width: number;
    height: number;
}

export interface PhysicsData {
    sensor_white_level: number;
    black_level: number;
    actual_max_value: number;
    /** 高光物理溢出率，如 0.005 = 0.5% */
    highlight_clipping_rate: number;
    /** 暗部可救率，如 0.998 = 99.8% */
    shadow_survival_rate: number;
    /** RGGB 白平衡乘数，G 通道归一化为 1.0 */
    raw_channel_multipliers: [number, number, number, number];
    bit_depth: number;
    banding_risk: 'low' | 'medium' | 'high';
}

export interface LinearHistogram {
    bins: number;
    bit_depth: number;
    white_level: number;
    black_level: number;
    total_pixels: number;
    histogram: number[];
    percentiles: {
        /** 暗部安全截止点（归一化 0~1） */
        p2: number;
        /** 亮部安全截止点（归一化 0~1） */
        p98: number;
    };
}

/** lra_open_buffer 到 lra_close 一次完整解析的结果 */
export interface RawAnalysisResult {
    exif: ExifData;
    physics: PhysicsData;
    /** 64-bin 降采样直方图（发给 LLM，节省 Token） */
    histogram64: LinearHistogram;
    /** 256-bin 完整直方图（本地可视化用） */
    histogram256: LinearHistogram;
    /** 内嵌预览 JPEG 的 Blob URL（视觉轨） */
    previewObjectUrl: string | null;
}

// Emscripten 模块类型（最小化声明）
interface LibRawModuleType {
    ccall(name: string, returnType: string, argTypes: string[], args: unknown[]): unknown;
    cwrap(name: string, returnType: string, argTypes: string[]): (...args: unknown[]) => unknown;
    _malloc(size: number): number;
    _free(ptr: number): void;
    UTF8ToString(ptr: number): string;
    HEAPU8: Uint8Array;
}

declare function importScripts(...urls: string[]): void;
declare function LibRawModule(): Promise<LibRawModuleType>;

// ─────────────────────────────────────────────────────────────────────────────
// Worker 内部状态
// ─────────────────────────────────────────────────────────────────────────────
let mod: LibRawModuleType | null = null;

/** 发送进度消息给主线程 */
function progress(stage: string, pct: number) {
    self.postMessage({ type: 'PROGRESS', stage, pct });
}

/** WASM 模块懒加载（首次调用时初始化，之后复用） */
async function ensureModule(): Promise<LibRawModuleType> {
    if (mod) return mod;
    progress('正在加载 WASM 模块...', 0);
    // Workers 中用 importScripts 加载（Emscripten SINGLE_FILE=1 模式）
    try {
        importScripts('/wasm/raw_analyzer.js');
    } catch {
        throw new Error('未找到 /wasm/raw_analyzer.js，请先运行 frontend/wasm/build.sh 生成 WASM 产物。');
    }
    mod = await LibRawModule();
    return mod;
}

// ─────────────────────────────────────────────────────────────────────────────
// 核心解析函数
// ─────────────────────────────────────────────────────────────────────────────
async function parseRawBuffer(fileBuffer: ArrayBuffer): Promise<RawAnalysisResult> {
    const m = await ensureModule();

    // ── 步骤 1：将 JS ArrayBuffer 拷贝到 WASM 堆 ──────────────────────────────
    progress('正在将文件传入 WASM 堆...', 5);
    const bytes = new Uint8Array(fileBuffer);
    const ptr = m._malloc(bytes.byteLength);
    if (!ptr) throw new Error('WASM malloc failed: 内存不足，文件可能过大');
    m.HEAPU8.set(bytes, ptr);

    try {
        // ── 步骤 2：解析 RAW 文件（open + unpack + unpack_thumb）──────────────
        progress('正在本地解码 RAW 原生物理数据...', 10);
        const openBuffer = m.cwrap('lra_open_buffer', 'number', ['number', 'number']) as
            (ptr: number, size: number) => number;
        const ret = openBuffer(ptr, bytes.byteLength);
        if (ret !== 0) {
            throw new Error(`LibRaw 解析失败，错误码: ${ret}. 请确认文件格式为 NEF/CR2/ARW/DNG 等 RAW 格式。`);
        }

        // ── 步骤 3：读取 EXIF ─────────────────────────────────────────────────
        progress('正在提取 EXIF 元数据...', 30);
        const getExif = m.cwrap('lra_get_exif_json', 'number', []) as () => number;
        const exifPtr = getExif();
        const exif: ExifData = JSON.parse(m.UTF8ToString(exifPtr));

        // ── 步骤 4：计算 RAW 物理特征 ─────────────────────────────────────────
        progress('正在分析底层光影矩阵...', 45);
        const getPhysics = m.cwrap('lra_get_physics_json', 'number', []) as () => number;
        const physicsPtr = getPhysics();
        const physics: PhysicsData = JSON.parse(m.UTF8ToString(physicsPtr));

        // ── 步骤 5：构建线性直方图（64 + 256 bins） ───────────────────────────
        progress('正在计算 14-bit 线性直方图...', 60);
        const getHist = m.cwrap('lra_get_linear_histogram_json', 'number', ['number']) as
            (bins: number) => number;

        const hist64Ptr = getHist(64);
        const histogram64: LinearHistogram = JSON.parse(m.UTF8ToString(hist64Ptr));

        const hist256Ptr = getHist(256);
        const histogram256: LinearHistogram = JSON.parse(m.UTF8ToString(hist256Ptr));

        // ── 步骤 6：提取内嵌预览 JPEG ─────────────────────────────────────────
        progress('正在提取视觉预览图...', 80);
        const getPreviewPtr = m.cwrap('lra_get_preview_jpeg', 'number', []) as () => number;
        const getPreviewSize = m.cwrap('lra_get_preview_size', 'number', []) as () => number;

        let previewObjectUrl: string | null = null;
        const previewPtr = getPreviewPtr();
        const previewSize = getPreviewSize();

        if (previewPtr !== 0 && previewSize > 0) {
            // 从 WASM 堆拷贝 JPEG 数据到 JS（Uint8Array 拷贝，不共享内存）
            const jpegBytes = m.HEAPU8.slice(previewPtr, previewPtr + previewSize);
            const blob = new Blob([jpegBytes], { type: 'image/jpeg' });
            previewObjectUrl = URL.createObjectURL(blob);
        }

        // ── 步骤 7：释放 LibRaw 资源 ──────────────────────────────────────────
        progress('正在清理...', 95);
        const close = m.cwrap('lra_close', 'void', []) as () => void;
        close();

        return { exif, physics, histogram64, histogram256, previewObjectUrl };

    } finally {
        // 无论成功或失败，都释放 malloc 的文件缓冲区
        m._free(ptr);
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Worker 消息处理
// ─────────────────────────────────────────────────────────────────────────────
self.onmessage = async (event: MessageEvent) => {
    const { type, buffer } = event.data;

    if (type === 'PARSE') {
        try {
            const result = await parseRawBuffer(buffer as ArrayBuffer);
            self.postMessage({ type: 'DONE', result });
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            self.postMessage({ type: 'ERROR', message });
        }
        return;
    }

    if (type === 'TERMINATE') {
        self.close();
    }
};
