#!/usr/bin/env bash
# =============================================================================
# build.sh — 将 raw_analyzer.cpp + LibRaw 编译为 WebAssembly
#
# 前提：已安装 Emscripten SDK（emsdk）
#   安装参考：https://emscripten.org/docs/getting_started/downloads.html
#   典型安装步骤：
#     git clone https://github.com/emscripten-core/emsdk.git
#     cd emsdk && ./emsdk install latest && ./emsdk activate latest
#     source emsdk_env.sh
#
# 使用方式：
#   chmod +x build.sh
#   ./build.sh           # Release 构建（-O3，体积最小）
#   ./build.sh debug     # Debug 构建（含断言和 SAFE_HEAP）
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BUILD_TYPE="$(echo "${1:-release}" | tr '[:upper:]' '[:lower:]')"

# ── 输出目录配置 ──────────────────────────────────────────────────────────────
# Release 产物直接输出到 Next.js 的 public 目录，next dev 时即可访问
RELEASE_OUT_DIR="${SCRIPT_DIR}/../public/wasm"
DEBUG_OUT_DIR="${SCRIPT_DIR}/build_debug"

if [[ "${BUILD_TYPE}" == "debug" ]]; then
    BUILD_DIR="${SCRIPT_DIR}/build_debug"
    CMAKE_BUILD_TYPE="Debug"
    OUT_DIR="${DEBUG_OUT_DIR}"
else
    BUILD_DIR="${SCRIPT_DIR}/build_release"
    CMAKE_BUILD_TYPE="Release"
    OUT_DIR="${RELEASE_OUT_DIR}"
fi

echo "══════════════════════════════════════════════════"
echo " Lumina LibRaw WASM Builder"
echo " Build type : ${CMAKE_BUILD_TYPE}"
echo " Output dir : ${OUT_DIR}"
echo "══════════════════════════════════════════════════"


# ── 自动获取 emsdk 工具链（首次构建时） ────────────────────────────────────
EMSDK_DIR="${SCRIPT_DIR}/../../third_party/emsdk"
if [[ ! -d "${EMSDK_DIR}" ]]; then
    echo ""
    echo "── [0/3] 首次构建：自动拉取 emsdk ─────────────────"
    mkdir -p "$(dirname "${EMSDK_DIR}")"
    git clone --depth=1 https://github.com/emscripten-core/emsdk.git "${EMSDK_DIR}"
    "${EMSDK_DIR}/emsdk" install latest
    "${EMSDK_DIR}/emsdk" activate latest
fi

# ── 检查 Emscripten 环境 ──────────────────────────────────────────────────────
if ! command -v emcmake &> /dev/null; then
    # 支持单仓后的 third_party/emsdk，也兼容旧路径 ../../emsdk
    for CANDIDATE in \
        "${SCRIPT_DIR}/../../third_party/emsdk/emsdk_env.sh" \
        "${SCRIPT_DIR}/../../emsdk/emsdk_env.sh"
    do
        if [[ -f "${CANDIDATE}" ]]; then
            # shellcheck disable=SC1090
            source "${CANDIDATE}"
            break
        fi
    done
fi

if ! command -v emcmake &> /dev/null; then
    echo "❌ 错误：未找到 emcmake 命令。"
    echo "   请先执行: source /path/to/emsdk/emsdk_env.sh"
    exit 1
fi

EMSCRIPTEN_VERSION=$(emcc --version 2>&1 | head -1)
echo "✅ Emscripten: ${EMSCRIPTEN_VERSION}"

# ── CMake 配置阶段 ─────────────────────────────────────────────────────────────
echo ""
echo "── [1/3] CMake 配置 ─────────────────────────────"
mkdir -p "${BUILD_DIR}"
cd "${BUILD_DIR}"

emcmake cmake \
    "${SCRIPT_DIR}" \
    -DCMAKE_BUILD_TYPE="${CMAKE_BUILD_TYPE}" \
    -DCMAKE_VERBOSE_MAKEFILE=OFF \
    -G "Unix Makefiles"

# ── 编译阶段 ──────────────────────────────────────────────────────────────────
echo ""
echo "── [2/3] 编译（可能需要 2~5 分钟，LibRaw 源码较多） ─"
NPROC=$(nproc 2>/dev/null || sysctl -n hw.logicalcpu 2>/dev/null || echo 4)
cmake --build . --parallel "${NPROC}"

# ── 拷贝产物 ──────────────────────────────────────────────────────────────────
echo ""
echo "── [3/3] 拷贝产物到 ${OUT_DIR} ──────────────────────"
mkdir -p "${OUT_DIR}"

# SINGLE_FILE=1 时只产出 .js（.wasm 内联为 Base64 字符串）
if [[ -f "${BUILD_DIR}/raw_analyzer.js" ]]; then
    cp "${BUILD_DIR}/raw_analyzer.js" "${OUT_DIR}/raw_analyzer.js"
    SIZE=$(du -sh "${OUT_DIR}/raw_analyzer.js" | cut -f1)
    echo "✅ raw_analyzer.js → ${OUT_DIR}/ (${SIZE})"
else
    echo "❌ 未找到 raw_analyzer.js，编译可能失败"
    exit 1
fi

# ── 结果摘要 ──────────────────────────────────────────────────────────────────
echo ""
echo "══════════════════════════════════════════════════"
echo " ✅ 构建完成！"
echo ""
echo " 下一步（Next.js 开发环境）："
echo "   在 Web Worker 中加载："
echo "   importScripts('/wasm/raw_analyzer.js')"
echo "   const mod = await LibRawModule();"
echo ""
echo " 导出函数速查："
echo "   lra_open_buffer(ptr, size)         → int (0=成功)"
echo "   lra_get_exif_json()                → const char*"
echo "   lra_get_physics_json()             → const char*"
echo "   lra_get_linear_histogram_json(bins)→ const char*"
echo "   lra_get_preview_jpeg()             → uint8_t*"
echo "   lra_get_preview_size()             → int"
echo "   lra_close()                        → void"
echo "══════════════════════════════════════════════════"
