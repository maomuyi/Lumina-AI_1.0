# 🎨 Lumina — AI 智能调色助手

> 上传照片，AI 生成专业级 Lightroom 调色预设（.xmp），一键下载导入。

当前版本：`v0.1.4`（`V1-test` 同步版，2026-05-13）

Lumina 通过**前端 WASM 深度解析 RAW 底层物理数据** + **多模态大模型双维推理**，生成精准的 Lightroom 调色参数，并输出专业的"AI 调色诊断报告"。

---

## ✨ 核心亮点

- **前端重解析**：基于 LibRaw WASM 在浏览器本地解码 NEF（14-bit RAW），提取线性直方图、宽容度余量、RGGB 通道偏移等物理数据，无需上传 45MB 原始文件。
- **双轨分析**：视觉轨（内嵌预览图 → 多模态大模型识别语义）+ 数据轨（物理特征 JSON → 约束调色参数边界）。
- **专业诊断报告**：四模块结构化报告（核心结论 → 底层剖析 → 美化建议 → 参数动作），兼顾小白与老手。
- **XMP 模板引擎**：以 Lightroom 官方导出的预设文件作为唯一标准模板，按参数注入生成 100% 兼容 `.xmp`。
- **多轮微调**：支持自然语言多轮对话（"肤色再亮一点"、"冷色调"），基于 Redis Session 复用上下文，无需重传图片。
- **本地规则兜底**：未配置云端模型 Key 时，仍可基于 RAW/JPG 物理数据生成诊断报告与 Lightroom 参数。
- **参考图追色**：支持上传参考图并按强度融合色彩统计，生成更贴近目标风格的 XMP 参数。
- **风格意图增强**：内置风格画像与可选联网检索，用于理解 Portra、C200、赛博朋克等更具体的风格诉求。
- **Lightroom 风格 UI**：填充式滑块、色彩编码 HSL 轨道、紧凑 22px 行高，还原专业调色体验。

### V1-test 同步更新（2026-05-13）

- **本地分析链路上线**：新增 `localAnalyzer`、风格画像、风格参数增强与微调变化量控制，弱网或无模型 Key 时也能完成首轮分析和多轮微调。
- **参考图追色能力**：前端新增参考图上传、颜色统计、强度滑块与参数融合逻辑，后端 XMP 生成可直接使用当前融合参数。
- **调色助手体验升级**：右侧面板支持诊断、参数、历史与助手对话联动，保留 refine 历史并支持下载当前版本。
- **RAW 解析稳定性增强**：WASM Worker 增强错误处理与物理数据输出，`build.sh` 改为自动准备本地 `third_party/emsdk` 工具链目录。
- **工程验证补齐**：新增后端 Vitest 单元测试、前端 Playwright smoke test 与 GitHub Actions CI。
- **同步排除项**：`尼康预设/`、`test-image/`、`frontend/test-results/`、本地 WASM 工具链与备份文件均保持在 Git 外。

### v0.1.4 重点更新

- **评分系统上线**：诊断报告新增“老师批注式”评分卡，展示总分、等级、标签，颜色随分数从绿→黄→红渐变。
- **画布交互商业化升级**：支持拖拽平移、滚轮缩放、边界限制、双击循环缩放（Fit→100%→200%→Fit）。
- **报告可读性修复**：右侧长文本滚动问题修复，超长内容可稳定浏览。
- **后端稳定性增强**：Prompt 与 JSON 解析链路强化，改善视觉模型输出不完整时的容错能力。

### v0.1.2 重点更新

- **专家级诊断增强**：后端新增报告增强层，自动融合视觉语义与物理指标，输出更细致的调色结论与参数理由。
- **双轨校验可见化**：`/api/analyze` 新增 `dual_track_validated` 进度事件，明确标记“视觉轨 + 物理轨”均已就绪。
- **解析健壮性提升**：LLM 返回新增结构化归一化，避免异常 JSON 结构导致前端报告渲染崩溃。
- **上传稳定性优化**：NEF 预览图在提交前二次压缩，显著降低 413 触发概率并减少等待时间。

---

## 🏗️ 技术架构

```
┌─────────────────────────────────────────────────────────┐
│  前端 (Next.js 16 + React 18 + TypeScript + TailwindCSS) │
│                                                          │
│  ┌─────────────┐  ┌──────────────┐  ┌──────────────────┐ │
│  │ 拖拽上传     │  │ WASM Worker  │  │ Lightroom 参数面板│ │
│  │ JPG / NEF   │→ │ LibRaw 解码  │→ │ AI 诊断报告      │ │
│  └─────────────┘  │ 物理数据提取  │  │ XMP 下载         │ │
│                   └──────┬───────┘  └──────────────────┘ │
│                          │ POST (预览图 + 物理数据 JSON)   │
└──────────────────────────┼──────────────────────────────┘
                           ▼
┌──────────────────────────────────────────────────────────┐
│  后端 (Node.js + Fastify + TypeScript)                    │
│                                                           │
│  ┌──────────────┐  ┌──────────────┐  ┌────────────────┐  │
│  │ /api/analyze  │  │ Prompt 引擎   │  │ XMP 模板引擎   │  │
│  │ SSE 流式     │→ │ 5 步工作流    │→ │ Handlebars     │  │
│  │ /api/refine   │  │ 5 条强制规则  │  │ ToneCurve 序列化│  │
│  └──────────────┘  └──────┬───────┘  └────────────────┘  │
│                           │                               │
│                   ┌───────▼───────┐  ┌────────────────┐  │
│                   │ OpenAI SDK    │  │ Redis Session  │  │
│                   │ Vision + Text │  │ TTL 30min      │  │
│                   └───────────────┘  └────────────────┘  │
└──────────────────────────────────────────────────────────┘
```

---

## 📁 项目结构

```
Lumina/
├── frontend/                   # Next.js 前端
│   ├── app/page.tsx            # 主页面（上传 → 分析 → 报告 → 微调）
│   ├── components/
│   │   ├── left-sidebar.tsx    # 上传、风格选择、分析触发
│   │   ├── center-canvas.tsx   # 图片预览 + 元数据
│   │   ├── right-panel.tsx     # 诊断报告 / 参数滑块 / 下载
│   │   ├── diagnostics-panel.tsx # 诊断指标摘要
│   │   ├── param-slider.tsx    # Lightroom 风格填充式滑块
│   │   └── ai-diagnostic-report.tsx
│   ├── lib/
│   │   ├── api.ts              # SSE 流式 fetch 封装
│   │   ├── reference-color-match.ts # 参考图追色与参数融合
│   │   ├── refine-history.ts   # 微调历史状态
│   │   ├── canvas-utils.ts     # 画布颜色统计辅助
│   │   ├── lightroom-params.ts # 60+ 参数定义（XMP 标准 Key）
│   │   └── image-analysis.ts   # JPG 数据轨真实分析（直方图/极值/断层/ICC）
│   ├── hooks/useAnalyzeFlow.ts # 分析 / 微调 / 下载主流程
│   ├── hooks/useRawParser.ts   # WASM Worker 生命周期管理
│   ├── e2e/                    # Playwright smoke tests
│   ├── workers/raw-parser.worker.ts
│   └── wasm/
│       ├── CMakeLists.txt      # LibRaw WASM 编译配置
│       ├── src/raw_analyzer.cpp # C++ 导出函数
│       └── build.sh            # 一键编译脚本
│
├── backend/                    # Fastify 后端
│   └── src/
│       ├── index.ts            # 服务入口
│       ├── routes/
│       │   ├── analyze.ts      # POST /api/analyze (SSE)
│       │   ├── refine.ts       # POST /api/refine (SSE)
│       │   └── xmp.ts          # POST /api/xmp
│       ├── services/
│       │   ├── llm.ts          # OpenAI SDK 双模型调度
│       │   ├── localAnalyzer.ts # 本地规则诊断与参数生成
│       │   ├── prompt.ts       # System Prompt + 用户 Prompt
│       │   ├── styleProfiles.ts # 内置风格画像
│       │   ├── styleSearch.ts  # 可选风格联网检索
│       │   ├── session.ts      # Redis Session 管理
│       │   └── xmp.ts          # XMP 标准模板注入引擎
│       ├── utils/
│       │   ├── parseAI.ts      # 三层 JSON 解析防御
│       │   └── clampParams.ts  # 参数范围校验
│       └── templates/
│           └── LightroomPresetStandard.xmp
│
└── AI_CONTEXT.md               # AI 上下文指导书
```

---

## 🚀 快速开始

### 前提条件

- Node.js ≥ 18
- pnpm ≥ 10
- Redis（本地建议 Homebrew）

### 1. 初始化仓库

```bash
git clone <repo-url> Lumina && cd Lumina
```

### 2. 安装依赖（workspace）

```bash
pnpm install
```

### 3. 配置后端环境变量

```bash
cp backend/.env.example backend/.env
# DeepSeek 文本 key 填 TEXT_API_KEY；没有多模态 key 时保持 VISION_API_KEY 为空
```

### 4. 启动开发环境

```bash
# 同时启动 frontend + backend
pnpm dev

# 或分别启动
pnpm --filter lumina-backend dev
pnpm --filter lumina-frontend dev
```

### 5. 编译 WASM（NEF 链路必须）

```bash
cd frontend/wasm
bash build.sh
# 产物：frontend/public/wasm/raw_analyzer.js
```

`build.sh` 会优先使用本机已有 Emscripten；若需要本地工具链，请把 `third_party/emsdk/` 作为本地构建目录处理，不提交到 Git。

### 6. 验证

```bash
pnpm --filter lumina-backend test
pnpm --filter lumina-frontend --filter lumina-backend typecheck
```

---

## 🔧 环境变量

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `TEXT_API_KEY` | Text-only API Key，用于 Chat / 多轮微调；未配置时该路径走本地规则 | — |
| `TEXT_BASE_URL` | Text-only API 地址，DeepSeek 默认地址 | `https://api.deepseek.com` |
| `TEXT_MODEL` | Text-only 模型 | `deepseek-v4-flash` |
| `VISION_API_KEY` | 多模态识图 API Key，仅用于首轮传图分析；未配置时首轮走本地规则 | — |
| `VISION_BASE_URL` | 多模态识图 API 地址 | `https://api.openai.com/v1` |
| `VISION_MODEL` | 首轮视觉模型 | `gpt-5-2025-08-07` |
| `STYLE_WEB_SEARCH_ENABLED` | 是否启用 Chat / 微调风格意图联网检索 | `false` |
| `STYLE_SEARCH_PROVIDER` | 风格检索供应商，`duckduckgo` 无需 key，`tavily` 更稳定 | `duckduckgo` |
| `STYLE_SEARCH_API_KEY` | 风格检索 API Key，仅在启用联网检索时需要 | — |
| `STYLE_SEARCH_CACHE_TTL_SECONDS` | 风格上下文缓存秒数 | `604800` |
| `STYLE_SEARCH_MAX_RESULTS` | 单次风格检索结果数 | `5` |
| `REDIS_URL` | Redis 连接地址 | `redis://127.0.0.1:6379` |
| `SESSION_TTL` | Session 过期时间（秒） | `1800` |
| `XMP_FILE_TTL_SECONDS` | XMP 文件有效期（秒） | `86400` |
| `CORS_ORIGINS` | 允许跨域来源（逗号分隔，支持 `*`） | `http://localhost:*,http://127.0.0.1:*` |
| `PORT` | 后端端口 | `3001` |
| `NEXT_PUBLIC_API_URL` | 前端连接后端地址 | `http://localhost:3001` |

---

## 📐 API 接口

### `POST /api/analyze`

首次分析（SSE 流式响应）。

- **Content-Type**: `multipart/form-data`
- **字段**: `preview_image`(File), `raw_data`(JSON), `user_intent`(string), `style`(string)
- **SSE 事件**: `{type:"text", content}` → `{type:"final", session_id, diagnostic_report, lightroom_params, download_url}`

### `POST /api/refine`

多轮微调（SSE 流式响应）。

- **Content-Type**: `application/json`
- **Body**: `{session_id, new_intent}`
- **SSE 事件**: 同上

### `POST /api/xmp`

基于当前参数生成新的 XMP 下载链接。

- **Content-Type**: `application/json`
- **Body**: `{ lightroom_params }`
- **响应**: `{ download_url }`

### `GET /downloads/:filename`

下载生成的 XMP 预设文件。

---

## 📄 License

MIT
