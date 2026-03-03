cmake_minimum_required(VERSION 3.20)
project(lumina_raw_analyzer CXX C)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# ── 1. 验证是否在 Emscripten 环境下编译 ───────────────────────────────────────
if(NOT EMSCRIPTEN)
  message(FATAL_ERROR
    "必须使用 Emscripten 工具链编译。\n"
    "请执行: emcmake cmake .."
  )
endif()

# ── 2. 获取 LibRaw 源码（FetchContent 自动下载，无需手动安装）────────────────
include(FetchContent)

# 兼容 cmake 3.31+（CMP0169 将 FetchContent_Populate 标记为弃用）
if(POLICY CMP0169)
  cmake_policy(SET CMP0169 OLD)
endif()

FetchContent_Declare(
  libraw
  GIT_REPOSITORY https://github.com/LibRaw/LibRaw.git
  GIT_TAG        0.21.2          # 固定版本，保证可复现
  GIT_SHALLOW    TRUE
)

FetchContent_GetProperties(libraw)
if(NOT libraw_POPULATED)
  FetchContent_Populate(libraw)
endif()

# LibRaw 源文件列表 — 自动扫描，兼容不同版本的目录结构
file(GLOB_RECURSE LIBRAW_SOURCES "${libraw_SOURCE_DIR}/src/*.cpp")

# 排除不需要的子模块（dngsdk/rawspeed 集成、x3f 格式支持）
list(FILTER LIBRAW_SOURCES EXCLUDE REGEX ".*/integration/.*")
list(FILTER LIBRAW_SOURCES EXCLUDE REGEX ".*/x3f/.*")
list(FILTER LIBRAW_SOURCES EXCLUDE REGEX ".*/write/.*")
# 在 0.21.x + Emscripten 下，以下文件与 postprocessing_ph.cpp 存在重复定义
list(FILTER LIBRAW_SOURCES EXCLUDE REGEX ".*/postprocessing/mem_image\\.cpp$")
list(FILTER LIBRAW_SOURCES EXCLUDE REGEX ".*/postprocessing/aspect_ratio\\.cpp$")
# 仅回补最小写出桩函数，满足 link 依赖（不启用实际文件写出）
list(APPEND LIBRAW_SOURCES "${libraw_SOURCE_DIR}/src/write/write_ph.cpp")

# ── 3. 构建 LibRaw 静态库 ──────────────────────────────────────────────────────
add_library(libraw_static STATIC ${LIBRAW_SOURCES})

target_include_directories(libraw_static PUBLIC
  ${libraw_SOURCE_DIR}         # LibRaw 自身头文件（libraw/libraw.h）
)

target_compile_definitions(libraw_static PUBLIC
  LIBRAW_NOTHREADS             # 浏览器单线程环境，禁用 POSIX 线程
)

# ── 4. 构建我们的 WASM 导出模块 ───────────────────────────────────────────────
add_executable(raw_analyzer
  ${CMAKE_SOURCE_DIR}/src/raw_analyzer.cpp
)

target_include_directories(raw_analyzer PRIVATE
  ${libraw_SOURCE_DIR}
)

target_link_libraries(raw_analyzer PRIVATE libraw_static)

# ── 5. Emscripten 链接选项 ────────────────────────────────────────────────────
#
# 关键选项说明：
#   MODULARIZE        : 输出的 JS 包裹在函数中，避免全局污染，可 import() 动态加载
#   EXPORT_NAME       : JS 侧调用的模块名：const mod = await LibRawModule()
#   ALLOW_MEMORY_GROWTH : 允许堆内存动态增长（45MB NEF 解码后矩阵可达 200MB）
#   MAXIMUM_MEMORY    : 上限 512MB，防止浏览器 OOM
#   INITIAL_MEMORY    : 预分配 64MB，减少动态增长次数
#   SINGLE_FILE       : 将 .wasm 内联进 .js（Base64），简化 Next.js 静态资源部署
#   ENVIRONMENT       : 仅针对 web + worker 环境，移除 node/shell 代码
#   EXPORTED_FUNCTIONS: 精确声明导出的 C 函数（前缀 _ 是 C 链接约定）
#   EXPORTED_RUNTIME_ : 导出 JS 运行时辅助函数（内存读写、字符串互转）
#   ASSERTIONS        : Debug=1 开启，Release=0 关闭（提升性能）
#
set(EMSCRIPTEN_LINK_FLAGS
  "-s MODULARIZE=1"
  "-s EXPORT_NAME='LibRawModule'"
  "-s ALLOW_MEMORY_GROWTH=1"
  "-s MAXIMUM_MEMORY=536870912"   # 512MB
  "-s INITIAL_MEMORY=67108864"    # 64MB
  "-s SINGLE_FILE=1"
  "-s ENVIRONMENT='web,worker'"
  "-s EXPORTED_FUNCTIONS=['_malloc','_free','_lra_open_buffer','_lra_get_exif_json','_lra_get_physics_json','_lra_get_linear_histogram_json','_lra_get_preview_jpeg','_lra_get_preview_size','_lra_close']"
  "-s EXPORTED_RUNTIME_METHODS=['ccall','cwrap','UTF8ToString','lengthBytesUTF8','stringToUTF8','HEAPU8','getValue']"
  # 关闭不需要的特性以减小输出体积
  "-s FILESYSTEM=0"
  "-s AUTO_NATIVE_LIBRARIES=0"
)

# Release 构建：优化体积与性能
if(CMAKE_BUILD_TYPE STREQUAL "Release")
  list(APPEND EMSCRIPTEN_LINK_FLAGS
    "-O3"
    "--closure 1"               # Google Closure 压缩 JS 胶水代码
    "-s ASSERTIONS=0"
  )
  target_compile_options(raw_analyzer PRIVATE -O3)
  target_compile_options(libraw_static PRIVATE -O3)
else()
  # Debug 构建：保留符号和断言
  list(APPEND EMSCRIPTEN_LINK_FLAGS
    "-O0"
    "-g"                        # 保留 DWARF 调试符号
    "-s ASSERTIONS=2"           # 强断言（检测越界访问等）
    "-s SAFE_HEAP=1"            # 堆访问安全检查（显著减慢速度，仅 Dev 用）
  )
  target_compile_options(raw_analyzer PRIVATE -O0 -g)
endif()

string(JOIN " " EMSCRIPTEN_LINK_FLAGS_STR ${EMSCRIPTEN_LINK_FLAGS})
set_target_properties(raw_analyzer PROPERTIES
  LINK_FLAGS "${EMSCRIPTEN_LINK_FLAGS_STR}"
  SUFFIX ".js"                  # 输出 raw_analyzer.js（内含内联 WASM）
)
