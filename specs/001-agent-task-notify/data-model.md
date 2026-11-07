# Data Model: Agent Task Completion Notification/数据模型：智能体任务完成通知

**Date/日期**: 2026-11-07 | **Spec/规格**: [spec.md](spec.md) | **Research/调研**: [research.md](research.md)

存储引擎为 SQLite（见 [research.md](research.md) R1）。以下实体与规格"Key Entities/关键实体"一一对应；字段描述不含实现类型细节，但给出校验规则与状态迁移。

## Entity: Notification Channel Configuration/实体：通知渠道配置（表 `notification_channels`）

| 字段 | 说明 | 校验规则 |
| --- | --- | --- |
| `id` | 渠道唯一标识 | 系统生成，不可变 |
| `type` | 渠道类型 | 枚举：`feishu` / `dingtalk` / `email` / `wechat` / `qq` |
| `name` | 用户可读名称 | 非空；同 `type` 内唯一 |
| `credentials_blob` | 连接信息密文（Webhook、令牌、邮箱授权码、推送密钥等） | 仅存密文（AES-256-GCM，密钥经 `SecretStore` 托管）；明文仅在发送瞬间驻留内存 |
| `enabled` | 启用状态 | 布尔，默认 `false`，测试发送成功前不允许可用 |
| `rate_limit` | 渠道级限流参数 | 可选，缺省用全局默认 |
| `created_at` / `updated_at` | 时间戳 | 系统维护 |

**Validation Rules/校验规则**（源自 FR-004/FR-005）:
- `type` 必须属于五类枚举之一；`email` 类型要求收件地址与 SMTP 授权码字段（密文内结构校验）；Webhook 类要求 URL 合法。
- 凭据结构按 `type` 定义其密文内部 schema（版本化，见兼容性说明）。

**State Transitions/状态迁移**:
`draft（已保存未验证） → enabled（测试发送通过后启用） ↔ disabled（用户禁用）`；删除即物理清除该行及密文（FR-005 场景 4）。无 `deleted` 软删态。

## Entity: Task Completion Event/实体：任务结束事件（表 `task_events`）

| 字段 | 说明 | 校验规则 |
| --- | --- | --- |
| `id` | 事件唯一标识 | 系统生成 |
| `source_agent` | 来源智能体标识 | 非空（如 `claude-code`、`generic:my-agent`） |
| `task_id` | 任务标识 | 非空，来源侧提供 |
| `finished_at` | 任务结束时间 | ISO 8601；缺省取接收时间 |
| `result_status` | 任务结果 | 枚举：`success` / `failure` / `interrupted` / `unknown` |
| `trigger_type` | 触发方式 | 枚举：`hook` / `polling` / `mcp` |
| `raw_payload_ref` | 原始负载摘要（脱敏后） | 可选；仅存脱敏摘要，不含代码正文与密钥（FR-009） |
| `received_at` | 系统接收时间 | 系统维护，去重窗口基准 |
| `notify_status` | 分发状态 | 见状态迁移 |

**Validation Rules/校验规则**（源自 FR-001/FR-002/FR-010）: 输入负载经 JSON Schema 校验（长度上限、字段类型、枚举），非法即拒绝并返回明确原因（FR-013）。

**Deduplication/去重**（源自 FR-007，见 research.md R8）: 入库前按 `(source_agent, task_id)` + `received_at` 冷却窗口（默认 10 分钟，可配）查询；命中即标记为重复：保留事件记录（`trigger_type` 可补充），**不**再触发通知。

**State Transitions/状态迁移**:
`received（已接收） → duplicated（判定为重复，仅记录）`；`received → dispatched（已产生通知记录）`。终态不可逆。

## Entity: Notification Record/实体：通知记录（表 `notification_records`）

| 字段 | 说明 | 校验规则 |
| --- | --- | --- |
| `id` | 记录唯一标识 | 系统生成 |
| `event_id` | 关联任务结束事件 | 外键 → `task_events.id`，非空 |
| `channel_id` | 关联渠道 | 外键 → `notification_channels.id`，非空 |
| `template_id` | 使用的模板 | 外键 → `notification_templates.id`，可空（默认模板） |
| `status` | 发送状态 | 枚举：`pending` / `sent` / `retrying` / `failed` |
| `attempts` | 已尝试次数 | 非负整数，上限可配 |
| `last_error_code` | 最近失败分类码 | 可空；分类枚举见契约 [contracts/cli.md](contracts/cli.md) 错误码节 |
| `created_at` / `updated_at` | 时间戳 | 系统维护 |

**Validation Rules/校验规则**（源自 FR-008/FR-011）: 单渠道失败不得阻断其他渠道记录的创建与发送；错误码必须为用户可理解的分类（凭据失效 / 网络不可达 / 被限流 / 内容被拒），且不得携带凭据或原始响应体。

**State Transitions/状态迁移**:
`pending → sent`（成功，终态）；`pending → retrying → sent | failed`（按退避重试，超限进入 `failed` 终态）；`failed` 支持用户手动重发（回到 `pending`）。

## Entity: Notification Template/实体：通知模板（表 `notification_templates`）

| 字段 | 说明 | 校验规则 |
| --- | --- | --- |
| `id` | 模板唯一标识 | 系统生成 |
| `name` | 模板名称 | 非空唯一 |
| `channel_type` | 适用渠道类型 | 可空 = 通用；非空时须为五类枚举之一 |
| `body` | 模板正文 | 仅允许白名单占位符：`{{task_id}}`、`{{source_agent}}`、`{{result_status}}`、`{{finished_at}}`、`{{result_summary}}`；含未知占位符保存时即报错（FR-009） |
| `is_default` | 是否默认 | 每渠道至多一个默认 |
| `created_at` / `updated_at` | 时间戳 | 系统维护 |

**Validation Rules/校验规则**（源自 FR-009）: 白名单外占位符、超长正文（上限 2000 字符）在保存时拒绝；默认模板随产品内置且不可删除。

## Relationships/关系

```text
notification_channels 1 ──< notification_records >── 1 task_events
notification_templates 1 ──< notification_records（可选引用）
```

- 一次任务结束事件对每个"已启用渠道"产生恰好一条通知记录（FR-003/FR-007）。
- 删除渠道时其历史通知记录保留（`channel_id` 置空或随渠道清除，采用**保留并置空**以满足 FR-011 历史可追溯，渠道本体与凭据物理删除）。

## Retention & Maintenance/保留与维护

- 通知历史（`task_events`、`notification_records`）本地默认保留 **30 天**，后台维护任务定期清理（规格假设）。
- 模板与渠道配置不自动清理。

## Compatibility & Migration/兼容性与迁移（宪法原则 III）

- 表结构变更一律经 `drizzle-kit` 生成版本化 SQL 迁移文件，入库审查。
- 密文内部结构与事件负载结构（契约 [contracts/hook-receiver.md](contracts/hook-receiver.md)）含 `schemaVersion` 字段，读取旧版本数据时向前兼容；移除字段必须提供迁移说明与过渡期。

## Security Notes/安全要点（宪法原则 IV）

- 明文凭据仅存在于发送瞬间的内存上下文，进程内不缓存明文、不写日志、不进错误对象。
- 原始事件负载仅保存脱敏摘要；日志中的 Webhook/令牌/授权码一律掩码输出。
- 数据库文件与密钥均置于用户数据目录并限制为当前用户可读。
