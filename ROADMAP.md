# Lumina ROADMAP

> Lumina 是 AI 驱动的 Lightroom 调色预设生成器，**不替代 Lightroom，不维护厂商色彩渲染，不承诺网页端最终成片**。专注生成专业、可解释、可导入、可微调的 XMP 调色方案。
>
> 本文档实地审视项目状态后于 v0.1.5 → v0.2.0 阶段重写，并于 2026-05-10 按当前代码、测试、CI、调色助手 QA 与官方模型文档再次校准。同事/Cursor/Claude 进项目看一份就够。

---

## §0 产品原则（红线）

### 0.1 做什么

- 读取照片内容与基础影像数据
- 理解用户想要的风格方向（自然语言意图 / 风格预设 / 参考图）
- 生成 Lightroom 可识别、可导入、可继续微调的 XMP 预设
- 用诊断报告解释为什么这样调
- 用轻量预览帮助用户判断方向

### 0.2 不做什么

| 项 | 原因 |
|---|---|
| 不做完整网页 RAW viewer | 厂商 / process version / ICC profile 维护无底洞 |
| 不复刻 Lightroom 真实渲染 | 看起来越像，用户期望落差越大 |
| 不维护厂商色彩 profile | Canon/Nikon/Sony/Fuji 色彩调教差异维护成本极高 |
| 不做在线最终修图 | 与 MVP 目标不匹配 |
| 不做开放式 AI 聊天 | 调色助手必须落到参数变化，不闲聊 |
| 不维护大规模本地预设库 | 走纯 LLM + web 搜索路径，预设交给 AI 找 |

### 0.3 模块边界

| 模块 | 定位 | 是否最终效果承诺 |
|---|---|---|
| **XMP 预设** | 正式交付物 | ✅ 是 |
| **AI 诊断报告** | 参数解释层 | ✅ 解释逻辑必须可信 |
| **网页效果预览** | 风格方向参考 | ❌ 否 |
| **Lightroom 渲染结果** | 用户最终使用效果 | ✅ 由 Lightroom 完成 |

---

## §1 已落地（v0.1.5 至本次审视）

### 1.1 工程稳定性

- [x] `third_party/emsdk` 从 git 移除（`.gitignore` + `build.sh` 自动 clone）
- [x] WASM 加 `params.half_size = 1`，45MP NEF 内存峰值 340MB → 85MB
- [x] WASM unpack 失败降级（仍能返回预览 + EXIF）
- [x] backend `previewImageBase64` 改 `Buffer` 透传，base64 仅在 fetch JSON 内联编码（`asBase64()`）
- [x] vitest + 53 个后端单测（parseAI / localAnalyzer / clampParams / llmConfig / styleSearch / styleParamEnhancer / referenceColorMatch）
- [x] Playwright smoke + 2 个前端 e2e（参考图追色链路、调色助手窄屏/失败保护）
- [x] GitHub Actions CI 已接入 backend tests + frontend Playwright smoke
- [x] center-canvas.tsx 1101 → 698 行；抽 `diagnostics-panel.tsx` / `lib/canvas-utils.ts` / `hooks/useAnalyzeFlow.ts`
- [x] XMP 下载从纯内存结果扩展为 `/api/xmp` + `/downloads/:filename` 静态下载，带 TTL 清理

### 1.2 风格识别基础设施（v0.1.5 新增）

- [x] **LLM 双通道架构** —— `TEXT_API_KEY`（默认 DeepSeek）+ `VISION_API_KEY`（默认 OpenAI），分流调度
- [x] **`backend/src/services/styleSearch.ts`** —— 风格联网搜索，DuckDuckGo 默认 provider，Redis 缓存（默认 7 天 TTL）
- [x] **`backend/src/services/styleContext.ts`** —— 从搜索结果推断 visual_traits / lightroom_biases / hsl_tendencies
- [x] **`backend/src/services/styleIntent.ts`** —— 判断"是否需要联网搜风格"（"亮一点"不搜、"想要王家卫感"才搜）
- [x] **`backend/src/services/styleParamEnhancer.ts`** —— 关键字增强器（黑白/小红书清透/电影感等）
- [x] **`backend/src/services/refineChanges.ts`** —— refine 变更追踪
- [x] **`frontend/lib/refine-history.ts`** —— 调色助手版本管理数据结构
- [x] **`frontend/lib/reference-color-match.ts`** —— 参考图追色 L1（LAB mean/std）+ L2（HSL 8 通道）实现
- [x] 测试：`llmConfig.test.ts` / `styleSearch.test.ts` / `styleParamEnhancer.test.ts` / `referenceColorMatch.test.ts`

### 1.3 调色助手 / 参考图 UI（v0.2.0 主体已落地）

- [x] 右栏主标题改为「调色助手」，并加入当前版本、引擎、文件类型、参考图状态等 context chips
- [x] 调色助手时间线：V1 初始方案 + V2/V3... 微调版本
- [x] refine 返回 `changed_params` 后，UI 已渲染本轮参数 diff
- [x] 支持上一版 / 下一版 / 选择任意版本，并同步恢复参数、下载链接与修改高亮
- [x] 每个版本保存诊断报告 snapshot，切换/撤回/前进时同步恢复 report
- [x] IndexedDB 持久化最近 50 个 refine 版本，默认 7 天 TTL
- [x] 每个版本独立下载 XMP（V1 与 refine 版本都保存 `downloadUrl`）
- [x] `quick_chips` 已接入时间线建议按钮
- [x] refine 失败时回滚临时状态并保留原版本链，toast 明确提示“当前版本未被覆盖”
- [x] 调色助手时间线完成 760px 窄屏 Playwright QA，版本按钮/diff 行已做防挤压处理
- [x] 左栏已加入「参考风格」槽位：JPG / PNG / NEF，参考图存在时风格预设 chip 自动禁用
- [x] 参考图追色全程前端本地完成：LAB mean/std + HSL 8 通道，融合后重新生成 XMP
- [x] 匹配强度滑条已接入，默认 70%

### 1.4 调用链现状

```
analyze 流程：
  vision LLM 已配置？─ Y → streamVisionAnalysis(VISION_MODEL；默认 gpt-5-2025-08-07) → enhanceParamsForStyleIntent
                    └ N → buildLocalAnalysis → enhanceParamsForStyleIntent → final
  参考图 ready？────── Y → 前端本地 analyzeReferenceColorMatch → blendReferenceMatchParams → /api/xmp 重新生成下载文件
                    └ N → 使用 analyze 返回的 XMP

refine 流程：
  text LLM 已配置？─ Y → shouldSearchStyleContext？─ Y → searchStyleContext (web)
                                                  └ N → 直接走
                       → streamTextRefine(DeepSeek V4) → enhanceParamsForStyleIntent → changedParams/history/final
                  └ N → buildLocalRefine → enhanceParamsForStyleIntent → final
```

---

## §2 P0 必修（紧急 BUG，本周内）

### 2.1 🟡 校准 LLM 默认模型与文档（DeepSeek 部分已确认）

**模型判断（2026-05-09 校准，后续仍以 smoke test 为准）**：

模型依据：[DeepSeek List Models](https://api-docs.deepseek.com/api/list-models) / [DeepSeek V4 发布说明](https://api-docs.deepseek.com/news/news260424)、[OpenAI 模型文档](https://platform.openai.com/docs/models)。模型名属于外部服务，后续仍以 smoke test 为准。

`backend/src/services/llm.ts:22-23` 当前默认值是：

```ts
const DEFAULT_TEXT_MODEL = 'deepseek-v4-flash'
const DEFAULT_VISION_MODEL = 'gpt-5-2025-08-07'
```

这条 Roadmap 之前的判断已经过期：

- `deepseek-v4-flash` 是 DeepSeek 官方当前模型名之一，应保留；不要再改回 `deepseek-chat`。`deepseek-chat` / `deepseek-reasoner` 只是兼容别名，官方说明会路由到 V4 Flash，并计划在 2026-07-24 之后停用。
- `gpt-5-2025-08-07` 已不是“未发布模型”。但当前开发者只有 DeepSeek key，因此 `VISION_API_KEY=` 留空即可；首轮 analyze 会自动走本地规则引擎，不会阻塞 DeepSeek refine。
- 若后续接 OpenAI 多模态 key，优先按当时官方 `/models` 与 smoke test 决定 `VISION_MODEL`；新项目可评估 `gpt-5.2`，旧 snapshot 先不作为 P0 强改。

**当前最小策略**：

```env
TEXT_API_KEY=sk-xxx
TEXT_BASE_URL=https://api.deepseek.com
TEXT_MODEL=deepseek-v4-flash

VISION_API_KEY=
VISION_BASE_URL=https://api.openai.com/v1
VISION_MODEL=gpt-5-2025-08-07
```

**已完成**：

- [x] `.env.example` / README / `llm.ts` 文本模型已保持 `deepseek-v4-flash`
- [x] 文本与视觉 key 已拆成 `TEXT_API_KEY` / `VISION_API_KEY`，旧 `OPENAI_API_KEY` 不再误触发
- [x] `VISION_API_KEY` 为空时，analyze 自动降级本地规则；`TEXT_API_KEY` 可单独驱动 refine
- [x] DeepSeek V4 默认关闭 thinking（除非 `TEXT_ENABLE_THINKING=true`），避免结构化 JSON 输出变长

**还要做**：

- [ ] 后端启动日志打印当前 LLM channel 状态：text configured/model/baseURL、vision configured/model/baseURL（不要打印 key）
- [ ] 手动 smoke：`curl "$TEXT_BASE_URL/models"` 能看到 `deepseek-v4-flash`
- [ ] 手动 smoke：`/chat/completions` 指定 `deepseek-v4-flash` 返回 200，响应 `model` 字段匹配
- [ ] 有 OpenAI key 后，再 smoke `VISION_MODEL`；没有 key 时保持空，不把视觉模型当 P0 blocker

**注意**：风格差异过小的根因目前更像 §2.2 的本地风格 profile 强度不足，而不是 DeepSeek 模型名错误。

### 2.2 ✅ 风格预设系统打磨（已完成）

**原问题分解**（基于实测，现已修复）：

| 病灶 | 已修复位置 | 原后果 |
|---|---|---|
| `STYLE_HINTS` 强度过弱（japanese/film/cyberpunk/grey/cinematic 都只动少数字段，强度 ±10–25） | `localAnalyzer.ts` 的 `STYLE_PROFILES` | 5 风格之间最低差异量曾只有 62 |
| `applyStyle` 用 `mergeParam` 累加而非覆写 | `localAnalyzer.ts` 的 `applyStyle` | baseline 占主导，风格被稀释 |
| Temperature/Tint/Whites/Texture 全风格一致 | `STYLE_PROFILES` 已覆盖白平衡、明暗、质感、HSL、Split Toning、Grain | 用户最敏感的色温感知零差异 |
| `buildLocalRefine` 用 0.72/0.28 混合 | `localAnalyzer.ts` 的 `buildLocalRefine` | 一次 "再冷一点" 只动 28%，看不出 |
| `enhanceParamsForStyleIntent` 强度温和、覆盖度有限 | 仍保留为关键字增强补丁；主风格差异交给 `STYLE_PROFILES` | 增强补丁仅在某些关键字命中 |

**已完成实现**：

#### 2.2.1 `STYLE_HINTS` 已升级为 `STYLE_PROFILES`（覆盖完整）

每个风格涵盖 Temperature/Tint/Exposure/全 HSL/SplitToning/Grain，强度上调到 v0.1.4 的 1.8-2.5×。

```ts
// 例子：cyberpunk profile
{
  Temperature: 4400, Tint: 18,
  Contrast2012: 32, Highlights2012: -40, Shadows2012: 22,
  Blacks2012: -28, Whites2012: 15,
  Vibrance: 36, Dehaze: 12,
  SaturationAdjustmentBlue: 38, SaturationAdjustmentMagenta: 32,
  SplitToningShadowHue: 200, SplitToningShadowSaturation: 28,
  SplitToningHighlightHue: 320, SplitToningHighlightSaturation: 22,
}
```

#### 2.2.2 `applyStyle` 已改为加权覆写

```ts
function applyStyle(params, style, strength = 1.0) {
  const profile = STYLE_PROFILES[style]
  for (const [key, target] of Object.entries(profile)) {
    const current = params[key] ?? 0
    params[key] = current * (1 - strength) + target * strength
  }
}
```

#### 2.2.3 `buildLocalRefine` 混合权重已从 0.72/0.28 改为 0.30/0.70

```ts
nextParams[key] = current * 0.30 + value * 0.70
```

一次"再冷一点"挪 70% 差值，视觉立刻可感。

**验收**：

- [x] 5 风格之间最低差异量 > 800（backend test 已锁定；当前最低约 810）
- [x] 同一张 NEF + film vs cyberpunk 参数层明显区分（差异量 > 2000；视觉仍以 Lightroom 导入为准）
- [x] refine "再冷一点" 一次后 Temperature 至少下降 300K
- [x] `backend/tests/localAnalyzer.test.ts` 已覆盖风格差异与 refine 色温变化回归

### 2.3 🟡 重编 WASM 让 `half_size=1` 生效（已完成 ✅）

参见 §1.1。如需重编：

```bash
cd "/Volumes/Extreme SSD/Lumina-AI_1.0 /frontend/wasm"
./build.sh
```

### 2.4 🟢 测试与 lockfile 状态（已通过，CI 已接）

```bash
PATH=/private/tmp/codex-pnpm-bin:/Users/ember/.local/node/bin:$PATH pnpm --filter lumina-backend test
PATH=/private/tmp/codex-pnpm-bin:/Users/ember/.local/node/bin:$PATH pnpm --filter lumina-frontend test:e2e
```

当前本地结果：

- [x] 7 个 test files passed
- [x] 53 个 tests passed
- [x] `llmConfig.test.ts` 已覆盖 TEXT / VISION key 分离与 placeholder 忽略
- [x] 2 个 Chromium Playwright smoke passed
- [x] lockfile 已随 `@playwright/test` 与 workspace scripts 更新

已完成补齐：

- [x] 把 `pnpm --filter lumina-backend test` 接 CI / PR check（`.github/workflows/ci.yml`）
- [x] CI 增加 `frontend-smoke` job：安装 Chromium 并执行 `pnpm --filter lumina-frontend test:e2e`
- [x] 前端 UI Playwright smoke（目标图上传、参考图上传、强度调整、参考图追色 XMP 生成）

### 2.5 🟡 清理 macOS 噪音文件（git 已忽略，工作区仍有残留）

```bash
find . -name "._*" -not -path "*/node_modules/*" -not -path "*/.next/*" -delete
echo "._*" >> .gitignore
```

当前状态：

- [x] `.gitignore` 已包含 `._*`
- [ ] 工作区仍存在大量 AppleDouble 残留（包括 `backend/tests/._*.ts`、`backend/dist/._*`、`尼康预设/._*`）。它们已被忽略，但发布/打包前建议清一次。

---

## §3 v0.2.0：调色助手 V2 收尾（QA/小修已完成）

### 3.1 已完成

- [x] `frontend/lib/refine-history.ts` 数据结构（含瘦身的 changedParams diff）
- [x] `backend/src/services/refineChanges.ts` 后端变更追踪
- [x] `searchStyleContext` 联网搜索风格上下文（refine 路径已接入）
- [x] `enhanceParamsForStyleIntent` 关键字增强（analyze + refine 双路径）
- [x] 右栏主标题已改为「调色助手」
- [x] refine 完成后 UI 渲染 `changedParams` diff
- [x] 支持上一版 / 下一版 / 选择任意版本
- [x] 选择/撤回/前进版本时同步恢复参数、下载链接、修改高亮与诊断报告 snapshot
- [x] IndexedDB 持久化最近 50 版，默认 7 天 TTL
- [x] 每个版本独立下载 XMP
- [x] 快捷 chip 已按后端 `scene_label` / `quick_chips` 接入
- [x] 参数滑块有 AI 推荐点与本轮修改闪烁高亮
- [x] refine 失败时保留原版本链，不覆盖当前版本
- [x] 调色助手 760px 窄屏时间线已通过 Playwright 溢出检查

### 3.2 已完成（QA 小修）

- [x] **tab 文案**：已从 "Chat" 改为「调色助手」（`right-panel.tsx`）
- [x] 版本时间线做一次移动端/窄屏截图检查，避免 diff 行和按钮挤压（Playwright 760px 窄屏截图 + 溢出检查）
- [x] refine 失败时保留原版本链，并在 toast 中说明“当前版本未被覆盖”
- [x] 版本恢复后，完整诊断报告目前仍显示最近一次 report；已决定并实现每版保存 report snapshot

### 3.3 进阶（v0.2.0-beta）

- [x] 参数滑块旁高亮本轮修改
- [x] V1 / V2 / V3 时间线视图
- [x] 一键恢复任意历史版本
- [ ] 参数并排对比视图（真正的 diff table，不只是时间线摘要）
- [ ] 风格强度滑条：弱 / 中 / 强（与 §2.2.2 的 strength 联动）
- [ ] AI 自动推荐下一步微调方向（DeepSeek 在 SSE 里追加 next_suggestions 数组）

### 3.4 验收

- 导入 Lightroom 不报错
- 默认参数不污染照片
- 微调后重新生成的 XMP 下载正常
- 不同风格之间有明显但不过度的差异（与 §2.2 一起验收）
- 撤回上一版后下载按钮指向上一版的 XMP
- V1 → V2 → 上一版 → 下一版，参数面板、下载链接、修改高亮全部同步

当前自动化覆盖：

- [x] backend 单测覆盖风格差异、refine 参数变化、变更追踪
- [x] Playwright 覆盖 V1 生成、参考图追色 XMP、调色助手窄屏、refine 失败保护

---

## §4 v0.2.0：参考图追色（主体已接入，需验收）

### 4.1 已完成

- [x] `frontend/lib/reference-color-match.ts` —— L1（LAB mean/std）+ L2（HSL 8 通道）实现
- [x] `referenceColorMatch.test.ts` —— 算法层单测
- [x] 左侧栏 UI 已加「参考风格」槽位
- [x] 参考图支持 JPG / PNG / NEF；NEF 复用 `useRawParser`，JPG/PNG 用 `createImageBitmap`
- [x] 参考图存在时风格预设 chip 变灰，并提示「由参考图接管」
- [x] 匹配强度滑条 0–100%，默认 70%
- [x] analyze 后在前端本地执行追色融合，必要时调用 `/api/xmp` 重新生成下载文件
- [x] 诊断报告追加「本地参考图追色」步骤与 `ReferenceMatch` core action
- [x] UI 已写隐私承诺：参考图仅用于本地色彩特征提取，不上传服务器

### 4.2 未完成 / 待验收

- [ ] 真实图片验收：日落 / 黑白 / 高饱和霓虹 / 人像肤色四组样例
- [x] Playwright UI smoke：上传目标图 → 上传参考图 → 调整强度 → 生成 XMP
- [ ] 移动端/窄屏检查：参考图卡片、强度滑条、风格 chip 禁用态不挤压（右栏调色助手 760px 已验收；左栏参考图区域仍需单独验收）
- [ ] 参考图追色只作用于首轮 analyze；是否支持 refine 后继续保留参考图约束，需要产品决策
- [ ] 隐私文案可再补一句“不会上传参考图原图”，当前文案已经表达“不上传服务器”

### 4.3 隐私承诺

UI 最终文案建议写：

```
参考图仅用于色彩特征提取（LAB/HSL 统计），不会上传服务器，全程在浏览器内完成。
```

技术上：参考图原图只留在浏览器侧，不随 analyze/refine 请求上传后端；颜色统计完成后释放 ImageBitmap。

当前实现细节：JPG/PNG 的 `ImageBitmap` 会在颜色统计函数里 `close()`；NEF 路径先提取内嵌预览 Blob，再作为前端本地追色输入。参考图 Blob 不发给 backend，只有融合后的 Lightroom 参数会用于 `/api/xmp`。

### 4.4 验收

- 参考图为日落黄昏照 → 目标图 Temperature 拉到 6500+
- 参考图为黑白照 → 目标图 Saturation 接近 -100
- 强度=50% 时介于参考图和原始 baseline 之间

---

## §5 工程加固（按需做）

### 5.1 page.tsx 切换到 `useAnalyzeFlow`（4–6 小时）

`hooks/useAnalyzeFlow.ts` 已写完含详细集成注释，但 `page.tsx` 在接入调色助手 / 参考图后仍承载大量状态与流程控制。建议在 UI QA 稳定后再切，避免把功能 bug 和架构迁移混在一起。

### 5.2 抽 `@lumina/core` workspace（半天）

```
packages/core/src/
  ├─ localAnalyzer.ts
  ├─ parseAI.ts
  ├─ clampParams.ts
  ├─ styleParamEnhancer.ts    ← 也搬过来，与前端共用
  ├─ refineChanges.ts
  └─ prompt.ts (仅 type)
```

**收益**：前端可直接 `import { buildLocalAnalysis } from '@lumina/core'`，**本地引擎模式不再需要 backend**，整个 app 退化成纯 Next.js → **直接 Vercel 一键部署**。

### 5.3 删 47 个僵尸 shadcn/ui 组件（30 分钟）

```bash
npx knip
```

实际用 ~10 个，删完跟 30+ 个 `@radix-ui/*` 一起 rm，bundle 估减 200-300KB JS。

### 5.4 SSE 加 AbortController（20 分钟）

`frontend/lib/api.ts` 的 `analyzeWithSSE` / `refineWithSSE` 加 `signal?: AbortSignal`。组件 unmount 时 `abort()`，避免后端继续烧 token。

### 5.5 Redis 永久 disable 修复（10 分钟）

`backend/src/services/session.ts:73` 改时间窗口重试：

```ts
let redisDisabledUntil = 0
function disableRedis(err) {
    redisDisabledUntil = Date.now() + 60_000  // 60s 重试窗口
    if (redis) { redis.disconnect(); redis = null }
}
```

### 5.6 Lightroom 参数白名单（半天）

明确白名单来源：`backend/templates/LightroomPresetStandard.xmp` 是 Lightroom Classic 官方导出的反推产物。

- [ ] `clampParams.ts` 把白名单 import 自模板解析
- [ ] 加 ToneCurve 数组校验（[0,0]→[255,255] 单调递增）
- [ ] 未知字段进入 quarantine list，记 log 不写 XMP
- [ ] XMP snapshot test：`generateXMP(fixtures)` 输出与 `expected_*.xmp` diff

### 5.7 诊断报告加 Reachability 标签（1 天）

```ts
type Reachability = 'good' | 'limited' | 'unreachable'
```

高光物理失能 95% 时不要给 `Highlights2012: -100`，应输出 `unreachable` + "建议下次拍摄 -1EV"。

### 5.8 文案集中化（i18n 准备，1 天）

把所有 UI 文案抽到 `frontend/lib/i18n/zh-CN.ts`，未来加英文版只需 `en-US.ts` 一份。

### 5.9 「近似预览」视觉表达（1 小时）

ⓘ 图标 + tooltip + Lumina vs LR 实际导入对比图（一次性截图，非动态）。

---

## §6 上线前红线（部署到公网必做）

### 6.1 Rate Limit

`/api/analyze` + `/api/refine` 双键限流：IP（5 req/min）+ sessionId（20 req/h）。
- Vercel：`@vercel/edge-config` + Edge Function
- 自建：`@fastify/rate-limit`

### 6.2 敏感图过滤

上传图片前用 `nsfwjs`（4MB 模型，纯本地）过一遍：

```ts
const { className, probability } = topPrediction
if (className === 'Porn' && probability > 0.7) reject('图片不符合使用条款')
```

合规性：避免色情/暴力图被分析后产生法律风险。

### 6.3 用户协议 / 隐私政策

特别是涉及"参考图永不上传"承诺时——必须有明确 ToS / Privacy Policy 链接。

### 6.4 前端错误兜底

- [ ] `app/error.tsx` 全局错误边界
- [ ] `app/not-found.tsx` 404
- [ ] Sentry 接入（见 §7.1）

### 6.5 LLM key 管理

- [ ] 后端 `.env` 不要明文 commit（加 git pre-commit hook 检查）
- [ ] 生产环境用 Vercel Secrets / Railway Env / 1Password CLI 注入
- [ ] 加 fallback：`TEXT_API_KEY` / `VISION_API_KEY` 只要任一可用就能跑

---

## §7 长期 roadmap

### 7.1 性能 / 工程

| 项 | 工时 | 说明 |
|---|---|---|
| WASM 关闭 SINGLE_FILE + Service Worker 预缓存 `.wasm` | 半天 | 首屏 -1.5s |
| 同 NEF 文件 hash → IndexedDB 缓存物理数据 | 半天 | 重传秒回 |
| 接 Sentry / OpenTelemetry | 半天 | 线上可观测 |
| 接 PostHog / Plausible | 半天 | 用户行为分析 |

### 7.2 产品力

| 项 | 工时 | 说明 |
|---|---|---|
| 支持 CR2/CR3/ARW/RAF/DNG | 1 天 | LibRaw 已支持，前端类型放开。**用户群 ×3** |
| 导出 `.cube` LUT（非仅 XMP） | 半天 | 扩展到 FCP/Davinci/Resolve/OBS 用户 |
| 批量上传 + 一键套同风格 | 1 天 | 摄影师刚需 |
| PWA + 离线模式 | 半天 | 前提：§5.2 `@lumina/core` 完成 |
| Lightroom 导入指引视频/图文 | 半天 | 降低新手门槛 |
| 风格联网搜索升级到 Brave/Tavily（替换 DuckDuckGo） | 半天 | 搜索质量提升 |

### 7.3 待评估

| 项 | 状态 | 说明 |
|---|---|---|
| WebGL/WebGPU LUT 真实预览 | ⚠️ **待决策** | §0 原则说"预览越真实，误解风险越高"。决策点：要不要从 CSS filter 升级。建议**先做 §5.9 视觉表达优化**，3 个月后看用户反馈再定 |
| Adobe OAuth / 云同步 | ⚠️ 调研 | 直接把 XMP 推到用户 Adobe Cloud Library |
| AI 生成式最终成片 | ❌ 不做 | 与 §0.2 红线冲突 |
| 维护本地预设库 30+ | ❌ 不做 | 已选纯 LLM + web 搜索路径 |

---

## §8 不做清单（产品边界）

- ❌ 不做完整 RAW viewer
- ❌ 不复刻 Lightroom 真实渲染
- ❌ 不维护厂商色彩 profile
- ❌ 不做在线最终修图
- ❌ 不做开放式 AI 聊天
- ❌ 不做 Adobe process version 还原
- ❌ 不在网页端"渲染最终成片"
- ❌ 不维护本地大规模风格预设库（交给 DeepSeek + web 搜索）

调色助手长期原则：

> 不做泛聊天，不做最终修图，不替代参数面板。
> 用自然语言生成可解释、可对比、可回退、可下载的 XMP 版本。

---

## §9 推荐文案（统一全站）

### 主标语
```
AI 生成 Lightroom 调色预设
```

### 副标题
```
上传照片，Lumina 会分析画面与影像数据，生成可直接导入 Lightroom 的 XMP 调色方案。
```

### 关键词替换

| 不建议 | 建议 |
|---|---|
| 最终效果图 | 效果方向预览 |
| AI 修好后的图片 | XMP 参数模拟预览 |
| 在线完成调色 | 生成 Lightroom 调色预设 |
| 真实还原 Lightroom | 近似展示风格方向 |
| 一键生成成片 | 一键生成可导入预设 |
| Chat / 输入问题 | 调色助手 / 微调指令 |

### 风险提示
```
JPG 文件已包含相机处理与压缩结果，分析结论为参考级；
RAW 文件在可读取底层数据时可信度更高。
```

### 调色助手 placeholder
```
告诉我你想怎么微调这套预设...
```

❌ 避免：
```
输入你想问的问题...
帮我看看这张图怎么样
```

---

## §10 文件命名约定

```
Lumina_{风格}_{时间}.xmp

例：
Lumina_Portrait_Warm_20260510.xmp
Lumina_Cinematic_Cool_20260510.xmp
Lumina_Refine_V3_20260510.xmp        ← 调色助手版本号
Lumina_RefMatch_20260510.xmp         ← 参考图追色
```

---

## §11 .env 最小可运行配置（部署参考）

```bash
# 文本 LLM（对话与 refine）— 推荐 DeepSeek
TEXT_API_KEY=sk-xxx                          # https://platform.deepseek.com
TEXT_BASE_URL=https://api.deepseek.com
TEXT_MODEL=deepseek-v4-flash                 # ✅ 当前默认；不要回退 deepseek-chat

# Vision LLM（首轮分析，传图）— 没有多模态 key 时保持为空
VISION_API_KEY=
VISION_BASE_URL=https://api.openai.com/v1
VISION_MODEL=gpt-5-2025-08-07                # 当前代码默认；有 OpenAI key 后再 smoke /models

# 风格联网搜索（可选）
STYLE_WEB_SEARCH_ENABLED=true
STYLE_SEARCH_PROVIDER=duckduckgo             # 默认无 key
# STYLE_SEARCH_PROVIDER=brave                # 升级用
# STYLE_SEARCH_API_KEY=xxx
STYLE_SEARCH_CACHE_TTL_SECONDS=604800        # 7 天

# Redis（session + style 缓存）
REDIS_URL=redis://127.0.0.1:6379

# 服务
PORT=3001
HOST=0.0.0.0
CORS_ORIGINS=http://localhost:*,http://127.0.0.1:*
```

**降级路径**：
- 缺 `TEXT_API_KEY` → refine 走本地引擎
- 缺 `VISION_API_KEY` → analyze 走本地引擎
- 都缺 → 全本地，仅靠 `localAnalyzer` + `enhanceParamsForStyleIntent`

---

## 进度追踪

每次发版本前在对应 §X.Y 行打勾 + 在 §1 已落地清单追加。

**v0.2.0 当前状态（2026-05-10）**：§2.2 风格差异 P0、§2.4 测试/lockfile/CI、§3.2 调色助手 QA 小修已完成。

**v0.2.0 剩余收尾**：§4.2 真实图片验收（日落 / 黑白 / 高饱和霓虹 / 人像肤色）、参考图左栏窄屏 QA、参考图是否在 refine 后继续约束的产品决策；§2.1 LLM 启动日志与手动 smoke、§2.5 AppleDouble 残留清理仍可作为发布前清洁项。

**v0.2.0 目标**：完成 §4 参考图追色真实图片验收与参考图 UI 窄屏验证后进入 beta；模型名不再作为 DeepSeek P0 blocker。

**v0.3.0 目标**：§5 工程加固（page.tsx 切 hook + `@lumina/core`） + §6 上线红线，具备 Vercel 一键部署能力。

> 这份文档是活文档，每次方向变化、每次决策、每次"原本计划做现在不做了"的退路，都写进对应章节。
