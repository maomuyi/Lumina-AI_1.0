# 🎨 Lumina — AI 智能调色助手

> 上传照片，AI 生成专业级 Lightroom 调色预设（.xmp），一键下载导入。

当前版本：`v0.1.6`（2026-03-13）

Lumina 通过**前端 WASM 深度解析 RAW 底层物理数据** + **多模态大模型双维推理**，生成精准的 Lightroom 调色参数，并输出专业的"AI 调色诊断报告"。

---

## ✨ 核心亮点

- **前端重解析**：基于 LibRaw WASM 在浏览器本地解码 NEF（14-bit RAW），提取线性直方图、宽容度余量、RGGB 通道偏移等物理数据，无需上传 45MB 原始文件。
- **双轨分析**：视觉轨（内嵌预览图 → 多模态大模型识别语义）+ 数据轨（物理特征 JSON → 约束调色参数边界）。
- **专业诊断报告**：四模块结构化报告（核心结论 → 底层剖析 → 美化建议 → 参数动作），兼顾小白与老手。
- **XMP 模板引擎**：以 Lightroom 官方导出的预设文件作为唯一标准模板，按参数注入生成 100% 兼容 `.xmp`。
- **多轮微调**：支持自然语言多轮对话（"肤色再亮一点"、"冷色调"），前端静默重发当前预览图，后端只保留业务上下文，不持久化图片本体。
- **Lightroom 风格 UI**：填充式滑块、色彩编码 HSL 轨道、紧凑 22px 行高，还原专业调色体验。

### v0.1.6 重点更新

- **仓库清理**：删除未引用的重复 `use-toast` 文件与未使用的 placeholder 静态资源，减少仓库噪音。
- **生成产物回归本地缓存**：清理 `.next`、WASM build 目录与 backend 本地输出目录，避免把可重建产物当成长期工作区内容。
- **大体积候选保留待决**：`third_party/emsdk` 与历史 PDF 文档继续保留，不在本次 release 中强制移除。

### v0.1.5 重点更新

- **Session 架构重构**：Redis Session 仅保存 `image_fingerprint`、`revision`、参数、报告与意图历史；图片字节、临时 URL、文件路径均不再持久化。
- **微调合同升级**：`/api/refine` 切换为 `multipart/form-data`，前端会静默重发当前图片，后端对 `session_id + revision + image_fingerprint` 做 409 冲突保护。
- **限流升级**：Analyze / Refine / XMP 全部改为共享 Redis fixed-window 限流，Redis 异常时 `fail-open`，优先保证业务可用性。
- **XMP 更明确地无状态**：导出只依赖当前参数，可选接收 `session_id/revision` 元数据，但不会修改 Redis Session。

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
│                   │ Vision + Text │  │ 仅业务上下文    │  │
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
│   │   ├── param-slider.tsx    # Lightroom 风格填充式滑块
│   │   └── ai-diagnostic-report.tsx
│   ├── lib/
│   │   ├── api.ts              # SSE 流式 fetch 封装
│   │   ├── lightroom-params.ts # 60+ 参数定义（XMP 标准 Key）
│   │   └── image-analysis.ts   # JPG 数据轨真实分析（直方图/极值/断层/ICC）
│   ├── hooks/useRawParser.ts   # WASM Worker 生命周期管理
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
│       │   ├── prompt.ts       # System Prompt + 用户 Prompt
│       │   ├── redis.ts        # 共享 Redis client
│       │   ├── session.ts      # Session（仅业务上下文，不存图片）
│       │   ├── vision-source.ts # 视觉输入模式与请求级图片准备
│       │   ├── visionPreviewFiles.ts # 临时视觉预览图写入/清理
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

### 1. 初始化仓库与子模块

```bash
git clone <repo-url> Lumina && cd Lumina
git submodule update --init --recursive
```

### 2. 安装依赖（workspace）

```bash
pnpm install
```

### 3. 配置后端环境变量

```bash
cp backend/.env.example backend/.env
# 按需修改 OPENAI_API_KEY 等配置
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

---

## 🔧 环境变量

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `OPENAI_API_KEY` | LLM API Key | — |
| `OPENAI_BASE_URL` | API 代理地址 | `https://codeproxy.dev/v1` |
| `LLM_PROVIDER` | 手动指定 provider 策略（`dashscope` / `codeproxy` / `generic`），留空则按 `OPENAI_BASE_URL` 自动识别 | 自动识别 |
| `LLM_VISION_MODEL` | 首轮视觉模型 | `gpt-5.2` |
| `LLM_TEXT_MODEL` | 多轮文本模型 | `gpt-5.2` |
| `LLM_VISION_INPUT_MODE` | 视觉图片输入模式（`auto` / `data_url` / `public_url`） | `auto` |
| `REDIS_URL` | Redis 连接地址 | `redis://127.0.0.1:6379` |
| `SESSION_TTL` | Session 过期时间（秒） | `1800` |
| `VISION_PREVIEW_TTL_SECONDS` | 临时视觉预览图保留时间（秒） | `900` |
| `XMP_FILE_TTL_SECONDS` | XMP 文件有效期（秒） | `86400` |
| `ANALYZE_RATE_LIMIT_MAX` | Analyze 单 IP 窗口限额 | `12` |
| `ANALYZE_RATE_LIMIT_WINDOW_SECONDS` | Analyze 限流窗口（秒） | `300` |
| `REFINE_RATE_LIMIT_MAX` | Refine 单 IP 窗口限额 | `40` |
| `REFINE_RATE_LIMIT_WINDOW_SECONDS` | Refine 限流窗口（秒） | `300` |
| `XMP_RATE_LIMIT_MAX` | XMP 单 IP 窗口限额 | `60` |
| `XMP_RATE_LIMIT_WINDOW_SECONDS` | XMP 限流窗口（秒） | `300` |
| `PUBLIC_API_BASE_URL` | 视觉 provider 需要公网图片 URL 时使用的后端公网基础地址 | — |
| `CORS_ORIGINS` | 允许跨域来源（逗号分隔，支持 `*`） | `http://localhost:*,http://127.0.0.1:*` |
| `PORT` | 后端端口 | `3001` |
| `NEXT_PUBLIC_API_URL` | 前端连接后端地址 | `http://localhost:3001` |

> 注意：如果你使用的视觉 provider 不接受 `data:image/...;base64,...`，而是要求公网图片 URL，那么本地 `localhost` 环境本身并不足够。此时需要配置 `PUBLIC_API_BASE_URL` 为一个 provider 可访问的公网域名，或者切换到支持 data URL 的视觉 provider。
>
> DashScope 兼容模式下，后端会默认将首轮视觉模型回退为 `qwen-vl-plus`（若你未显式设置 `LLM_VISION_MODEL`），便于直接跑通视觉分析。

---

## 📐 API 接口

### `POST /api/analyze`

首次分析并创建 session（SSE 流式响应）。

- **Content-Type**: `multipart/form-data`
- **字段**:
  - `preview_image`(File)
  - `raw_data`(JSON)
  - `user_intent`(string)
  - `style`(string)
  - `image_fingerprint`(string, 前端基于当前预览图计算)
- **Final 事件**: `{ type:"final", session_id, revision, diagnostic_report, lightroom_params, download_url }`

### `POST /api/refine`

基于同一张图继续微调（SSE 流式响应）。

- **Content-Type**: `multipart/form-data`
- **字段**:
  - `session_id`
  - `revision`
  - `image_fingerprint`
  - `new_intent`
  - `preview_image`(前端静默重发当前图)
  - `raw_data`(可选)
- **错误语义**:
  - `404`: session 不存在或过期
  - `409`: `revision` 冲突或 `image_fingerprint` 不匹配
  - `422`: 当前 provider 需要视觉输入，但请求级图片准备失败

### `POST /api/xmp`

基于当前参数生成新的 XMP 下载链接，保持无状态。

- **Content-Type**: `application/json`
- **Body**: `{ lightroom_params, session_id?, revision? }`
- **响应**: `{ download_url }`

### `GET /downloads/:filename`

下载生成的 XMP 预设文件。

---

## 📄 License

MIT
