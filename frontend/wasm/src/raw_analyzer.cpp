/**
 * raw_analyzer.cpp
 *
 * LibRaw → WebAssembly 导出层
 * 职责：解析 RAW/JPG 文件，提取物理光影数据供 AI 调色引擎使用。
 *
 * 导出的 C API（供 JS 的 ccall/cwrap 调用）：
 *   lra_open_buffer          : 解析内存中的 RAW 文件
 *   lra_get_exif_json        : 返回 EXIF 信息 JSON
 *   lra_get_physics_json     : 返回 RAW 物理特征 JSON（核心壁垒数据）
 *   lra_get_linear_histogram_json : 返回线性直方图 JSON
 *   lra_get_preview_jpeg     : 返回内嵌 JPEG 预览图的内存指针
 *   lra_get_preview_size     : 返回预览图字节数
 *   lra_close                : 释放资源
 */

#include <libraw/libraw.h>
#include <cmath>
#include <cstring>
#include <memory>
#include <sstream>
#include <string>
#include <vector>
#include <algorithm>
#include <emscripten/emscripten.h>

// ─────────────────────────────────────────────────────────────────────────────
// 全局状态（单 Tab 单实例，浏览器场景安全）
// ─────────────────────────────────────────────────────────────────────────────
static LibRaw             g_processor;
static std::string        g_json_buf;        // 所有 JSON 的共享输出缓冲区
static std::vector<uchar> g_preview_buf;     // 内嵌预览 JPEG 缓冲区

// ─────────────────────────────────────────────────────────────────────────────
// 内部辅助工具
// ─────────────────────────────────────────────────────────────────────────────

/** JSON 字符串转义（防注入） */
static std::string json_escape(const char* s) {
    if (!s) return "null";
    std::string out;
    out.reserve(64);
    out += '"';
    for (const char* c = s; *c; ++c) {
        switch (*c) {
            case '"':  out += "\\\""; break;
            case '\\': out += "\\\\"; break;
            case '\n': out += "\\n";  break;
            case '\r': out += "\\r";  break;
            case '\t': out += "\\t";  break;
            default:   out += *c;
        }
    }
    out += '"';
    return out;
}

/** 快速拼 JSON 数字，避免 std::to_string 的精度问题 */
static std::string jf(float v, int decimals = 4) {
    char buf[32];
    snprintf(buf, sizeof(buf), "%.*f", decimals, v);
    return buf;
}

/** 兼容不同 LibRaw 版本：推断 RAW 位深（优先 raw_bps，退化到 white level 反推） */
static int detect_raw_bit_depth() {
    const libraw_colordata_t& color = g_processor.imgdata.color;
    const int raw_bps = static_cast<int>(color.raw_bps);
    if (raw_bps > 0 && raw_bps <= 24) {
        return raw_bps;
    }

    int white_level = static_cast<int>(color.maximum);
    if (white_level <= 0) white_level = static_cast<int>(color.data_maximum);
    if (white_level <= 0) white_level = 16383; // fallback: 14-bit

    int bits = 0;
    while (bits < 24 && ((1 << bits) - 1) < white_level) {
        ++bits;
    }
    return std::max(8, bits);
}

// ─────────────────────────────────────────────────────────────────────────────
// 公开 C API
// ─────────────────────────────────────────────────────────────────────────────
extern "C" {

/**
 * lra_open_buffer
 *
 * 将内存中的 RAW 文件（NEF/CR2/ARW/DNG 等）交给 LibRaw 解析。
 * 调用链：open_buffer → unpack → unpack_thumb
 *   - unpack()      : 解码 RAW 像素矩阵（数据轨，用于直方图/物理数据）
 *   - unpack_thumb(): 提取内嵌预览 JPEG（视觉轨）
 *
 * @param data  JS 侧传入的 Uint8Array.buffer 指针（HEAPU8 中的地址）
 * @param size  文件字节数
 * @return  0 = 成功，非 0 = LibRaw 错误码
 */
EMSCRIPTEN_KEEPALIVE
int lra_open_buffer(const uint8_t* data, size_t size) {
    g_processor.recycle();
    g_preview_buf.clear();

    // ── 步骤 1：解析文件头与元数据 ──────────────────────────────────────────
    int ret = g_processor.open_buffer(static_cast<const void*>(data), size);
    if (ret != LIBRAW_SUCCESS) return ret;

    // ── 步骤 2：解包 RAW 像素矩阵（不做去马赛克，保留线性数据）────────────
    ret = g_processor.unpack();
    if (ret != LIBRAW_SUCCESS) return ret;

    // ── 步骤 3：提取内嵌预览 JPEG ────────────────────────────────────────────
    ret = g_processor.unpack_thumb();
    if (ret == LIBRAW_SUCCESS) {
        libraw_thumbnail_t& thumb = g_processor.imgdata.thumbnail;
        if (thumb.tformat == LIBRAW_THUMBNAIL_JPEG && thumb.tlength > 0) {
            g_preview_buf.assign(
                reinterpret_cast<const uchar*>(thumb.thumb),
                reinterpret_cast<const uchar*>(thumb.thumb) + thumb.tlength
            );
        }
    }
    // 预览提取失败不是致命错误，继续

    return LIBRAW_SUCCESS;
}

/**
 * lra_get_exif_json
 *
 * 返回 EXIF 信息 JSON 字符串（UTF-8，只读，下次 API 调用前有效）。
 *
 * 输出示例：
 * {
 *   "camera_make": "Nikon",
 *   "camera_model": "Z 7_2",
 *   "iso": 100,
 *   "shutter": "1/2000",
 *   "aperture": 2.8,
 *   "focal_length": 50.0,
 *   "raw_bits": 14,
 *   "width": 8256,
 *   "height": 5504
 * }
 */
EMSCRIPTEN_KEEPALIVE
const char* lra_get_exif_json() {
    const libraw_iparams_t&   ip  = g_processor.imgdata.idata;
    const libraw_imgother_t&  io  = g_processor.imgdata.other;
    const libraw_image_sizes_t& is = g_processor.imgdata.sizes;
    const int bit_depth = detect_raw_bit_depth();

    // 快门速度格式化（分数表示）
    std::string shutter_str;
    float shutter = io.shutter;
    if (shutter > 0.0f && shutter < 1.0f) {
        char buf[32];
        snprintf(buf, sizeof(buf), "1/%.0f", 1.0f / shutter);
        shutter_str = buf;
    } else if (shutter >= 1.0f) {
        char buf[32];
        snprintf(buf, sizeof(buf), "%.1fs", shutter);
        shutter_str = buf;
    } else {
        shutter_str = "unknown";
    }

    std::ostringstream ss;
    ss << "{"
       << "\"camera_make\":"    << json_escape(ip.make)         << ","
       << "\"camera_model\":"   << json_escape(ip.model)        << ","
       << "\"iso\":"            << static_cast<int>(io.iso_speed) << ","
       << "\"shutter\":"        << json_escape(shutter_str.c_str()) << ","
       << "\"aperture\":"       << jf(io.aperture, 1)           << ","
       << "\"focal_length\":"   << jf(io.focal_len, 1)          << ","
       << "\"raw_bits\":"       << bit_depth << ","
       << "\"width\":"          << static_cast<int>(is.raw_width) << ","
       << "\"height\":"         << static_cast<int>(is.raw_height)
       << "}";

    g_json_buf = ss.str();
    return g_json_buf.c_str();
}

/**
 * lra_get_physics_json
 *
 * 返回 RAW 物理特征 JSON（AI 调色的"物理底牌"）。
 *
 * 计算字段说明：
 *   sensor_white_level      : 传感器饱和点（来自 LibRaw color.maximum）
 *   actual_max_value        : 矩阵中实际最大像素值
 *   highlight_clipping_rate : 达到/超过 white_level 的像素比例（物理死白率）
 *   shadow_survival_rate    : 像素值 > 黑场阈值的比例（暗部可救率）
 *   raw_channel_multipliers : RGGB 白平衡乘数（相机真实偏色情况）
 *   bit_depth               : 实际 bit 位深
 *   color_matrix_type       : 色彩矩阵来源描述
 *
 * 输出示例：
 * {
 *   "sensor_white_level": 15500,
 *   "actual_max_value": 16383,
 *   "highlight_clipping_rate": 0.0052,
 *   "shadow_survival_rate": 0.998,
 *   "raw_channel_multipliers": [2.45, 1.0, 1.0, 1.32],
 *   "bit_depth": 14,
 *   "banding_risk": "low"
 * }
 */
EMSCRIPTEN_KEEPALIVE
const char* lra_get_physics_json() {
    const libraw_colordata_t& color = g_processor.imgdata.color;
    const libraw_image_sizes_t& sz  = g_processor.imgdata.sizes;
    const int bit_depth = detect_raw_bit_depth();

    // ── 获取 RAW 像素矩阵 ─────────────────────────────────────────────────────
    const ushort* raw = g_processor.imgdata.rawdata.raw_image;
    if (!raw) {
        g_json_buf = "{\"error\":\"raw matrix not available\"}";
        return g_json_buf.c_str();
    }

    const int total_pixels = sz.raw_width * sz.raw_height;

    // ── 传感器白点（饱和点） ───────────────────────────────────────────────────
    // color.maximum 是 LibRaw 计算的有效最大值；若为 0，退回到理论最大值
    int white_level = color.maximum;
    if (white_level <= 0) {
        white_level = (1 << bit_depth) - 1;
    }

    // ── 黑场阈值（用于 shadow_survival_rate 计算） ─────────────────────────────
    // LibRaw 的 black level 可能是全局值或分区域的（取最大值为保守估计）
    int black_level = color.black;
    for (int c = 0; c < 4; ++c) {
        if (color.cblack[c] > black_level)
            black_level = color.cblack[c];
    }
    // 将"可救暗部"的阈值设为黑场 + 少量噪底（约 2% 的动态范围）
    const int shadow_threshold = black_level + static_cast<int>(white_level * 0.02f);

    // ── 遍历矩阵，统计核心指标 ────────────────────────────────────────────────
    long long clipped_count  = 0;   // 高光物理溢出像素数
    long long survivor_count = 0;   // 暗部可救像素数（> shadow_threshold）
    int       actual_max     = 0;   // 矩阵中实际最大值

    // 用于检测 banding（色彩断层风险）的暗区梯度标准差
    // 简化策略：检查直方图在暗部区间 [black, black+1024] 的均匀性
    constexpr int SHADOW_BAND_BINS = 32;
    std::vector<long long> shadow_hist(SHADOW_BAND_BINS, 0);
    const int shadow_band_width = static_cast<int>(white_level * 0.06f); // 6% 范围
    const int shadow_band_end   = black_level + shadow_band_width;
    const int bin_width         = std::max(1, shadow_band_width / SHADOW_BAND_BINS);

    for (int i = 0; i < total_pixels; ++i) {
        int v = static_cast<int>(raw[i]);
        if (v > actual_max)              actual_max = v;
        if (v >= white_level)            ++clipped_count;
        if (v > shadow_threshold)        ++survivor_count;

        // 统计暗区分布（用于 banding 检测）
        if (v >= black_level && v < shadow_band_end) {
            int bin = (v - black_level) / bin_width;
            if (bin >= 0 && bin < SHADOW_BAND_BINS)
                ++shadow_hist[bin];
        }
    }

    // ── highlight_clipping_rate ───────────────────────────────────────────────
    float highlight_clipping_rate = static_cast<float>(clipped_count) / total_pixels;

    // ── shadow_survival_rate ──────────────────────────────────────────────────
    float shadow_survival_rate = static_cast<float>(survivor_count) / total_pixels;

    // ── banding_risk：计算暗区直方图的变异系数（CoV） ─────────────────────────
    // CoV = std_dev / mean；CoV 高说明像素分布不均匀，有断层风险
    double sum = 0, sq_sum = 0;
    int    nonzero_bins = 0;
    for (int b = 0; b < SHADOW_BAND_BINS; ++b) {
        double v = static_cast<double>(shadow_hist[b]);
        if (v > 0) { ++nonzero_bins; sum += v; sq_sum += v * v; }
    }
    std::string banding_risk = "low";
    if (nonzero_bins >= 4) {
        double mean   = sum / nonzero_bins;
        double var    = (sq_sum / nonzero_bins) - (mean * mean);
        double std_dev = (var > 0) ? std::sqrt(var) : 0.0;
        double cov    = (mean > 0) ? (std_dev / mean) : 0.0;
        // 阈值经验值：8-bit JPEG 经强烈后期后 CoV 通常 > 0.5
        if      (cov > 0.6)  banding_risk = "high";
        else if (cov > 0.35) banding_risk = "medium";
    }

    // ── RGGB 通道乘数归一化（G 通道归 1.0） ──────────────────────────────────
    // LibRaw 的 cam_mul[4] 是 R, G, G2, B 的相对乘数
    // 归一化基准：G 通道（cam_mul[1]）
    float mul[4] = {
        color.cam_mul[0],
        color.cam_mul[1],
        color.cam_mul[2],
        color.cam_mul[3]
    };
    float g_mul = (mul[1] > 0.0f) ? mul[1] : 1.0f;
    for (int i = 0; i < 4; ++i) mul[i] /= g_mul;

    // ── 组装 JSON ─────────────────────────────────────────────────────────────
    std::ostringstream ss;
    ss << "{"
       << "\"sensor_white_level\":"       << white_level                                   << ","
       << "\"black_level\":"              << black_level                                    << ","
       << "\"actual_max_value\":"         << actual_max                                     << ","
       << "\"highlight_clipping_rate\":"  << jf(highlight_clipping_rate, 4)                 << ","
       << "\"shadow_survival_rate\":"     << jf(shadow_survival_rate, 4)                    << ","
       << "\"raw_channel_multipliers\":["
           << jf(mul[0], 4) << ","        // R
           << jf(mul[1], 4) << ","        // G
           << jf(mul[2], 4) << ","        // G2
           << jf(mul[3], 4)               // B
       << "],"
       << "\"bit_depth\":"                << bit_depth                                       << ","
       << "\"banding_risk\":"             << json_escape(banding_risk.c_str())
       << "}";

    g_json_buf = ss.str();
    return g_json_buf.c_str();
}

/**
 * lra_get_linear_histogram_json
 *
 * 返回线性直方图 JSON 数组（AI 调色的核心数据）。
 *
 * "线性"的含义：
 *   - 直接基于 RAW 矩阵的原始像素值（未经 Gamma 校正、未经去马赛克）
 *   - 反映传感器实际捕获的光子分布
 *   - 与 Lightroom 看到的"真实直方图"等价（LR 内部也用线性数据计算）
 *
 * @param bins  输出的直方图桶数，推荐值：
 *              - 256  : 完整精度，适合需要精细分析的场景
 *              - 64   : 降采样版，发给 LLM 时节省 75% Token（推荐）
 *
 * 输出格式（以 bins=8 为例，实际用 64 或 256）：
 * {
 *   "bins": 64,
 *   "bit_depth": 14,
 *   "white_level": 15500,
 *   "black_level": 512,
 *   "histogram": [120, 380, 1200, 4500, 9800, 15000, 8200, 300],
 *   "total_pixels": 45400064,
 *   "percentiles": {
 *     "p2": 0.08,    ← 暗部截止点（对应 LR 中将直方图拉到此处不会死黑）
 *     "p98": 0.94    ← 亮部截止点（对应 LR 中不死白的安全曝光上限）
 *   }
 * }
 *
 * histogram[i] 的物理含义：
 *   统计像素值落在区间 [black_level + i*(white_level-black_level)/bins,
 *                         black_level + (i+1)*(white_level-black_level)/bins)
 *   内的像素数量。
 */
EMSCRIPTEN_KEEPALIVE
const char* lra_get_linear_histogram_json(int bins) {
    // 合法性检查并钳制
    if (bins <= 0 || bins > 1024) bins = 256;

    const ushort* raw = g_processor.imgdata.rawdata.raw_image;
    if (!raw) {
        g_json_buf = "{\"error\":\"raw matrix not available\"}";
        return g_json_buf.c_str();
    }

    const libraw_colordata_t&   color = g_processor.imgdata.color;
    const libraw_image_sizes_t& sz    = g_processor.imgdata.sizes;
    const int bit_depth = detect_raw_bit_depth();

    // ── 白点与黑场 ────────────────────────────────────────────────────────────
    int white_level = color.maximum;
    if (white_level <= 0) white_level = (1 << bit_depth) - 1;

    int black_level = color.black;
    for (int c = 0; c < 4; ++c) {
        if (color.cblack[c] > black_level)
            black_level = color.cblack[c];
    }
    // 确保黑场不超过白场
    if (black_level >= white_level) black_level = 0;

    const int dynamic_range = white_level - black_level;
    const int total_pixels  = sz.raw_width * sz.raw_height;

    // ── 构建 bins 个桶的直方图 ────────────────────────────────────────────────
    std::vector<long long> hist(bins, 0);

    for (int i = 0; i < total_pixels; ++i) {
        int v = static_cast<int>(raw[i]) - black_level;

        // 钳制到 [0, dynamic_range]
        if (v < 0)              { v = 0; }
        if (v > dynamic_range)  { v = dynamic_range; }

        // 映射到桶编号（末尾桶接收最大值）
        int bin = static_cast<int>(
            static_cast<long long>(v) * bins / (dynamic_range + 1)
        );
        if (bin >= bins) bin = bins - 1;
        ++hist[bin];
    }

    // ── 计算百分位数（p2 / p98，用于 LR 中的安全曝光范围） ──────────────────
    // p2:  从暗端累计到总像素 2% 时对应的归一化亮度值 → 调色时的安全黑场
    // p98: 从暗端累计到总像素 98% 时对应的归一化亮度值 → 调色时的安全白场
    long long cum = 0;
    float p2_norm  = 0.0f, p98_norm = 1.0f;
    const long long threshold_2  = static_cast<long long>(total_pixels) * 2 / 100;
    const long long threshold_98 = static_cast<long long>(total_pixels) * 98 / 100;
    bool found_p2 = false, found_p98 = false;

    for (int b = 0; b < bins && (!found_p2 || !found_p98); ++b) {
        cum += hist[b];
        float bin_center_norm = (b + 0.5f) / bins;  // 归一化到 [0, 1]
        if (!found_p2  && cum >= threshold_2)  { p2_norm  = bin_center_norm; found_p2  = true; }
        if (!found_p98 && cum >= threshold_98) { p98_norm = bin_center_norm; found_p98 = true; }
    }

    // ── 组装 JSON ─────────────────────────────────────────────────────────────
    std::ostringstream ss;
    ss << "{"
       << "\"bins\":"         << bins         << ","
       << "\"bit_depth\":"    << bit_depth  << ","
       << "\"white_level\":"  << white_level  << ","
       << "\"black_level\":"  << black_level  << ","
       << "\"total_pixels\":" << total_pixels << ","
       << "\"histogram\":[";

    for (int b = 0; b < bins; ++b) {
        ss << hist[b];
        if (b < bins - 1) ss << ',';
    }

    ss << "],"
       << "\"percentiles\":{"
           << "\"p2\":"  << jf(p2_norm,  4) << ","
           << "\"p98\":" << jf(p98_norm, 4)
       << "}"
       << "}";

    g_json_buf = ss.str();
    return g_json_buf.c_str();
}

/**
 * lra_get_preview_jpeg
 *
 * 返回内嵌 JPEG 预览图的内存起始地址（在 WASM 堆中）。
 * JS 侧用 HEAPU8.subarray(ptr, ptr + size) 读取，
 * 然后 new Blob([subarray], {type: 'image/jpeg'}) 构造图像 URL。
 *
 * @return 内嵌 JPEG 数据的 uint8_t* 指针（WASM 线性内存地址）
 *         若无预览图，返回 nullptr（JS 侧收到 0）
 */
EMSCRIPTEN_KEEPALIVE
const uint8_t* lra_get_preview_jpeg() {
    if (g_preview_buf.empty()) return nullptr;
    return reinterpret_cast<const uint8_t*>(g_preview_buf.data());
}

/**
 * lra_get_preview_size
 *
 * 返回内嵌 JPEG 预览图的字节数。
 * 与 lra_get_preview_jpeg 配合使用。
 */
EMSCRIPTEN_KEEPALIVE
int lra_get_preview_size() {
    return static_cast<int>(g_preview_buf.size());
}

/**
 * lra_close
 *
 * 释放 LibRaw 资源并重置全局状态。
 * 每次文件处理完毕后调用，防止内存积累。
 */
EMSCRIPTEN_KEEPALIVE
void lra_close() {
    g_processor.recycle();
    g_preview_buf.clear();
    g_json_buf.clear();
}

} // extern "C"
