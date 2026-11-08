# Research: Fix Task Completion Notification Content/技术调研：修复任务完成通知内容

**Date/日期**: 2026-11-08 | **Spec/规格**: [spec.md](spec.md)

本文件解决规格中提取出的全部技术未知项，每项给出决策、理由与备选方案。总体特征：**不新增依赖、不改表结构，改动全部收敛为纯函数与默认模板调整**。

## R1: Title Source & Fallback/标题来源与兜底

**Decision/决策**: 在标准化事件负载中新增**可选** `title` 字段（`validateEventPayload` 解析，长度上限 100）。标题按来源映射抽取：
- codebuddy / claude-code（`cli/hook.ts` 的 `mapCodeBuddyStopPayload`）：优先取 `title`，其次 `conversation_title` / `session_title`；均无则从 `transcript_path` 转录文件提取标题——`custom-title` → `ai-title` → `topic`（last-wins）→ 首条用户消息（`type:"message" && role:"user"` 的 `content[].input_text.text`，跳过 `<` 开头的系统注入）；
- codex-cli（`mapCodexNotifyPayload`）：取 `title` 或 `thread-title` / `thread_title`；
- MCP `report_task_end`：schema 增补可选 `title`（原 schema 为 `additionalProperties: true`，字段已可透传）；
- 巡查适配器（`AgentTask`）：可选增补 `title`，缺省走兜底。

当来源未提供且转录提取亦失败（或过滤后为空）时，生成**可读兜底标题**：`{source_agent} · {taskId 前 6 字符}`（如 `codebuddy · 0c489a`），确保通知首行始终可识别、可区分不同任务。

**Rationale/理由**: 用户痛点是"不知道哪个对话任务结束"——来源侧（CodeBuddy 等）的 Stop 钩子负载不含标题字段，但 `transcript_path` 转录文件携带会话标题/首条用户消息，是标题的最优来源；兜底标题保证即便转录不可读也能区分任务（长 UUID 前 6 位 + 来源名足够可读），满足 FR-002。

**Alternatives Considered/备选方案**: 仅输出完整 `taskId`（现状，不可读，拒绝）；强制要求来源提供标题（对旧来源破坏兼容，违背 FR-008，拒绝）；用概要首行截断作标题（概要常为空，兜底不可靠，拒绝为主路径、仅作次要来源）。

## R2: Local Time Rendering/本地时间渲染

**Decision/决策**: 新增纯函数 `formatLocalDateTime(date)`，输出 `YYYY-MM-DD HH:mm:ss`（24 小时制，本地时区），基于 `Date` 的 `getFullYear/getMonth/getDate/getHours/getMinutes/getSeconds` 手工拼装（零依赖）。`event-pipeline.ts` 中将 `finished_at` 的渲染由 `toISOString()` 改为调用该函数；`finishedAt` 缺失时沿用接收时间。

**Rationale/理由**: `toISOString()` 固定输出 UTC（`...T...Z`），既是"时间不对"（时区）又是"不可读"（格式）的根因。手工拼装纯函数无第三方依赖、无时区数据表负担，且本地时区由操作系统时区自然决定，符合"用户本地时区"语义（FR-004/FR-005）。

**Alternatives Considered/备选方案**: `Intl.DateTimeFormat`（功能等价，但默认输出带本地化分隔符与语言环境差异，跨环境断言不稳定，测试需固定 locale，故弃）；引入 `dayjs`/`luxon`（为此一处格式化引入运行时依赖，违背宪法原则 I，拒绝）；继续 UTC（就是本次要修的缺陷）。

## R3: Summary Fallback/概要兜底

**Decision/决策**: 新增纯函数 `summaryFallback(resultStatus)`，按结果状态返回本地化结论：`success → 任务成功完成`、`failure → 任务失败`、`interrupted → 任务被中断`、`unknown → 任务结束（结果未知）`。`event-pipeline.ts` 中当 `resultSummary` 经敏感过滤后为空时，用该兜底值填充 `result_summary` 占位符（FR-006）。

**Rationale/理由**: 现状 `result_summary: sanitizedSummary ?? ""` 在来源未提供概要时直接渲染为空行；按结果状态生成结论是最小、最不引入虚构信息的兜底（不伪造具体成果，只陈述结果），满足"概要有内容"且不误导。

**Alternatives Considered/备选方案**: 显示"（无概要）"（仍是无意义占位，拒绝）；从任务日志截取正文作概要（引入敏感信息与噪声，且巡查/钩子未必有日志，拒绝）；留空（本次要修的缺陷）。

## R4: Template Placeholder & Default Format/模板占位符与默认格式

**Decision/决策**: 在 `core/template.ts` 的 `PLACEHOLDERS` 白名单与 `PlaceholderValues` 中新增 `title`；`storage/seed.ts` 的默认模板重排为固定结构（标题置顶）：

```text
【任务完成通知】
标题：{{title}}
任务 {{task_id}}（来源 {{source_agent}}）已结束
结果：{{result_status}}
结束时间：{{finished_at}}
概要：{{result_summary}}
```

**Rationale/理由**: 白名单新增 `title` 满足 FR-001/FR-010（模板可定制且可引用标题）；标题置于正文首行使通知一眼可识别（FR-003）；固定结构满足 FR-007。白名单机制保证未知占位符在保存/渲染时即报错，不引入注入面。

**Alternatives Considered/备选方案**: 标题并入概要（削弱识别性，拒绝）；不新增占位符而在渲染层硬拼接标题（破坏模板可定制性与 FR-010，拒绝）。

## R5: Existing Default Template Migration/存量默认模板迁移

**Decision/决策**: `title` 为**在途字段，不落库**，故**无表结构迁移**。但已初始化安装的数据库中，旧默认模板（无 `{{title}}`）不会因 `seedDefaultTemplates` 的幂等逻辑自动更新——需在 `seedDefaultTemplates` 增加"存量默认模板升级"：当某 `is_builtin && is_default` 模板正文仍等于旧内置正文（无 `{{title}}` 的旧版本）时，将其替换为新内置正文；用户已自定义（正文 ≠ 旧内置正文）的模板保持不变。

**Rationale/理由**: 标题不参与去重/历史语义，仅在渲染瞬间使用，落库属于无理由的持久化复杂度（宪法原则 I）。但存量默认模板必须升级，否则老用户装上新版本仍收到旧格式（缺陷未解决）；仅覆盖"未改动过的旧内置正文"保证不覆盖用户自定义（FR-010 + 原则 III）。

**Alternatives Considered/备选方案**: 为 `title` 新增 `task_events` 列（历史展示需要时才应加，YAGNI，拒绝）；无条件覆盖所有默认模板（覆盖用户编辑，违背 FR-010，拒绝）；不迁移旧模板（老用户缺陷残留，拒绝）。

## Conclusion/结论

全部技术未知项已决策，无 `NEEDS CLARIFICATION` 残留。选型总体特征：**零新依赖 + 零表结构变更 + 纯函数核心**（标题兜底、本地时间格式化、概要兜底、模板白名单），与宪法六项原则一一对应（见 [plan.md](plan.md) Constitution Check）。
