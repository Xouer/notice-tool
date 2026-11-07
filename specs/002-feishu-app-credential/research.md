# Research: Feishu App Credential Channel/技术调研：飞书应用凭证消息通道

**Feature**: [spec.md](spec.md) | **Plan**: [plan.md](plan.md) | **Date**: 2026-11-07

本特性为既有飞书渠道的能力扩展，调研聚焦三个问题：飞书开放平台的具体接口行为、令牌的生命周期管理方式、以及与既有代码/契约的兼容策略。

## R1. 飞书开放平台接口调研/Feishu Open Platform API Research

**结论**: 对接仅需两个 HTTP 接口，均为出站 POST，无需回调地址、无需 WebSocket 长连接。

### 令牌接口（换取 tenant_access_token）

```text
POST https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal
Content-Type: application/json
（无 Authorization 头——该接口本身用 app_id/app_secret 鉴权）

{ "app_id": "cli_xxx", "app_secret": "xxx" }

200 → { "code": 0, "msg": "ok", "tenant_access_token": "t-g10...", "expire": 7200 }
```

- `expire` 为秒数（约 7200 = 2 小时）；**以响应值为准，不硬编码**（假设已写入 spec）。
- 凭证错误时返回非零 `code`（如 `app_id`/`app_secret` 不匹配）且无 `tenant_access_token` 字段。

### 消息发送接口（以应用身份发文本）

```text
POST https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type={chat_id|open_id|user_id|email}
Authorization: Bearer {tenant_access_token}
Content-Type: application/json

{ "receive_id": "oc_xxx", "msg_type": "text", "content": "{\"text\":\"消息正文\"}" }
```

- **注意**：`content` 字段是**字符串化的 JSON**（不是嵌套对象），实现时须 `JSON.stringify({ text })`——这是与 Webhook 接口最大的格式差异。
- 发往 `chat_id` 需应用机器人已在目标群；发往 `open_id`/`user_id` 需用户在应用可用范围内且有给用户发消息的权限。
- 自建应用须**发布版本**后权限才生效；需开通 `im:message`（以应用身份发消息）相关权限——与 spec 边界情况"应用未发布可用版本"对应。

**实现期核对项**: 具体业务错误码（令牌失效、缺权限、机器人不在会话）在 `/speckit.tasks` 实现阶段以开放平台错误码文档逐条核对后再固化映射表，research 阶段不做凭记忆的精确码值承诺（仅已知 230002 ≈ 机器人不在群，作为示例占位）。

## R2. 令牌生命周期/Token Lifecycle

**结论**: 单进程内存缓存 + 按需续取，无定时刷新器、无落盘。

- **缓存键**: `app_id`（同一凭证可被多个渠道配置共享时自然合并）。
- **续取时机**: 缓存缺失或已过 `expire`（换算毫秒，提前 5 分钟保险余量）时同步换取；换取失败按发送失败分类返回。
- **发送时令牌被判定失效**（消息接口返回凭证类错误码）：清空缓存并**重试一次**换取 + 发送；再失败按错误分类返回——对应 spec 验收场景 3.3"无需用户干预"。
- **不落盘理由**: 令牌有效期仅 2 小时且获取成本为一次本地 HTTP 调用，持久化收益为零而增加密文存储面（FR-106 最小暴露，宪法原则 I）。
- **测试注入**: 模块暴露 `createFeishuTokenProvider(fetchImpl)` 工厂，测试注入假 fetch；时钟经可注入 `now()` 控制过期边界。

## R3. 依赖决策/Dependency Decision

**结论**: **零新增依赖**。

| 候选 | 决策 | 理由 |
| --- | --- | --- |
| 飞书官方 SDK（`@larksuiteoapi/node-sdk`） | 不引入 | 仅用两个 POST 接口，引入全量 SDK（含长连接、事件回调、加密能力）属投机复杂度（宪法原则 I）；SDK 版本还会拖入额外传递依赖面 |
| 自研 HTTP 封装 | 不新增 | 复用 `channels/adapter.ts` 的 `postJson`（001 已实现并有测试） |
| 令牌缓存库 | 不引入 | 单进程 Map + 时间戳即可，见 R2 |

**用户通知**: 按用户约束"有必要增加请通知"——评估结论为**无需新增**，不触发通知。

## R4. 错误分类映射/Error Classification Mapping

**结论**: 复用既有五码体系（`contracts/cli.md`，契约稳定），**分类细化落在人读 `message` 层**，不新增枚举值——避免破坏 001 已固化的错误码契约（宪法原则 III）。

| FR-105 分类 | ErrorCode | message 内容指引（脱敏） |
| --- | --- | --- |
| 凭证无效/失效 | `AUTH_INVALID` | "飞书凭证无效或已失效，请检查开放平台应用凭据" |
| 缺少消息权限/应用未发布 | `AUTH_INVALID` | "应用缺少消息发送权限或尚未发布版本，请在开放平台开通" |
| 机器人不在会话/目标不存在 | `CONTENT_REJECTED` | "应用机器人不在目标会话或接收目标不存在，请检查接收目标" |
| 网络故障 | `NETWORK_UNREACHABLE` | 复用 `classifyNetworkFailure` |
| 接口限流 | `RATE_LIMITED_REMOTE` | "飞书接口限流，请稍后重试" |

## R5. 测试策略/Testing Strategy

**结论**: 假服务 + 可注入时钟，覆盖 FR-105 全分类与零回归门禁。

- **单元**: 令牌提供者（首次获取、缓存命中零请求、过期续取、凭证错误）；`channel-config` app 模式校验（缺字段/空串/非法 receiveIdType）；`summarizeCredentials` 掩码（`app_secret` 不可见，`appId` 允许短前缀展示）。
- **集成**（本地假服务，重定向开放平台域名指向假服务）: 令牌+发送全链路成功；各错误分类映射；令牌中途失效触发一次自动重取；**Webhook 模式既有用例不动、全绿**（SC-104）。
- **契约**: CLI `--json` 输出新增字段为可选新增（契约规则允许）；list 输出掩码断言。

## R6. 凭据 schemaVersion 决策/Credentials Schema Versioning

**结论**: 保持 `schemaVersion: 1`。飞书凭据结构新增 `mode` 及 app 模式字段属**纯可选新增**（缺 `mode` 视为 `webhook`，旧数据零迁移）；破坏性变更才升版本，本特性无此类变更（宪法原则 III，兼容规则见 [contracts/feishu-app-channel.md](contracts/feishu-app-channel.md)）。

## R7. 安全审查/Security Review

- `app_secret` 经 `channel-config` 校验后走既有加密入库管线（AES-256-GCM + SecretStore），无旁路。
- `summarizeCredentials`：app 模式展示 `appId（掩码）+ receiveId（掩码）`，`app_secret` 永不出现在任何输出。
- 令牌仅存在于适配器调用栈与内存缓存，不进入日志、错误 message（R4 指引文案均为静态指引，不回传响应体原文）。
- 假服务测试中使用的假凭证/假令牌均标注为测试值，不使用真实格式避免误入库。
