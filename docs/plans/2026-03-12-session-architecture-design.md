# Lumina Session And Architecture Design

**Date:** 2026-03-12

## Goal

在保留“同一张图只手动上传一次、后续微调不要求用户重新选文件”的产品体验下，完成一套真正可上线的架构边界：

- 后端保留会话，但不持久化保存图片本体。
- 前端可以静默复用当前图再次发给后端。
- `analyze / refine / xmp` 三条链解耦，职责边界清晰。
- 视觉 provider 的图片输入限制显式化，不再让图片传输方式隐式耦合业务流程。
- Redis 限流升级为共享基础设施，策略为 `fail-open`。

## Product Constraints Confirmed

- 用户同一张图只手动上传一次。
- 后续同图多轮微调不要求用户重新选文件。
- 技术上允许前端静默复用当前图再次发送给后端。
- 后端保留会话。
- 后端不做图片持久化存储。
- 允许请求内极短暂临时文件或临时 URL，但分析完成后应立即丢弃。
- Redis 限流采用 `fixed-window + fail-open`。

## Environment Strategy

### Local development

- 用户上传本地图片永远成立。
- 若视觉 provider 支持 `data URL`，本地可直接分析。
- 若视觉 provider 只支持公网图片 URL，则本地必须提供 `PUBLIC_API_BASE_URL` 指向 tunnel / 公网域名，否则视觉分析不可用。

### Staging / Production

- 视觉 provider 可以使用 `codeproxy.dev/v1 + gpt-5.2`。
- 运行前提是后端能为单次请求生成 provider 可访问的临时公网图片 URL。
- 图片只在请求期内临时存在，请求完成主动删除，TTL 仅作为兜底。

## Session Model

Redis session 只保留非图片业务上下文：

- `session_id`
- `image_fingerprint`
- `raw_data`
- `style`
- `intent_history`
- `last_report`
- `last_lightroom_params`
- `revision`
- `created_at`
- `updated_at`

绝不进入 session 的数据：

- 图片 base64
- 图片文件路径
- 临时图片 URL
- 任何图片二进制内容

### Critical fields

- `image_fingerprint`
  - 前端根据当前图片生成稳定标识。
  - 后端用它验证当前微调请求是否仍然绑定同一张图。
- `revision`
  - 每次 analyze / refine 成功后递增。
  - 用于防止并发请求导致旧结果覆盖新结果。

## Interface Responsibilities

### `POST /api/analyze`

职责：首次分析并创建 session。

请求：

- `multipart/form-data`
- `preview_image`
- `raw_data`
- `user_intent`
- `style`
- `image_fingerprint`

响应：

- `session_id`
- `revision`
- `diagnostic_report`
- `lightroom_params`
- `download_url`

行为：

- 请求内接触图片。
- 按 provider 能力选择 `data_url` 或 `public_url`。
- 如需临时公网 URL，则创建请求级临时资源。
- 分析结束后立即删除临时图片。
- 将业务上下文写入 session。

### `POST /api/refine`

职责：基于同一张图的既有会话继续微调。

请求：

- 推荐 `multipart/form-data`
- `session_id`
- `revision`
- `new_intent`
- `image_fingerprint`
- `preview_image`
- 可选 `raw_data`

说明：

- 用户不重新选文件。
- 前端静默复用当前图再次发送。
- 后端仍不保存图片本体，只在本次请求里使用。

响应：

- `session_id`
- `revision`
- `diagnostic_report`
- `lightroom_params`
- `download_url`

后端校验顺序：

1. 校验 `session_id`
2. 校验 `image_fingerprint`
3. 校验 `revision`
4. 如当前 provider 需要视觉输入，则消费本次请求携带的 `preview_image`
5. 更新 session 的参数、报告、意图历史与版本号

### `POST /api/xmp`

职责：纯参数导出，不依赖图片和视觉模型。

请求：

- `application/json`
- `lightroom_params`
- 可选 `session_id`
- 可选 `revision`

响应：

- `download_url`

行为：

- 只做参数校验、clamp、模板注入与文件导出。
- 维持无状态，便于未来独立部署或批量导出。

## Service Decomposition

后端按六层边界拆分：

1. `redis service`
   - 单例 Redis client
   - 健康探针
   - 统一错误监听

2. `session service`
   - 只处理 session 读写、版本比较、指纹校验

3. `rate-limit service`
   - Redis fixed-window 限流
   - `fail-open`
   - 统一日志字段

4. `vision-ingestion service`
   - provider capability 判定
   - 请求级临时图片资源
   - 请求结束清理

5. `llm-orchestration service`
   - prompt 组装
   - vision / text 模型调度
   - provider fallback 策略

6. `xmp-export service`
   - 参数白名单
   - XMP 生成
   - TTL 清理

## Frontend State Boundaries

前端围绕“当前工作图”维护单一状态源：

- `currentFile`
- `currentPreviewBlob`
- `currentRawData`
- `currentImageFingerprint`
- `currentSessionId`
- `currentRevision`
- `currentReport`
- `currentParams`

切图时：

- 清空上述全部状态
- 放弃旧 session
- 释放旧图本地引用

## Error Semantics

- `404`
  - session 不存在或已过期
- `409`
  - `revision` 冲突
  - `image_fingerprint` 不匹配
- `422`
  - 当前 provider 需要视觉输入，但本次请求缺少图像
- `429`
  - 限流命中
- `5xx`
  - provider 故障或系统内部错误

## Why This Design

这套设计同时满足了产品体验与数据边界：

- 用户体验上仍是“上传一次、持续微调”。
- 后端没有图片持久化负担。
- provider 限制显式化，不再把图片传输方式写死在业务流程里。
- `analyze / refine / xmp` 各自独立，后续无论切换 provider、做对象存储、做鉴权、做批量任务，都能单独演进。
