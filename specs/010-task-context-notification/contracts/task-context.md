# Contract: Task Context Extraction & Rendering/契约：任务上下文提取与渲染

**Version/版本**: 1 (2026-11-08) | **Spec/规格**: [spec.md](../spec.md) | **Data Model/数据模型**: [data-model.md](../data-model.md)

本契约定义任务完成通知中「任务上下文（标题/概要）」的**提取字段与渲染语义**，是对 009 [notification-content](../009-fix-notify-content/contracts/notification-content.md) 契约的**修正与增强**。遵循宪法原则 III：仅修正字段识别与增强可选来源，不破坏既有负载与模板。

## Transcript Field Recognition/转录字段识别

标题提取需识别以下转录记录与字段（实测格式）：

| 记录类型 | 识别字段 | 优先级 |
| --- | --- | --- |
| `custom-title` | 标题文本 | 1 |
| `ai-title` | `aiTitle` | 2 |
| `summary`（`providerData.source == "initial-user-message"`） | `summary` | 3 |
| 首条真实用户消息 | `content[].input_text.text`（跳过 `<` 开头） | 4 |

> 相较 009，本契约**新增** `aiTitle` 与 `summary` 字段识别（009 仅识别 `title/topic/name/text`，导致实测提取失败）。

## Title Contract/标题契约

- 标题按上述优先级取首个非空值；全部不可得时回退 `{source_agent} · {taskId 前 6 字符}`。
- 标题长度上限 100，渲染前经敏感过滤，过滤后为空回退兜底。

## Summary Contract/概要契约

- 概要优先级：来源侧 `resultSummary` → 任务结论（最后一条完整 AI 回复的 `output_text`，跳过 `incomplete`）→ 转录 `summary`（首条用户消息）→ 结果状态兜底。
- 概要长度上限 500，渲染前经敏感过滤。

## Template Rendering Contract/模板渲染契约

占位符白名单与 009 一致（`{{title}}`、`{{task_id}}`、`{{source_agent}}`、`{{result_status}}`、`{{finished_at}}`、`{{result_summary}}`），默认格式不变：

```text
【任务完成通知】
标题：{{title}}
任务 {{task_id}}（来源 {{source_agent}}）已结束
结果：{{result_status}}
结束时间：{{finished_at}}
概要：{{result_summary}}
```

## Transcript Locating Contract/转录定位契约

| 场景 | 行为 |
| --- | --- |
| Stop 负载含 `transcript_path` | 读取该 JSONL 提取标题/概要 |
| 负载无路径、有 `session_id` | 按 `session_id` 在项目转录目录匹配 `<session_id>.jsonl` |
| 两者均不可用 | 标题/概要走兜底，通知仍发出 |

## Compatibility Rules/兼容性规则

- 不新增必填字段、不改负载 schema 版本、不改表结构、不改占位符白名单。
- 旧负载（无标题/概要）继续走兜底；旧模板（无 `{{title}}`）正常渲染。
- `session_id → 转录文件` 的映射为待验证项，不影响 `transcript_path` 显式提供的既有路径。
