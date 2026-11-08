# Data Model/数据模型: Task Context Notification/任务上下文通知

**Date/日期**: 2026-11-08 | **Feature/特性**: [spec.md](spec.md) | **Research/调研**: [research.md](research.md)

## Model Overview/模型概述

本特性**不新增表结构、不迁移既有数据**。它复用 009 引入的「标题/概要作为在途字段」设计，仅修正与增强这两个字段的**提取来源与字段匹配**，使通知真正携带可识别的任务上下文。持久化层（`task_events` 等）保持不变。

## Task Context/任务上下文

任务上下文是「用于识别具体任务」的业务信息集合，随事件流入渲染管线，不单独落库。

| Field/字段 | Required/必填 | 约束 | 来源优先级（从高到低） |
| --- | --- | --- | --- |
| `title` | 否 | 字符串，最长 100；渲染前敏感过滤 | `custom-title` → `ai-title` 的 `aiTitle` → `summary` 的 `summary`（`source:"initial-user-message"`）→ 首条真实用户消息 → 技术标识兜底 `{source} · {taskId 前 6 字符}` |
| `result_summary` | 否 | 字符串，最长 500；渲染前敏感过滤 | 来源侧 `resultSummary` → 任务结论（最后一条完整 AI 回复的 `output_text`）→ 转录 `summary`（首条用户消息）→ 结果状态兜底（`任务成功完成/任务失败/任务被中断/任务结束（结果未知）`） |

### Extraction Rules/提取规则

- **标题字段识别**：`ai-title` 记录取 `aiTitle` 字段；`summary` 记录（`providerData.source == "initial-user-message"`）取 `summary` 字段；`custom-title` 记录取标题文本。任一取到非空即停止。
- **首条真实用户消息**：优先 `summary` 记录；缺失时扫描首条 `type:"message" && role:"user"` 的 `content[].input_text.text`，跳过 `<` 开头的系统注入与 `<command-name>`。
- **任务结论**：取最后一条 `type:"message" && role:"assistant"` 且 `status != "incomplete"` 的 `content[].output_text.text`，只取 `output_text`（忽略 `reasoning` 与工具调用块）；截断到概要上限。
- **兜底不变式**：标题与概要的最终兜底（技术标识、结果状态）保证通知**始终可发出且不泄露敏感原文**。

## Transcript Locating/转录定位

| Input/输入 | 定位方式 |
| --- | --- |
| 有 `transcript_path` | 直接读取该 JSONL 文件 |
| 无 `transcript_path` 但有 `session_id` | 在 `~/.codebuddy/projects/<project-slug>/` 下匹配 `<session_id>.jsonl` |

> `session_id` 与转录文件名的映射关系为待验证项（见 [research.md](research.md) R5 边界）；不影响 `transcript_path` 显式提供的场景。

## Rendering Semantics/渲染语义

沿用 009 的通知模板与占位符白名单，字段顺序固定为：标题 → 任务标识 → 结果 → 时间 → 概要。

```text
【任务完成通知】
标题：{{title}}
任务 {{task_id}}（来源 {{source_agent}}）已结束
结果：{{result_status}}
结束时间：{{finished_at}}
概要：{{result_summary}}
```

- `{{title}}` 由 `title` 字段填充（提取或兜底）；`{{result_summary}}` 由 `result_summary` 填充。
- 标题与概要渲染前均经敏感信息过滤；过滤后为空则回退各自兜底。

## Relationships/实体关系

```text
Conversation Stop Event (task_events) —— 携带 → Task Context（title / result_summary）
                                                       └── 渲染 → Notification Content（模板 {{title}}/{{result_summary}}）
```

不新增持久化实体；`title`/`result_summary` 仅存在于事件处理与渲染的瞬时链路中。

## Security/安全

- 标题与概要属敏感数据：渲染前强制经敏感模式过滤（密钥/令牌/长哈希/长 base64），不输出敏感原文。
- 提取过程不得将完整转录正文写入日志、错误信息或历史；仅保留脱敏后的标题/概要。
- 测试仅使用虚构转录与虚构会话，不得复制真实对话。
