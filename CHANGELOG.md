# Changelog

本文件记录 Lumina 项目的所有重要变更，格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.0.0/)。

---

## [0.1.1] — 2026-03-03

### Added（新增）
- 新增 `POST /api/xmp`，支持基于当前参数重新生成 XMP 下载链接（前端“生成 XMP / 下载 XMP”语义拆分）。
- 新增 XMP 文件生命周期管理：`XMP_FILE_TTL_SECONDS` 配置与后台定时清理任务。
- 新增根级 `pnpm workspace` 与统一脚本（`dev/build/lint/typecheck`）。
- 新增 `third_party/emsdk` 子模块，替代本地大目录直拷贝。

### Changed（变更）
- 版本升级到 `v0.1.1`（frontend/backend package version、后端健康检查版本字段、启动 Banner）。
- OpenAI 默认配置切换为本地 demo 代理：`https://openai.linktre.cc/v1`，默认模型为 `gpt-5-2025-08-07`。
- CORS 增强为 `CORS_ORIGINS` 可配置，默认允许 `localhost` / `127.0.0.1` 任意端口。
- 前端 JPG 数据轨由占位数据改为真实计算（极值统计、64-bin 线性直方图、断层风险、ICC/色域识别）。

### Fixed（修复）
- 修复 NEF 链路：缺失 `public/wasm/raw_analyzer.js` 时明确提示并禁用分析；NEF 未解析完成不可提交分析。
- 修复 NEF 预览逻辑：上传后优先使用 Worker 提取的内嵌 JPEG，不再回退错误 MIME 占位路径。
- 修复 SSE 协议一致性：`/api/refine` 的 `final` 事件补回 `session_id`，前端改为可选兼容。
- 修复 LLM 代理兼容问题：主调用路径失败时自动走备用路径重试（接口不变）。
- 修复前端工程基线：移除 `next.config` 的 `ignoreBuildErrors`，补齐 lint/typecheck 配置并清理构建污染目录。

## [0.1.0] — 2026-03-03

### 🎉 首个 MVP 版本

**AI 调色全链路打通：上传 → WASM 解析 → LLM 推理 → XMP 生成 → 下载。**

### Added（新增）

#### 前端
- **文件上传**：拖拽/点击上传 JPG、NEF 格式图片，立即显示预览。
- **WASM 解析引擎**：使用 LibRaw + Emscripten 编译为 WebAssembly，在 Web Worker 中解码 NEF 文件。
  - 提取 14-bit 真实线性直方图（256 bins / 64 bins）。
  - 提取 EXIF（相机型号、ISO、快门、光圈、焦距）。
  - 计算物理特征（宽容度余量、高光溢出率、暗部存活率、RGGB 通道偏移、断层风险）。
  - 提取内嵌 JPEG 预览图（秒级展示，无需上传原始 45MB 文件）。
- **诊断报告 UI**：四模块结构化展示（核心结论 / 底层剖析 / 策略建议 / 参数动作）。
- **Lightroom 风格参数面板**：
  - 填充式滑块（fill-style），无 thumb 圆形拖柄。
  - 双极参数从中心线向左右填充。
  - HSL 滑块使用对应颜色编码（红/橙/黄/绿/青/蓝/紫/洋红）。
  - 紧凑 22px 行高，三角箭头可折叠分组。
- **60+ Lightroom 参数定义**：覆盖基本、色调曲线、偏好、HSL、细节、效果、色调分离 7 大面板。
- **多轮微调**：底部对话框 + 快捷 Chip（"肤色再提亮"、"冷色调"等），支持自然语言迭代。
- **SSE 流式 API 客户端**：`lib/api.ts` 封装 `analyzeWithSSE` / `refineWithSSE`。
- **平台选择**：Lightroom Classic / CC（默认），像素蛋糕（Coming Soon）。
- **风格预设**：AI 智能匹配、日系清透、赛博朋克、复古胶片、高级灰、黑金。

#### 后端
- **Fastify 服务器**：CORS、multipart 文件上传、静态文件下载。
- **POST /api/analyze**：接收预览图 + 物理数据 JSON + 用户意图，SSE 流式返回 AI 诊断 + 参数。
- **POST /api/refine**：基于 Session 的多轮微调，Text-only LLM 调用（不重传图片）。
- **Prompt 引擎**：
  - 完整 System Prompt：角色定义 + 5 步执行工作流 + 3 步思考链路。
  - 5 条强制规则：肤色防御、高光曝光牵制、SNR 防御、JPG 降级防御、P3 色域防御。
  - 输出格式约束：只返回 JSON、只输出非零参数、禁止蒙版/Markdown。
- **LLM 服务**：OpenAI SDK 双模型调度（Vision 首轮 + Text-only 微调），流式输出。
- **XMP 模板引擎**：Handlebars 模板注入，ToneCurve `rdf:Seq` 序列化，默认值补齐。
  - 硬编码 `Adobe Color` 色彩基准、`LensProfileEnable`、`AutoLateralCA`。
  - 剔除所有局部蒙版节点。
- **Session 服务**：Redis 存储，TTL 30 分钟自动过期，多轮上下文复用。
- **三层 JSON 解析防御**：直接解析 → 代码块提取 → 正则抢救。
- **参数范围校验**：60+ 参数 clamp 至 Lightroom 合法范围。

#### 工程化
- **AI_CONTEXT.md**：瓶颈分析与解决方案文档，作为 AI 协作指导书。
- **BaseTemplate.xmp**：100+ 参数全量 Lightroom XMP 基座模板。
- **.env.example**：环境变量模板。

### Fixed（修复）

- `analyze.ts` 中 `streamVisionAnalysis` 参数顺序交叉 Bug。
- 前端参数 Key 与 XMP 标准命名不一致（`Exposure` → `Exposure2012` 等 7 个字段）。
- `raw-parser.worker.ts` 中 `importScripts` 类型未声明、`cwrap` 返回类型 `null` → `'void'`。
- `build.sh` 中 bash-only `${VAR,,}` 语法不兼容 macOS zsh。
- 缺少 `pino-pretty` 依赖导致后端启动失败。
