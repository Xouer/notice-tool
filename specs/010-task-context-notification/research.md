# Research: Task Context Notification/技术调研：任务上下文通知

**Date/日期**: 2026-11-08 | **Spec/规格**: [spec.md](spec.md) | **Plan/计划**: [plan.md](plan.md)

本文件解决规格中提取出的全部技术未知项，每项给出决策、理由与备选方案。总体特征：**不新增依赖、不改表结构，核心为修正标题/概要的提取字段匹配 + 增强概要来源**，全部收敛为纯函数与映射层改动。

## R1: CodeBuddy Transcript Format & Title Source/转录格式与标题来源（实测）

**Decision/决策**: 实测本地转录文件确认——CodeBuddy 会话转录为 JSONL，每行一条记录，位于 `~/.codebuddy/projects/<project-slug>/<sessionId>.jsonl`。记录含 `type`/`role`/`content`/`sessionId`/`cwd` 等字段。任务标题与首条消息的**真实字段**为：

| 记录类型 | 字段 | 含义 | 实测示例 |
| --- | --- | --- | --- |
| `type:"ai-title"` | `aiTitle` | AI 自动生成的会话标题 | `"Run speckit specify command"` |
| `type:"summary"`（`providerData.source:"initial-user-message"`） | `summary` | 首条用户消息原文 | `"/speckit.specify"` |
| `type:"custom-title"` | （用户重命名） | 存在时最优先 | （本例未出现） |

**Rationale/理由**: 实测发现现有 `readTranscriptTitle` 的 `recordTitle` 仅识别 `title/topic/name/text` 字段，而实际转录使用 `aiTitle`/`summary` 字段，导致标题提取始终失败、回退到 `{source}·{taskId前6}` 兜底——这正是用户反馈「标题是 codebuddy · 97645996、不知道具体是哪个任务」的**根因**。

**Alternatives Considered/备选方案**: 依赖来源侧 Stop 钩子负载直接提供标题（实测不含标题字段，拒绝作为唯一来源）；仅逐行扫描首条 message 的 `input_text`（首条常为系统注入/命令，且 `summary` 记录更直接，仅作兜底）。

## R2: Title Field Recognition Fix/标题字段识别修正

**Decision/决策**: 扩展标题提取逻辑，识别 `aiTitle`（`ai-title` 记录）与 `summary`（`summary` 记录）字段。标题优先级固定为：`custom-title` → `ai-title`(`aiTitle`) → `summary`(`summary`, initial-user-message) → 首条真实用户消息 → 技术标识兜底。

**Rationale/理由**: 优先级反映「可读性与稳定性递减」：用户手动标题最贴合意图；AI 标题次之（语义完整）；首条消息最原始。保留技术标识兜底以满足「任何情况都能发出通知且可区分」。

**Alternatives Considered/备选方案**: 直接用首条用户消息作标题（可能过长且含命令噪声，拒绝）；只识别 `aiTitle` 不识别 `summary`（`ai-title` 可能缺失，缺少兜底，拒绝）。

## R3: Summary Source/概要来源

**Decision/决策**: 通知概要（`result_summary`）按优先级取值：来源侧 `resultSummary` → **任务结论**（最后一条完整 AI 回复的 `output_text`，见 R6）→ 转录 `summary`（首条用户消息）→ 结果状态兜底（`任务成功完成` 等）。

**Rationale/理由**: 用户第二痛点是概要只有「任务成功完成」。相比首条用户消息（只反映"任务目标"），任务结论更能回答"任务最终做了什么/得出了什么"，故结论优先于首条消息；结果状态兜底仅在完全无内容时使用。

**Alternatives Considered/备选方案**: 用 AI 标题填充概要（与标题重复，拒绝）；截取转录正文（引入噪声与敏感信息，拒绝）；仅以结论作为概要唯一来源（结论可能缺失，须保留首条消息与状态兜底，拒绝）。

## R4: First User Message Extraction/首条用户消息提取

**Decision/决策**: 首条用户消息优先取自 `summary` 记录（`providerData.source:"initial-user-message"`）；缺失时逐行扫描首条 `type:"message" && role:"user"` 的非注入 `input_text`（跳过 `<` 开头的系统注入与 `<command-name>`）。

**Rationale/理由**: `summary` 记录由 CodeBuddy 直接标记为「首条用户消息」，比逐行扫描更可靠、无注入噪声；逐行扫描作为无 `summary` 记录时的兜底。

**Alternatives Considered/备选方案**: 仅逐行扫描（现有逻辑，会先撞上 system-reminder/command，且无 `aiTitle`/`summary` 识别，已证失败）。

## R5: Transcript Locating/转录文件定位

**Decision/决策**: 优先使用 Stop 钩子负载的 `transcript_path`；缺失时按 `session_id` 在 `~/.codebuddy/projects/<project-slug>/` 下匹配 `<session_id>.jsonl`。

**Rationale/理由**: `transcript_path` 是 CodeBuddy Stop 钩子契约中声明的字段，最直接可靠；`session_id` 匹配作为兜底，避免「有会话 ID 但无路径」时无法提取。

**Alternatives Considered/备选方案**: 仅依赖 `transcript_path`（缺失时完全无法提取，拒绝）；按时间戳猜测最近转录（不可靠、易错配会话，拒绝）。

### 边界/实测结论（已验证）

真实 Stop 负载捕获（2026-11-08，`~/.codebuddy/notice-hook-last-payload.json`）确认：`transcript_path` 指向 CodeBuddyIDE 的会话索引 `%LOCALAPPDATA%/CodeBuddyExtension/Data/<device>/CodeBuddyIDE/<device>/history/<workspaceHash>/<session_id>/index.json`——仅含消息索引（id/role/isComplete），消息实体在同级 `messages/<id>.json`，且 `message`/`extra` 字段均为**字符串化 JSON**（需二次解析）；用户原始输入在 `extra.inputPhrase[].content`，assistant 结论在其 `content[type="text"]` 块。此前发现的 `~/.codebuddy/projects/` 下 JSONL 为另一种会话形态，与 IDE 会话无关。`readTranscriptContext` 已支持两种格式自动识别（JSONL 优先，无结果回退 IDE 目录格式）。

## R6: Task Conclusion Extraction/任务结论提取

**Decision/决策**: 任务结论取转录中**最后一条** `type:"message" && role:"assistant"` 且 `status != "incomplete"` 的 `content[].output_text.text`（只取 `output_text`，忽略 `reasoning` 与工具调用块）；截断到概要上限并经敏感过滤。

**Rationale/理由**: 实测确认 assistant 回复载体为 `output_text`；`status:"incomplete"` 与 `"Interrupted by user"` 表示任务被中断、无结论，须跳过。只取 `output_text` 而非 `reasoning`（思考过程），因思考过程冗长且不应向用户展示；截断与过滤保证不超长、不泄露敏感信息。

**Alternatives Considered/备选方案**: 取 reasoning 文本（冗长、含思考过程，不宜展示，拒绝）；取首条 assistant 消息（是中间步骤而非结论，拒绝）；不设跳过条件导致中断回复被当结论（会展示「Interrupted by user」，拒绝）。

**风险/边界**: 多步骤任务最后一条 assistant 消息可能是中间步骤或简短收尾，而非干净总结（预计 60–70% 场景理想）。此为增强项而非银弹，须依赖标题 + 首条消息 + 状态兜底的分层降级，见 [data-model.md](data-model.md)。

## Conclusion/结论

全部技术未知项已决策，无 `NEEDS CLARIFICATION` 残留。核心改动：① 修正 `readTranscriptTitle` 的字段识别（`aiTitle`/`summary`）；② 概要来源按「resultSummary → 任务结论 → 首条用户消息 → 状态兜底」分层增强；③ 转录定位增加 `session_id` 兜底。零新依赖、零表结构变更，与宪法六项原则一一对应（见 [plan.md](plan.md)）。
