# Data Model: Fix Task Completion Notification Content/数据模型：修复任务完成通知内容

**Date/日期**: 2026-11-08 | **Spec/规格**: [spec.md](spec.md) | **Research/调研**: [research.md](research.md)

本特性**不新增/不修改任何持久化表结构**（见 [research.md](research.md) R5）。本文件描述在既有实体上新增的**在途字段**与**渲染语义**，它们不改变数据库 schema，仅改变事件在内存中的形态与最终通知文本。

## In-Flight Field: Task Title/在途字段：任务标题（`title`）

属于实体 **任务结束事件/Task Completion Event**（表 `task_events` 的事件在途形态，**不落库**）。

| 属性 | 说明 |
| --- | --- |
| 名称 | `title` |
| 类型 | 可选字符串 |
| 来源 | 来源侧负载（codebuddy/claude-code 的 `title`/`conversation_title`/`session_title`，均无则从 `transcript_path` 转录文件提取；codex-cli 的 `title`/`thread-title`；MCP `report_task_end.title`；巡查 `AgentTask.title`） |
| 校验 | 非空字符串；长度 ≤ 100；渲染前经敏感过滤（同概要，见 [sensitive-filter](../001-agent-task-notify/research.md) 语义） |
| 兜底 | 缺失或过滤后为空时，`title = "{source_agent} · {taskId 前 6 字符}"` |

**说明**: 标题仅用于通知渲染与识别，不参与去重（去重键仍为 `source_agent + task_id + event_key/冷却窗口`，见 [research.md](research.md) R1 与既有 [dedup 语义](../001-agent-task-notify/data-model.md)）；不写入 `raw_payload_ref`。

## Rendering Semantics/渲染语义（模板占位符 → 最终值）

以下为通知模板白名单占位符在渲染时的取值语义（实现见 `core/template.ts`、`core/event-pipeline.ts`）：

| 占位符 | 渲染值语义 | 变更 |
| --- | --- | --- |
| `{{title}}` | 任务标题（来源提供或兜底标题） | **新增** |
| `{{task_id}}` | 任务/会话标识（来源侧提供，原样） | 不变 |
| `{{source_agent}}` | 来源智能体标识（原样） | 不变 |
| `{{result_status}}` | 结果枚举 `success/failure/interrupted/unknown` | 不变 |
| `{{finished_at}}` | 结束时间，**本地时区 + `YYYY-MM-DD HH:mm:ss`**（缺省取接收时间） | **由 UTC ISO 改为本地可读** |
| `{{result_summary}}` | 概要；来源提供且过滤后非空时用原值，否则按结果状态兜底（`success→任务成功完成` 等） | **由可空改为非空兜底** |

## Entity: Notification Template/实体：通知模板（默认模板变更）

属于既有表 `notification_templates`，仅变更**内置默认模板正文**（`is_builtin = true`、`is_default = true` 的行）。

**默认模板正文（新）**:

```text
【任务完成通知】
标题：{{title}}
任务 {{task_id}}（来源 {{source_agent}}）已结束
结果：{{result_status}}
结束时间：{{finished_at}}
概要：{{result_summary}}
```

**Validation Rules/校验规则**: 白名单占位符集合新增 `title`（其余不变）；未知占位符在保存/渲染时仍报错；正文长度上限 2000 不变。

**Migration/迁移**: 已初始化安装的存量默认模板，若其正文仍为旧内置正文（无 `{{title}}` 的旧版本），则在启动播种时替换为新内置正文；用户已自定义（正文 ≠ 旧内置正文）的模板不被覆盖（见 [research.md](research.md) R5）。

## Relationships/关系

无新增实体或关系变更。`title` 仅流经：`来源负载 → NormalizedEvent.title → PlaceholderValues.title → 模板渲染`。

## Compatibility & Migration/兼容性与迁移（宪法原则 III）

- `title` 为负载的**可选新增**字段，旧负载缺失时不受影响（走兜底标题）。
- 表结构零变更，无数据库迁移文件。
- 存量默认模板的正文升级仅覆盖"未改动过的旧内置正文"，且为一次性、幂等操作。

## Security Notes/安全要点（宪法原则 IV）

- 标题与概要一样，在渲染前经过敏感过滤（密钥/令牌/长哈希/长 base64 等模式脱敏）；过滤后为空则回退兜底，不输出敏感原文。
- 标题不新增任何凭据存储；无明文凭据落盘、入日志或进错误信息。
