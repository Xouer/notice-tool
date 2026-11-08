# Data Model/数据模型: Notify All Conversation Stops/所有对话停止事件均通知

**Date/日期**: 2026-11-08 | **Feature/特性**: [spec.md](spec.md) | **Research/调研**: [research.md](research.md)

## Model Overview/模型概述

本特性不新增业务实体表，只扩展现有 `task_events` 的事件身份。`taskId` 继续表示对话或任务上下文，`eventKey` 表示一次确定的停止事件；通知渠道、模板、通知记录和钩子模板实例模型保持不变。

## Conversation Stop Event/对话停止事件

对应现有 `NormalizedEvent` 与 `task_events`。

| Field/字段 | Required/必填 | Validation & Meaning/校验与含义 |
|---|---|---|
| `schemaVersion` | 是 | 保持整数 `1`；新增字段可选，不升级主版本 |
| `source` | 是 | 非空字符串，最长 64；如 `codebuddy`、`claude-code`、`codex-cli` |
| `taskId` | 通用事件是 | 非空字符串，最长 256；来源映射缺少会话 ID 时由映射器提供 `unknown-session` |
| `eventKey` | 否 | 非空有界字符串，最长 512；同一来源完成事件的稳定身份，持久化为不透明标识或散列 |
| `finishedAt` | 否 | ISO 8601；缺省为接收时间，不作为稳定去重身份 |
| `result` | 否 | 沿用 `success/failure/interrupted/unknown`；来源缺省映射规则不变 |
| `resultSummary` | 否 | 最长 500，进入存储和通知前继续敏感信息过滤 |
| `trigger` | 否 | 沿用 `hook/polling/http/mcp` 等既有枚举与入口默认值 |

### Identity Rules/身份规则

- 有 `eventKey`：事件身份为 `(source, taskId, eventKey)`；不同键是不同通知轮次，相同键是同一停止的重复上报。
- 无 `eventKey`：仅用于旧通用调用兼容，沿用 `(source, taskId, cooldown)` 判重，不与有键事件互相抑制。
- `eventKey` 不得由每次接收时间或内部随机 `eventId` 替代；降级模式生成的新键只表示本次来源调用，不宣称可识别后续重报。
- 事件键不得包含完整转录路径、对话正文、凭据或未经脱敏的摘要。

## Task Event Persistence/任务事件持久化

现有 `task_events` 新增：

| Column/列 | Type/类型 | Nullable/可空 | Purpose/用途 |
|---|---|---|---|
| `event_key` | 文本 | 是 | 保存标准化停止事件键；旧行和旧无键调用保持 `NULL` |

新增索引：

```text
(source_agent, task_id, event_key, received_at)
```

原字段 `id`、`source_agent`、`task_id`、`finished_at`、`result_status`、`trigger_type`、`raw_payload_ref`、`received_at`、`notify_status` 含义不变。旧索引是否保留由实际查询覆盖情况决定，但不得影响其他既有查询。

### Migration Rules/迁移规则

1. 通过新的 Drizzle 版本化迁移添加可空列和索引，不回填旧行。
2. 全新初始化与旧库升级后均允许旧无键事件继续受理。
3. 不添加 `event_key` 唯一约束，因为同一事件的重复上报仍需分别写入 `duplicated` 历史。
4. 判重检查与首次事件写入须在同一同步存储事务中完成，防止并发首次写入。

## Notification Round/通知轮次

通知轮次是业务概念，不新增数据库表：

- 一个非重复的 `task_events` 行对应一个通知轮次。
- 该事件通过现有 `notification_records.event_id` 关联各渠道通知记录。
- 同一 `eventKey` 的后续上报只新增 `notify_status=duplicated` 的事件行，不产生新通知记录。
- 同一 `taskId` 的不同 `eventKey` 各产生一轮通知，每轮仍投递到全部已启用渠道。

## Event Status Transitions/事件状态迁移

```text
来源 Stop
  ├─ 校验失败 → 不写入有效事件，不通知，返回既有脱敏校验错误
  └─ 校验通过并标准化 eventKey
       ├─ 稳定键已存在 → duplicated → 不分发
       ├─ 旧无键且冷却内已存在 → duplicated → 不分发
       └─ 新事件 → received
             ├─ 产生至少一条渠道记录 → dispatched
             └─ 无可用渠道 → received + 可排查提示
```

渠道记录状态继续按 `pending/retrying/sent/failed` 迁移；事件 `dispatched` 不等于所有渠道均成功，实际送达仍以各通知记录为准。

## Polling Task/巡查任务

现有 `AgentTask` 增加可选 `eventKey`：

| Field/字段 | Rule/规则 |
|---|---|
| `taskId` | 继续标识会话或任务上下文 |
| `status` | 沿用运行、完成、失败、中断、未知状态 |
| `eventKey` | 终态记录的稳定身份；运行态可为空，终态应尽量提供 |
| `finishedAt` | 继续用于启动补检窗口和通知展示 |
| `summary` | 继续截断并脱敏，不参与稳定身份计算 |

巡查调度器保存最后观察到的终态事件键。相同键不重复上报；即使状态连续为完成，只要出现不同终态键就作为新完成受理。启动补检仍受既有冷却窗口约束。

## Event History View/事件历史视图

`notice history events` 是 `task_events` 的只读投影，不新增存储实体。每项包含：

- 事件 ID、来源、任务标识、事件键的不可逆短摘要；
- 触发方式、接收时间、结束时间、结果状态；
- `received/duplicated/dispatched` 事件处理状态；
- 关联通知记录数量或渠道结果摘要（如查询需要）。

视图不得输出完整事件键中的敏感原文、转录路径、原始负载或渠道凭据。

## Relationships/实体关系

```text
Conversation Stop Event (task_events)
  1 ─── 0..* Notification Record (notification_records)
              * ─── 0..1 Notification Channel
              * ─── 0..1 Notification Template
```

钩子模板实例与通知渠道继续通过现有配置控制是否接收和发送，不因事件键增加新关系。

## Retention and Security/保留与安全

- 事件和通知记录沿用现有本地 30 天保留与清理策略；稳定键去重也以此可见历史为边界。
- 清理过期事件后，同一极旧事件再次上报可能被视为新事件，与现有保留语义一致。
- 所有测试使用虚构会话、路径、事件 ID 和摘要，不使用真实凭据或个人对话内容。
- 停用钩子模板或渠道只影响后续处理，不删除既有事件历史。
