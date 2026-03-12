# Lumina Prelaunch Hardening Design

**Date:** 2026-03-12

## Goal

在不推翻现有产品交互的前提下，完成一轮适合上线前的后端链路补强。重点解决三类问题：

1. 视觉模型接入与 provider 能力不一致，导致首轮分析在部分网关上稳定失败。
2. 后端输入、会话、XMP 生成缺少足够的安全边界，存在被滥用和生成非法产物的风险。
3. 前端对“模型能力受限 / 当前环境不可分析”的失败路径解释不够清晰，用户体验会直接表现成转圈和报错。

## Current Findings

### Vision root cause

- `gpt-5.2` / `gpt-5.3-codex` 在当前 `https://codeproxy.dev/v1` 上，`responses.create` 的纯文本输入可用。
- 同一 provider 对公网图片 URL 的视觉输入可用。
- 同一 provider 对 `data:image/...;base64,...` 形式的图片输入返回 `502`。
- `chat.completions` 与 `files.create` 在这条 provider 上不可用或返回 `404`。

因此，当前失败点不是 GPT 模型本身缺乏视觉能力，而是现有代码把视觉预览图作为 `data URL` 直接发送，与当前 provider 的兼容矩阵不匹配。

### Prelaunch risks

- `clampLightroomParams` 当前会保留未知参数；`/api/xmp` 也未限制参数 key，理论上可生成无约束的 `crs:*` 属性。
- `analyze` / `refine` / `xmp` 缺少请求频率限制，容易被刷爆或被错误脚本打挂。
- Session 内保存整张预览图 base64，但微调链路并不需要这份数据，属于不必要的内存和 Redis 占用。
- 当前前端在 provider 不支持当前图片传输方式时，只能收到通用错误，不足以指导本地和线上配置。

## Design Decisions

### 1. Vision ingestion strategy

引入“视觉输入来源策略”抽象，后端不再把“base64 data URL”写死在 LLM 层。

- `data_url`：适用于原生支持 data URL 的 provider。
- `public_url`：适用于只接受公网图片 URL 的 provider。
- `auto`：基于 `OPENAI_BASE_URL` 与配置规则自动决策。对 `codeproxy.dev` 默认走 `public_url`。

当策略为 `public_url` 时，后端会把预览图写入一个受控的临时目录，并通过显式配置的 `PUBLIC_API_BASE_URL` 生成绝对 URL。若该地址缺失或明显不可公网访问，则直接返回可操作的错误，而不是让模型请求超时。

### 2. Security boundaries

围绕“输入白名单 + 请求频率 + 临时文件生命周期”建立最小上线防线。

- 严格白名单化 Lightroom 参数 key，只允许已知参数与已知 tone curve key。
- 对 `style`、`user_intent`、`new_intent`、`session_id` 建立长度和格式约束。
- 对核心写接口增加速率限制。
- Session 仅保留 refine 真实需要的数据，不再缓存预览图 base64。
- 对视觉预览临时文件增加 TTL 与定时清理，避免磁盘膨胀。

### 3. Frontend UX adjustments

前端不改变主体交互，但要把失败路径讲清楚。

- 当后端返回“当前 provider 需要公网图片 URL”时，前端展示明确说明，不再表现成笼统分析失败。
- 保留现有分析进度 UI，同时补充一条更贴近实际的环境提示。
- 对重新生成 / 生成 XMP / 微调链路保持当前交互语义不变。

## Verification Strategy

- 单元测试覆盖：
  - 视觉输入策略判定与公网 URL 校验
  - Lightroom 参数白名单与 clamp 行为
  - 速率限制核心逻辑
- 工程验证：
  - `pnpm --dir backend test`
  - `pnpm --dir backend typecheck`
  - `pnpm --dir frontend typecheck`
  - `pnpm lint`
  - `pnpm build`

## Non-goals

- 本轮不引入完整账号体系、计费、权限系统。
- 本轮不重构前端整体布局与品牌视觉。
- 本轮不接入真正的公网对象存储，只预留对线上域名 / OSS 的兼容路径。
