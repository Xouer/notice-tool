# Contract: Notification Content/契约：通知内容（负载扩展与渲染语义）

**Version/版本**: 1 (2026-11-08) | **Spec/规格**: [spec.md](../spec.md) | **Data Model/数据模型**: [data-model.md](../data-model.md)

本契约定义任务完成通知**内容**的结构与渲染语义，是对 [001 hook-receiver](../001-agent-task-notify/contracts/hook-receiver.md) 负载与 [001 mcp-tools](../001-agent-task-notify/contracts/mcp-tools.md) 工具 schema 的**可选新增扩展**。遵循宪法原则 III：字段仅可选新增，破坏性变更升 MAJOR。

## Payload Extension/负载扩展（`title` 可选字段）

标准事件负载在既有字段基础上新增可选 `title`：

```json
{
  "schemaVersion": 1,
  "source": "codebuddy",
  "taskId": "0c489af57ca84e9599e46cf2da32a945",
  "title": "修复登录页样式问题",
  "finishedAt": "2026-11-08T04:15:47.269Z",
  "result": "success",
  "resultSummary": "修改了 3 个文件并更新测试",
  "trigger": "hook"
}
```

| 字段 | 必填 | 类型 | 说明 |
| --- | --- | --- | --- |
| `title` | 否 | 字符串（≤100） | 任务标题，供通知首行识别；缺失时系统生成兜底标题 |

**来源映射**: codebuddy/claude-code 取 `title` → `conversation_title` → `session_title`，均无则从 `transcript_path` 转录文件提取标题（`custom-title` → `ai-title` → `topic` → 首条用户消息，`topic` 为 last-wins）；codex-cli 取 `title` → `thread-title`/`thread_title`；MCP `report_task_end` schema 增补可选 `title`；巡查 `AgentTask` 可选 `title`。映射细节见 [research.md](../research.md) R1。

## Template Placeholders/模板占位符白名单

| 占位符 | 说明 |
| --- | --- |
| `{{title}}` | **新增**。任务标题（来源提供或兜底） |
| `{{task_id}}` | 任务/会话标识 |
| `{{source_agent}}` | 来源智能体标识 |
| `{{result_status}}` | 结果枚举 `success/failure/interrupted/unknown` |
| `{{finished_at}}` | 结束时间（本地时区 `YYYY-MM-DD HH:mm:ss`） |
| `{{result_summary}}` | 概要（非空，缺失时按结果状态兜底） |

白名单外占位符保存/渲染即报错；正文长度上限 2000 不变。

## Fixed Default Format/固定默认格式

内置默认模板结构（各渠道一致）：

```text
【任务完成通知】
标题：{{title}}
任务 {{task_id}}（来源 {{source_agent}}）已结束
结果：{{result_status}}
结束时间：{{finished_at}}
概要：{{result_summary}}
```

字段顺序固定：标题 → 任务标识 → 结果 → 时间 → 概要。

## Rendering Rules/渲染规则

- **时间**: `finished_at` 以用户本地时区、`YYYY-MM-DD HH:mm:ss`（24 小时制）渲染；事件未提供结束时间时使用接收时间。
- **标题兜底**: 来源未提供或过滤后为空时，`title = "{source_agent} · {taskId 前 6 字符}"`。
- **概要兜底**: 来源未提供或过滤后为空时，按结果状态取值：`success → 任务成功完成`、`failure → 任务失败`、`interrupted → 任务被中断`、`unknown → 任务结束（结果未知）`。
- **敏感过滤**: 标题与概要渲染前均经敏感模式过滤（密钥/令牌/长哈希/长 base64），过滤后为空则回退兜底，不输出敏感原文。

## Compatibility Rules/兼容性规则

- `title` 为可选新增字段；旧负载/旧模板/旧数据不受影响，正常渲染（旧模板不含 `{{title}}` 则标题不出现）。
- 表结构零变更；存量默认模板仅当正文仍为旧内置正文时升级为新格式（用户自定义不被覆盖）。
- 结果枚举、触发枚举、去重键、错误码分类均不变。
