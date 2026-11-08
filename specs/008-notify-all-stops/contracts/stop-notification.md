# Contract/接口契约: Stop Notification/停止事件通知

**Date/日期**: 2026-11-08 | **Feature/特性**: [spec.md](../spec.md) | **Data Model/数据模型**: [data-model.md](../data-model.md)

## Scope/契约范围

本契约覆盖现有标准任务结束事件的可选 `eventKey` 扩展、三类来源映射、去重语义和新增事件历史只读命令。既有渠道、模板、HTTP 路径、MCP 工具名称及钩子配置方式不变。

## Standard Event Contract/标准事件契约

`schemaVersion: 1` 新增可选字段 `eventKey`：

```json
{
  "schemaVersion": 1,
  "source": "codebuddy",
  "taskId": "session-demo-001",
  "eventKey": "stop-demo-001",
  "result": "success",
  "resultSummary": "虚构任务已结束"
}
```

| Field/字段 | Contract/契约 |
|---|---|
| `eventKey` | 可选非空字符串，最长 512；同一来源事件重复上报必须复用相同值，不同 Stop 必须使用不同值 |
| 其他既有字段 | 类型、必填性、默认值和错误语义保持现有契约；来源适配器的缺省会话处理见下文 |

显式 `eventKey` 为空白、非字符串或超限时，返回既有 `VALIDATION_FAILED`，不部分受理。未提供时不报错。

## Dedup Contract/去重契约

| Input/输入 | Result/结果 |
|---|---|
| 相同 `source + taskId + eventKey` 首次到达 | 写入 `received`，进入通知流程 |
| 相同稳定键再次到达，无论 `trigger` 是否相同 | 写入 `duplicated`，不产生新通知记录 |
| 相同 `source + taskId`、不同 `eventKey` | 作为新 Stop 各自进入通知流程 |
| 旧调用未提供 `eventKey` | 沿用原 `source + taskId + cooldown` 去重，与有键事件隔离 |
| 相同稳定键但摘要、结束时间或触发方式不同 | 仍视为同一事件，不重复通知 |
| 稳定键已超出现有历史保留期 | 按新事件受理，与既有清理语义一致 |

判重和首次事件写入必须原子化。重复事件的 `resultSummary` 等字段仍按现有脱敏规则处理，不用于改变首次事件的通知内容。

## Source Mapping Contract/来源映射契约

### CodeBuddy and Claude Code/CodeBuddy 与 Claude Code

- 入口继续使用 `notice hook --source codebuddy` 或 `notice hook --source claude-code`，从 stdin 接收 `Stop` JSON。
- `session_id` 继续映射为 `taskId`；缺失时使用 `unknown-session`，不再仅因缺少可选会话元数据而丢弃 Stop。
- `source` 必须分别保持 `codebuddy` 和 `claude-code`，不得将 Claude 钩子硬编码为 CodeBuddy。
- `eventKey` 优先取显式事件键或来源 stop/event ID；否则根据 `transcript_path` 对应终态记录的 UUID、时间戳或稳定偏移生成不可逆散列。
- 无法获得稳定身份时按本次调用生成降级事件键并输出脱敏警告，事件仍进入通知流程。
- `result`、`resultSummary`、`finishedAt` 缺失继续走既有默认值；转录正文不进入标准事件。

### Codex CLI/Codex CLI

- 入口继续使用 `notice hook --source codex-cli --payload-argv`，只处理 `type=agent-turn-complete`，其他类型仍静默忽略。
- `thread-id` 或 `thread_id` 继续映射为 `taskId`；缺失时使用 `unknown-session`。
- `eventKey` 优先取显式事件键或 turn/event ID；否则使用匹配 rollout 的 `turn_complete` 记录身份生成散列，使 notify 与巡查可对齐。
- 无稳定身份时采用与 CodeBuddy 相同的降级受理和脱敏告警策略。
- `last-assistant-message` 继续截断、脱敏后映射为摘要，不直接作为持久化事件键。

## Polling Contract/巡查契约

- Claude `result` 和 Codex `turn_complete` 的终态记录必须尽可能提供与钩子一致的 `eventKey`。
- 同一终态键的重复扫描不重复上报；同一任务出现新终态键时，即使上一状态也是结束态，也必须上报。
- 启动补检窗口、扫描间隔、读取失败跳过和错误脱敏行为保持现有契约。
- 钩子与巡查提供相同稳定键时，由统一管线只产生一轮通知。

## CLI Contract/命令行契约

### Hook Result/钩子结果

`notice hook` 的命令参数、退出码和 JSON 字段保持兼容：

- `0`：事件受理、重复或按来源规则忽略；渠道失败仍按现有结果展示。
- `2`：负载或参数校验失败。
- `3`：本地服务或存储异常。
- JSON 输出继续包含 `eventId`、`deduplicated`、`notified`、`message`；不得新增必填输出字段。
- 人读重复提示改为“事件为重复，已记录未重复通知”，不再限定为冷却窗口内。

### Event History/事件历史

新增：

```text
notice history events [--limit N] [--status received|duplicated|dispatched]
```

- `--limit` 默认为 20，必须为正整数。
- `--status` 仅接受事件状态，不改变 `notice history --status` 对通知记录状态的既有定义。
- 默认人读输出包含事件 ID 短码、来源、任务标识、触发方式、事件状态和接收时间。
- `--json` 使用 `{ "events": [...] }` 顶层结构；每项字段均为新增输出，不改变现有 `{ "records": [...] }`。
- 无匹配事件时输出空数组或“暂无事件记录”，退出码为 0。
- 该命令只读，不提供删除、重发或配置修改能力；失败重发仍使用既有 `notice history resend <recordId>`。

## Error and Security Contract/错误与安全契约

- JSON 解析、字段校验和存储错误继续返回脱敏信息，不回显原始负载、完整转录路径或凭据。
- 事件键解析读取失败时，不将转录正文写入日志；降级警告只说明无法获得稳定事件身份及可能重复的风险。
- 本地事件历史不得展示完整转录路径、原始消息或敏感事件键原文。
- 测试夹具只能使用虚构数据；安全错误属于阻塞级缺陷。

## Compatibility/兼容性

- 旧 `schemaVersion: 1` 调用无需提供 `eventKey`，保持原行为。
- 数据库迁移只新增可空列和索引，旧数据不迁移、不改义。
- 现有 `notice history`、`notice history resend`、HTTP `/v1/hooks/task-completed` 和 MCP `report_task_end` 的既有输入输出不变；调用方可逐步采用 `eventKey`。
- 单轮 Stop 开始通知是明确的产品行为变化，不通过配置开关恢复旧排除规则。
