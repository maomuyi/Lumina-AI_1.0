# AI_CONTEXT.md — Lumina AI 调色项目必读指导书

> **所有参与本项目的 AI（Copilot、Cursor、Gemini 等）在生成任何代码前，必须先阅读本文件。**
> 本文档描述了系统的整体架构、前后端分工、数据流、以及已识别的工程瓶颈与对应解决方案。这是唯一的架构真相来源（Source of Truth）。

---

## 一、产品定位

Lumina 是一个 **AI 驱动的照片调色网页应用**，核心产物是 Lightroom `.xmp` 预设文件。用户上传照片（JPG 或 NEF 格式），AI 分析照片的视觉语义与底层物理光影数据，生成专业的调色方案并交付可直接导入 Lightroom 的预设文件。

---

## 二、系统整体架构（三层分工）

```
┌──────────────────────────────────────────────────────────────────┐
│  前端（Next.js）— "数据解包器"                                   │
│                                                                  │
│  ① 文件嗅探：识别 JPG / NEF                                     │
│  ② WASM 解析引擎（LibRaw）：在浏览器本地解码 NEF                │
│     ├─ 视觉轨：提取内嵌 preview.jpg（~1.5MB）                   │
│     └─ 数据轨：提取 RAW 物理数据 JSON（几KB）：                  │
│         • 真实线性直方图（256 bins）                             │
│         • 物理宽容度极值（shadow_survival_rate, clipping_rate） │
│         • RGGB 色彩通道乘数                                      │
│         • 深层 EXIF（ISO, 机型, 快门, 光圈）                    │
│  ③ 打包 POST 给后端：preview.jpg + raw_parsed_data.json + intent│
└──────────────────────────────────────────────────────────────────┘
                          ↓ POST /api/analyze
┌──────────────────────────────────────────────────────────────────┐
│  后端（Node.js / Python）— "业务网关与转换器"                    │
│                                                                  │
│  ① Session 管理：首次请求生成 session_id，缓存图片和物理数据    │
│  ② Prompt 组装：将物理数据 JSON 翻译成 LLM 可理解的提示词      │
│  ③ 调用 Vision-LLM API（SSE 流式接收）                         │
│  ④ JSON-to-XMP 引擎：模板注入法，生成合法的 .xmp 文件          │
│  ⑤ 上传 OSS（24h 过期），返回下载 URL + 诊断文本给前端         │
└──────────────────────────────────────────────────────────────────┘
                          ↓ 调用 Vision-LLM API
┌──────────────────────────────────────────────────────────────────┐
│  AI 推理层（Vision-LLM）— "大脑"                                │
│                                                                  │
│  输入：preview.jpg（视觉语义）+ RAW 物理数据 JSON               │
│  输出（严格 JSON 格式）：                                        │
│    ① diagnostic_report：四段式诊断文本（面向用户展示）          │
│    ② lightroom_params：Lightroom 参数键值对（面向程序解析）     │
└──────────────────────────────────────────────────────────────────┘
```

### 核心设计原则

- **前端重解析**：NEF 文件（20~80MB）绝不整体上传云端，所有解码在浏览器本地完成，只上传精华数据（<2MB）。
- **后端轻传输**：后端不做图像处理，只负责 Prompt 组装、LLM 调度、JSON-to-XMP 转换。
- **AI 受物理数据约束**：LLM 的调色参数输出由物理数据（而非主观臆断）严格约束。

---

## 三、核心业务流程

```
Step 1：用户拖入 NEF/JPG
         ↓ WASM 本地解码（进 Worker 线程，不阻塞 UI）
Step 2：双轨产出 → POST 给后端
         ↓
Step 3：后端组 Prompt → 调用 Vision-LLM（SSE 流式回传）
         ↓ 前端实时渲染诊断文字（打字机效果）
Step 4：LLM 输出完整 → 后端解析 JSON → 模板注入 → 生成 .xmp → 上传 OSS
         ↓
Step 5：前端展示完整诊断报告 + 【下载 .xmp 预设】按钮
         ↓
Step 6：用户多轮自然语言微调（携带 session_id，不重传图片）
         ↓ 后端从 Session 缓存取图，降级为 Text-only LLM（不再传图）
        重复 Step 4~5
```

---

## 四、已识别的工程瓶颈与解决方案

> ⚠️ **编写任何涉及以下模块的代码时，必须按照本节的方案执行，不得走回头路。**

---

### 🔴 瓶颈 1：Vision-LLM API 延迟（P99 可达 15~20s）

**根本原因**：LLM 推理是不可消除的硬延迟；多轮对话时 Token 消耗线性增长。

**必须执行的方案**：

#### 1A. 流式输出（SSE）— 所有 LLM 调用必须走 Streaming

后端用 SSE 把 `diagnostic_report` 文字流式推给前端，`lightroom_params` JSON 等完整再解析。

```
前端协议约定：
  data: {"type":"text","content":"检测到画面为逆光人像..."}  ← 实时渲染
  data: {"type":"text","content":"高光边缘有轻微溢出..."}
  data: {"type":"final","lightroom_params":{...}}             ← 触发 XMP 生成
```

#### 1B. 模型分层调度 — 微调轮次禁止传图

| 场景 | 调用的模型 | 是否传图 |
|------|-----------|---------|
| 第一轮（首次分析）| Vision-LLM（如 GPT-4o） | ✅ 是 |
| 多轮微调（改风格）| Text-only LLM（快 3~5x） | ❌ 否 |

#### 1C. Prompt 中 `linear_histogram` 降采样

256 bins 数组对 LLM 无意义的精度冗余，降为 **64 bins** 发送，Token 节省 75%。

```javascript
// 前端打包数据时执行
function downsampleHistogram(histogram256) {
  const result = [];
  for (let i = 0; i < 256; i += 4) {
    result.push(histogram256[i] + histogram256[i+1] + histogram256[i+2] + histogram256[i+3]);
  }
  return result; // 长度 64
}
```

---

### 🔴 瓶颈 2：WASM 冷启动 + 主线程阻塞 + 内存 OOM

**根本原因**：LibRaw WASM 体积 1~5MB 首次慢；矩阵计算 CPU 密集会卡 UI；45MB NEF 解码后内存可达 200MB。

**必须执行的方案**：

#### 2A. 所有 WASM 计算必须在 Web Worker 中执行（不得在主线程运行）

```javascript
// ✅ 正确写法：主线程委托给 Worker
// workers/raw-parser.worker.js 负责所有 LibRaw WASM 操作
const worker = new Worker('/workers/raw-parser.worker.js');
worker.postMessage({ type: 'PARSE_NEF', buffer: fileArrayBuffer });
worker.onmessage = ({ data }) => {
  if (data.type === 'PROGRESS') updateLoadingText(data.text);
  if (data.type === 'DONE')     sendToBackend(data.result);
};

// ❌ 禁止写法：在主线程直接调用 WASM 解析
const result = await LibRaw.parse(fileArrayBuffer); // 会卡死 UI
```

#### 2B. WASM 模块在页面打开时就后台预加载

```html
<!-- index.html / layout.tsx 的 <head> 中 -->
<link rel="preload" href="/wasm/libraw.wasm" as="fetch" crossorigin>
```

```javascript
// 页面初始化时静默预热，不阻塞主流程
let wasmReady = initLibRawWASM().then(() => true);
```

#### 2C. 大文件内存安全检查（防 OOM）

```javascript
const SAFE_LIMIT_BYTES = 80 * 1024 * 1024; // 80MB

if (file.size > SAFE_LIMIT_BYTES) {
  // 降级：只提取 EXIF + 内嵌预览图，物理数据用保守估算
  // 并在发给后端的 JSON 中标注 data_quality: "lite"
  return await parseLiteMode(file);
}
return await parseFullMode(file);
```

---

### 🟡 瓶颈 3：多轮微调重复传图（每次 ~2MB）

**根本原因**：后端无状态，每次微调都要重传图片和物理数据。

**必须执行的方案**：后端 Session + Redis 缓存

```
POST /api/analyze（首次）
  Body: { preview_image, raw_data, user_intent }
  Response: { session_id: "sess_abc123", diagnostic, download_url }
             ↑ 后端同时将 image & raw_data 存入 Redis（TTL 30min）

POST /api/refine（微调，轻量）
  Body: { session_id: "sess_abc123", new_intent: "冷色调一点" }
  Response: { diagnostic, download_url }
             ↑ 后端从 Redis 取图，不需要前端重传
```

> **规则**：任何调用 `/api/refine` 的代码，前端都不得在请求体中附带图片数据。

---

### 🟡 瓶颈 4：XMP 手动导入的体验断层

**根本原因**：用户下载 XMP 后还需手动打开 Lightroom 导入，操作摩擦大，流失风险高。

**分阶段解法**：

| 阶段 | 方案 | 备注 |
|------|------|------|
| MVP | 分端操作引导（Mac/Win/手机）+ XMP 文件名含风格标签 | 如 `Lumina_Portrait_Warm_20260303.xmp` |
| V1.5 | 调研 `lightroom://` URL Scheme 一键自动导入 | 需验证兼容性 |
| V2.0 | Adobe Lightroom API OAuth 直接同步预设至云端 | 最终形态 |

---

### 🟢 瓶颈 5：LLM JSON 输出解析脆弱

**根本原因**：Prompt 要求纯 JSON，但 LLM 有时输出 markdown 包裹的 JSON（`\`\`\`json ... \`\`\``），导致 `JSON.parse` 崩溃。

**必须执行的方案**：三层防御解析 + 参数范围校验

```javascript
// 所有 LLM 返回体必须经过此函数处理，禁止直接 JSON.parse(rawText)
function safeParseAIResponse(rawText) {
  // 第一层：直接解析
  try { return JSON.parse(rawText); } catch {}

  // 第二层：提取 ```json ... ``` 代码块
  const mdMatch = rawText.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (mdMatch) { try { return JSON.parse(mdMatch[1]); } catch {} }

  // 第三层：提取最外层 { ... } 对象
  const objMatch = rawText.match(/(\{[\s\S]*\})/);
  if (objMatch) { try { return JSON.parse(objMatch[1]); } catch {} }

  // 全部失败 → 降级为默认预设，记录错误日志
  console.error('[AI Parse Failed]', rawText.slice(0, 200));
  return DEFAULT_SAFE_PRESET;
}

// 解析后校验关键参数范围，防止越界值写入 XMP
function clampLightroomParams(params) {
  const BOUNDS = {
    Exposure2012: [-5, 5], Highlights2012: [-100, 100],
    Shadows2012: [-100, 100], Whites2012: [-100, 100],
    Blacks2012: [-100, 100], Clarity2012: [-100, 100],
    Vibrance: [-100, 100], Temperature: [2000, 50000],
  };
  for (const [key, [min, max]] of Object.entries(BOUNDS)) {
    if (key in params) params[key] = Math.max(min, Math.min(max, Number(params[key])));
  }
  return params;
}
```

> **强烈推荐**：在调用 LLM 时启用官方 **Structured Output / JSON Mode**（OpenAI、Gemini 均支持），从 API 层强制格式合规，是比 Prompt 约束更可靠的工程解法。

---

## 五、LLM System Prompt 核心约束（摘要）

LLM 必须遵循 **"一级校准 → 二级光影 → 三级色彩 → 四级质感"** 工业流水线，且强制执行以下物理约束：

| 约束 | 触发条件 | 强制行为 |
|------|---------|---------|
| 肤色防御 | 画面含人脸/人像 | 禁用全局 Saturation，改用 Vibrance；SaturationAdjustmentOrange ∈ [-10, +5] |
| 高光矩阵 | `highlight_clipping_rate > 0.05` | 禁止 Highlights < -50；改用曲线调节白点 |
| 信噪比防御 | `ISO >= 1600` 或 `shadow_survival_rate < 0.90` | 强制开启 LuminanceSmoothing >= 20；禁止 Dehaze > 0 |
| JPG 降级防御 | `file_type == "JPG"` 或 `bit_depth == 8` | Shadows2012 最大 +40；banding_risk=high 时开颗粒 >= 20 |
| 色彩空间防御 | P3 色域 | Vibrance 参数保守输出，防止过饱和 |

---

## 六、技术栈

| 层 | 技术 |
|----|------|
| 前端 | Next.js + TypeScript + WebAssembly (LibRaw) + Web Worker |
| 后端 | Node.js（或 Python FastAPI） |
| Session 缓存 | Redis（TTL 30min） |
| 文件存储 | 云端 OSS（XMP 文件 24h 过期） |
| AI 模型 | Vision-LLM（首轮）+ Text-only LLM（多轮微调） |
| XMP 生成 | 字符串模板注入法（BaseTemplate.xmp + Handlebars/Jinja2） |

---

## 七、禁止事项（Do NOT）

- ❌ 禁止在主线程直接调用 WASM / LibRaw 解析
- ❌ 禁止使用 `xml2js` 或 DOM 解析库拼接 XMP 文件（破坏 Adobe 命名空间）
- ❌ 禁止在 `/api/refine` 请求中重传图片数据
- ❌ 禁止直接 `JSON.parse()` LLM 的原始返回文本，必须经过三层防御函数
- ❌ 禁止把完整的 45MB NEF 文件上传到云端
- ❌ 禁止 LLM System Prompt 中允许写局部蒙版参数（渐变滤镜、AI 选区）

---

*最后更新：2026-03-03 | 基于 V0.1.0 AI 调色 MVP 版本架构文档*
