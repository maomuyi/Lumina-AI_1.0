# 🎨 Lumina — AI 智能调色助手

> 上传照片，AI 生成专业级 Lightroom 调色预设（.xmp），一键下载导入。

当前版本：`v0.1.1`（2026-03-03）

Lumina 通过**前端 WASM 深度解析 RAW 底层物理数据** + **多模态大模型双维推理**，生成精准的 Lightroom 调色参数，并输出专业的"AI 调色诊断报告"。

---

## ✨ 核心亮点

- **前端重解析**：基于 LibRaw WASM 在浏览器本地解码 NEF（14-bit RAW），提取线性直方图、宽容度余量、RGGB 通道偏移等物理数据，无需上传 45MB 原始文件。
- **双轨分析**：视觉轨（内嵌预览图 → 多模态大模型识别语义）+ 数据轨（物理特征 JSON → 约束调色参数边界）。
- **专业诊断报告**：四模块结构化报告（核心结论 → 底层剖析 → 美化建议 → 参数动作），兼顾小白与老手。
- **XMP 模板引擎**：Handlebars 模板注入法生成 100% 兼容 Lightroom 的 .xmp 预设，锁死 Adobe Color 基准 + 镜头校正。
- **多轮微调**：支持自然语言多轮对话（"肤色再亮一点"、"冷色调"），基于 Redis Session 复用上下文，无需重传图片。
- **Lightroom 风格 UI**：填充式滑块、色彩编码 HSL 轨道、紧凑 22px 行高，还原专业调色体验。

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
│       │   ├── session.ts      # Redis Session 管理
│       │   └── xmp.ts          # XMP 模板引擎
│       ├── utils/
│       │   ├── parseAI.ts      # 三层 JSON 解析防御
│       │   └── clampParams.ts  # 参数范围校验
│       └── templates/
│           └── BaseTemplate.xmp
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
| `OPENAI_BASE_URL` | API 代理地址 | `https://openai.linktre.cc/v1` |
| `LLM_VISION_MODEL` | 首轮视觉模型 | `gpt-5-2025-08-07` |
| `LLM_TEXT_MODEL` | 多轮文本模型 | `gpt-5-2025-08-07` |
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
