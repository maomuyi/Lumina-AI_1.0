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
    raw_width?: number;
    raw_height?: number;
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
    /** 内嵌预览 JPEG 的实际尺寸，用于判断相机预览是否与 RAW 画幅一致 */
    previewDimensions: {
        width: number;
        height: number;
        aspectMismatch: boolean;
    } | null;
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
type LibRawModuleFactory = () => Promise<LibRawModuleType>;

type EmbeddedJpegCandidate = {
    offset: number;
    length: number;
    source: string;
}

const TIFF_TYPE_BYTES: Record<number, number> = {
    1: 1,  // BYTE
    2: 1,  // ASCII
    3: 2,  // SHORT
    4: 4,  // LONG
    5: 8,  // RATIONAL
    7: 1,  // UNDEFINED
    9: 4,  // SLONG
    10: 8, // SRATIONAL
}

const TIFF_TAG_SUB_IFDS = 0x014a;
const TIFF_TAG_EXIF_IFD = 0x8769;
const TIFF_TAG_JPEG_OFFSET = 0x0201;
const TIFF_TAG_JPEG_LENGTH = 0x0202;

function isTiffHeader(view: DataView): { littleEndian: boolean; firstIfdOffset: number } | null {
    if (view.byteLength < 8) return null;
    const byteOrder = view.getUint16(0, false);
    const littleEndian = byteOrder === 0x4949;
    if (!littleEndian && byteOrder !== 0x4d4d) return null;
    if (view.getUint16(2, littleEndian) !== 42) return null;
    return { littleEndian, firstIfdOffset: view.getUint32(4, littleEndian) };
}

function readTiffEntryValues(view: DataView, entryOffset: number, littleEndian: boolean): number[] {
    if (entryOffset < 0 || entryOffset + 12 > view.byteLength) return [];

    const type = view.getUint16(entryOffset + 2, littleEndian);
    const count = view.getUint32(entryOffset + 4, littleEndian);
    const typeBytes = TIFF_TYPE_BYTES[type] ?? 0;
    if (!typeBytes || count === 0 || count > 1024) return [];

    const totalBytes = typeBytes * count;
    const valuesOffset = totalBytes <= 4 ? entryOffset + 8 : view.getUint32(entryOffset + 8, littleEndian);
    if (valuesOffset < 0 || valuesOffset + totalBytes > view.byteLength) return [];

    const values: number[] = [];
    for (let i = 0; i < count; i++) {
        const offset = valuesOffset + i * typeBytes;
        if (type === 1 || type === 2 || type === 7) {
            values.push(view.getUint8(offset));
        } else if (type === 3) {
            values.push(view.getUint16(offset, littleEndian));
        } else if (type === 4) {
            values.push(view.getUint32(offset, littleEndian));
        } else if (type === 9) {
            values.push(view.getInt32(offset, littleEndian));
        }
    }

    return values;
}

function hasJpegSignature(bytes: Uint8Array, offset: number, length: number): boolean {
    return (
        offset >= 0 &&
        length > 1024 &&
        offset + length <= bytes.byteLength &&
        bytes[offset] === 0xff &&
        bytes[offset + 1] === 0xd8
    );
}

function scanTiffEmbeddedJpegs(bytes: Uint8Array): EmbeddedJpegCandidate[] {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const header = isTiffHeader(view);
    if (!header) return [];

    const candidates = new Map<string, EmbeddedJpegCandidate>();
    const queue = [header.firstIfdOffset];
    const visited = new Set<number>();

    while (queue.length > 0 && visited.size < 64) {
        const ifdOffset = queue.shift();
        if (ifdOffset === undefined || visited.has(ifdOffset)) continue;
        visited.add(ifdOffset);

        if (ifdOffset <= 0 || ifdOffset + 2 > view.byteLength) continue;
        const entryCount = view.getUint16(ifdOffset, header.littleEndian);
        const entriesStart = ifdOffset + 2;
        const nextIfdOffsetAt = entriesStart + entryCount * 12;
        if (entryCount > 512 || nextIfdOffsetAt + 4 > view.byteLength) continue;

        let jpegOffset: number | null = null;
        let jpegLength: number | null = null;

        for (let i = 0; i < entryCount; i++) {
            const entryOffset = entriesStart + i * 12;
            const tag = view.getUint16(entryOffset, header.littleEndian);
            const values = readTiffEntryValues(view, entryOffset, header.littleEndian);

            if (tag === TIFF_TAG_JPEG_OFFSET && values.length > 0) {
                jpegOffset = values[0];
            } else if (tag === TIFF_TAG_JPEG_LENGTH && values.length > 0) {
                jpegLength = values[0];
            } else if (tag === TIFF_TAG_SUB_IFDS || tag === TIFF_TAG_EXIF_IFD) {
                for (const value of values) {
                    if (value > 0 && value < view.byteLength) queue.push(value);
                }
            }
        }

        if (
            jpegOffset !== null &&
            jpegLength !== null &&
            hasJpegSignature(bytes, jpegOffset, jpegLength)
        ) {
            candidates.set(`${jpegOffset}:${jpegLength}`, {
                offset: jpegOffset,
                length: jpegLength,
                source: `IFD@${ifdOffset}`,
            });
        }

        const nextIfdOffset = view.getUint32(nextIfdOffsetAt, header.littleEndian);
        if (nextIfdOffset > 0 && nextIfdOffset < view.byteLength) {
            queue.push(nextIfdOffset);
        }
    }

    return Array.from(candidates.values()).sort((a, b) => b.length - a.length);
}

// ─────────────────────────────────────────────────────────────────────────────
// Worker 内部状态
// ─────────────────────────────────────────────────────────────────────────────
let mod: LibRawModuleType | null = null;
let moduleFactory: LibRawModuleFactory | null = null;

/** 发送进度消息给主线程 */
function progress(stage: string, pct: number) {
    self.postMessage({ type: 'PROGRESS', stage, pct });
}

async function readPreviewDimensions(
    blob: Blob,
    rawWidth: number,
    rawHeight: number
): Promise<RawAnalysisResult['previewDimensions']> {
    try {
        const bitmap = await createImageBitmap(blob, { imageOrientation: 'from-image' });
        const width = bitmap.width;
        const height = bitmap.height;
        bitmap.close();

        const previewAspect = width / Math.max(1, height);
        const rawAspect = rawWidth / Math.max(1, rawHeight);
        const aspectMismatch = Math.abs(previewAspect - rawAspect) / rawAspect > 0.03;

        return { width, height, aspectMismatch };
    } catch {
        return null;
    }
}

async function tryCreatePreviewFromJpegBytes(
    jpegBytes: Uint8Array,
    rawWidth: number,
    rawHeight: number
): Promise<{ objectUrl: string; dimensions: NonNullable<RawAnalysisResult['previewDimensions']> } | null> {
    const blob = new Blob([jpegBytes], { type: 'image/jpeg' });
    const dimensions = await readPreviewDimensions(blob, rawWidth, rawHeight);
    if (!dimensions) return null;

    return {
        objectUrl: URL.createObjectURL(blob),
        dimensions,
    };
}

/** WASM 模块懒加载（首次调用时初始化，之后复用） */
async function ensureModule(): Promise<LibRawModuleType> {
    if (mod) return mod;
    progress('正在加载 WASM 模块...', 0);

    if (!moduleFactory) {
        const wasmUrl = new URL('/wasm/raw_analyzer.js', self.location.origin).toString();
        const workerScope = self as typeof self & {
            LibRawModule?: LibRawModuleFactory;
        };

        const fromGlobal = workerScope.LibRawModule;
        if (typeof fromGlobal === 'function') {
            moduleFactory = fromGlobal;
        }

        // 优先走经典 Worker 路径（importScripts）。
        if (!moduleFactory) {
            try {
                importScripts(wasmUrl);
                if (typeof workerScope.LibRawModule === 'function') {
                    moduleFactory = workerScope.LibRawModule;
                } else if (typeof LibRawModule === 'function') {
                    moduleFactory = LibRawModule;
                }
            } catch {
                // module worker 下 importScripts 不可用，继续走 fallback。
            }
        }

        // module Worker fallback：fetch + Function 执行脚本并提取工厂函数。
        if (!moduleFactory) {
            const resp = await fetch(wasmUrl, { cache: 'no-store' });
            if (!resp.ok) {
                throw new Error('未找到 /wasm/raw_analyzer.js，请先运行 frontend/wasm/build.sh 生成 WASM 产物。');
            }
            const source = await resp.text();
            const factory = new Function(
                `${source}\nreturn (typeof LibRawModule === "function" ? LibRawModule : (typeof self !== "undefined" ? self.LibRawModule : undefined));`
            )() as unknown;
            if (typeof factory !== 'function') {
                throw new Error('WASM 加载失败：raw_analyzer.js 未暴露 LibRawModule');
            }
            moduleFactory = factory as LibRawModuleFactory;
            workerScope.LibRawModule = moduleFactory;
        }
    }

    mod = await moduleFactory();
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
        let previewObjectUrl: string | null = null;
        let previewDimensions: RawAnalysisResult['previewDimensions'] = null;

        const embeddedJpegCandidates = scanTiffEmbeddedJpegs(bytes);
        for (const candidate of embeddedJpegCandidates) {
            const preview = await tryCreatePreviewFromJpegBytes(
                bytes.subarray(candidate.offset, candidate.offset + candidate.length),
                exif.width,
                exif.height
            );
            if (preview) {
                previewObjectUrl = preview.objectUrl;
                previewDimensions = preview.dimensions;
                break;
            }
        }

        if (!previewObjectUrl) {
            const getPreviewPtr = m.cwrap('lra_get_preview_jpeg', 'number', []) as () => number;
            const getPreviewSize = m.cwrap('lra_get_preview_size', 'number', []) as () => number;
            const previewPtr = getPreviewPtr();
            const previewSize = getPreviewSize();

            if (previewPtr !== 0 && previewSize > 0) {
            // 从 WASM 堆拷贝 JPEG 数据到 JS（Uint8Array 拷贝，不共享内存）
                const jpegBytes = m.HEAPU8.slice(previewPtr, previewPtr + previewSize);
                const preview = await tryCreatePreviewFromJpegBytes(jpegBytes, exif.width, exif.height);
                if (preview) {
                    previewObjectUrl = preview.objectUrl;
                    previewDimensions = preview.dimensions;
                }
            }
        }

        // ── 步骤 7：释放 LibRaw 资源 ──────────────────────────────────────────
        progress('正在清理...', 95);
        const close = m.cwrap('lra_close', 'void', []) as () => void;
        close();

        return { exif, physics, histogram64, histogram256, previewObjectUrl, previewDimensions };

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
