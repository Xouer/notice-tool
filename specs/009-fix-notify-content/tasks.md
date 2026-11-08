# Tasks: Fix Task Completion Notification Content/任务清单：修复任务完成通知内容

**Input**: Design documents from `/specs/009-fix-notify-content/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/（均就绪）

**Tests**: 依据宪法原则 II（测试先行不可协商），本清单包含测试任务并按 **TDD（Red-Green-Refactor）顺序**组织：每阶段的"Tests/测试"小节先行，测试必须先编写并确认失败（Red），再实现使其通过（Green）。

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story./任务按用户故事分组（US1–US4），保证每个故事可独立实现与测试。

## Format: `[ID] [P?] [Story] Description`/格式说明

- **[P]**: Can run in parallel (different files, no dependencies)/可并行（不同文件、无未完成依赖）
- **[Story]**: Which user story this task belongs to/所属用户故事（US1–US4）
- Include exact file paths in descriptions/描述含确切文件路径

## Path Conventions/路径约定

- Single project（单项目）: `src/`、`tests/` at repository root（依据 plan.md 项目结构）。

---

## Phase 1: Setup (Shared Infrastructure)/阶段一：初始化（共享基础设施）

**Purpose**: Project initialization and basic structure/项目初始化与基础结构。

本特性为既有项目（001）的**缺陷修复**，项目骨架、依赖、构建与测试基建均已就绪，**无需新增初始化任务**。直接进入阶段二。

---

## Phase 2: Foundational (Blocking Prerequisites)/阶段二：基础设施（阻塞性前置）

**Purpose**: 所有用户故事实现前必须完成的共享纯函数与类型扩展/核心纯函数与模板白名单扩展。

**⚠️ CRITICAL**: No user story work can begin until this phase is complete./本阶段完成前不得开始任何用户故事。

### Tests for Foundation（先写并确认 Red）

- [x] T001 [P] Unit tests: notification-content pure functions in tests/unit/notification-content.test.ts — 断言 `formatLocalDateTime` 输出 `YYYY-MM-DD HH:mm:ss`（24 小时制、本地时区），给定 UTC ISO 时间输入（如 `2026-11-08T04:15:47.269Z`）在 UTC+8 环境输出 `2026-11-08 12:15:47`；`titleFallback(sourceAgent, taskId)` 输出 `{source_agent} · {taskId 前 6 字符}`（如 `codebuddy · 0c489a`）；`summaryFallback(resultStatus)` 四态映射 `success→任务成功完成`、`failure→任务失败`、`interrupted→任务被中断`、`unknown→任务结束（结果未知）`（data-model.md 渲染语义）
- [x] T003 [P] Unit tests: template whitelist title in tests/unit/template.test.ts — 断言 `{{title}}` 可被 `extractPlaceholders` 识别并被 `renderTemplate` 替换；未知占位符（如 `{{foo}}`）仍抛 `TemplateError`；正文 ≤ 2000 字符校验不变

### Implementation for Foundation

- [x] T002 Implement pure functions in src/core/notification-content.ts — `formatLocalDateTime(date)`（基于 `Date` 本地 getter 手工拼装，零依赖）、`titleFallback(sourceAgent, taskId)`、`summaryFallback(resultStatus)`（依赖 T001）
- [x] T004 Extend PLACEHOLDERS + PlaceholderValues with title in src/core/template.ts — 白名单 `PLACEHOLDERS` 增补 `"title"`；`PlaceholderValues` 增补 `title: string` 字段（依赖 T003）

**Checkpoint**: 纯函数与模板白名单就绪，用户故事可开始。

---

## Phase 3: User Story 1 - Recognizable Task Title/用户故事一：可识别的任务标题 (Priority: P1) 🎯 MVP

**Goal**: 通知首行出现可识别任务标题——来源提供标题时用原值，缺失时生成可读兜底标题/解决"不知道哪个对话任务结束"。

**Independent Test**: `echo '{"schemaVersion":1,"source":"codebuddy","taskId":"0c489af57ca84e9599e46cf2da32a945","title":"修复登录页样式问题","result":"success"}' | notice hook` → 飞书收到通知，首行标题为"修复登录页样式问题"；去掉 `title` 再发一条（换 taskId）→ 标题为 `codebuddy · 0c489a`。

### Tests for User Story 1（先写并确认 Red）

- [x] T005 [P] [US1] Unit tests: title parsing in tests/unit/event-pipeline.test.ts — `validateEventPayload` 断言 `title` 为可选字段、非空字符串、长度 ≤ 100；长度 > 100 整体拒绝并报 `title 长度 ... 超过上限 100`；缺省返回 `undefined`
- [x] T006 [P] [US1] Unit tests: source title mapping in tests/unit/hook-mapping.test.ts — `mapCodeBuddyStopPayload`/`mapCodexNotifyPayload` 断言 title 抽取优先级：codebuddy/claude-code 取 `title` → `conversation_title` → `session_title`；codex-cli 取 `title` → `thread-title`/`thread_title`（research.md R1）；无任何 title 字段时 payload 不含 `title`
- [x] T007 [P] [US1] Contract tests: title rendering in tests/contract/notification-content.test.ts — 按 contracts/notification-content.md 断言：含 `title` 负载渲染后通知首行为该标题；不含 `title` 负载渲染后首行为兜底标题 `{source} · {taskId 前 6 位}`；标题敏感过滤（如含 `sk-xxx` 样式密钥被 `[REDACTED]` 替换或回退兜底）

### Implementation for User Story 1

- [x] T008 [US1] Add title field to NormalizedEvent + parse in validateEventPayload in src/core/event-pipeline.ts — `NormalizedEvent.title?: string`；解析 `body.title`（非空字符串、≤ 100，超长报错）；缺省 `undefined`（依赖 T005）
- [x] T009 [US1] Map title from source payload in src/cli/hook.ts — `mapCodeBuddyStopPayload` 增补 `title`（title→conversation_title→session_title）；`mapCodexNotifyPayload` 增补 `title`（title→thread-title/thread_title）；非空才写入 payload（依赖 T006）
- [x] T010 [US1] Add title to REPORT_TASK_END_SCHEMA in src/mcp/server.ts — `properties` 增补 `title: { type: "string", maxLength: 100, description: "任务标题（可选）" }`（依赖 T007）
- [x] T011 [US1] Wire title into PlaceholderValues in src/core/event-pipeline.ts — `title = filterSensitiveSummary(event.title, 100) ?? titleFallback(event.source, event.taskId)`；`values.title` 用于渲染（依赖 T008、T002）
- [x] T012 [US1] Add title to PlaceholderValues in src/mcp/tools/send-notification.ts — 即时通知的 `values` 增补 `title: validated.title ?? "即时通知"`（保持类型兼容，依赖 T004）

**Checkpoint**: US1 独立可演示——通知首行标题可识别（quickstart.md 场景 A/B）。

---

## Phase 4: User Story 2 - Correct and Human-Readable End Time/用户故事二：正确且可读的结束时间 (Priority: P1) 🎯 MVP

**Goal**: 结束时间以用户本地时区、`YYYY-MM-DD HH:mm:ss` 人类可读格式渲染，替换原始 UTC ISO/解决"时间不对"。

**Independent Test**: `echo '{"schemaVersion":1,"source":"codebuddy","taskId":"task-time","finishedAt":"2026-11-08T04:15:47.269Z"}' | notice hook` → 通知中"结束时间"为本地 `2026-11-08 12:15:47`（UTC+8），而非 `...T04:15:47.269Z`。

### Tests for User Story 2（先写并确认 Red）

- [x] T013 [P] [US2] Integration tests: finished_at local rendering in tests/integration/notify-content.test.ts — 模拟事件（`finishedAt` 为 UTC ISO）→ `:memory:` 库 → 假渠道适配器 → 断言最终通知文本 `结束时间：` 后为本地 `YYYY-MM-DD HH:mm:ss`；`finishedAt` 缺失时用接收时间（contracts/notification-content.md 渲染规则）

### Implementation for User Story 2

- [x] T014 [US2] Replace finished_at rendering with formatLocalDateTime in src/core/event-pipeline.ts — `PlaceholderValues.finished_at` 由 `event.finishedAt.toISOString()` 改为 `formatLocalDateTime(event.finishedAt)`（依赖 T002、T013）

**Checkpoint**: US2 独立可演示——结束时间本地可读（quickstart.md 场景 A）。

---

## Phase 5: User Story 3 - Non-Empty Result Summary/用户故事三：非空的概要结论 (Priority: P2)

**Goal**: "概要"字段始终有内容——来源未提供或敏感过滤后为空时，按结果状态生成有意义的兜底结论/解决"概要没内容"。

**Independent Test**: `echo '{"schemaVersion":1,"source":"codebuddy","taskId":"task-sum","result":"success"}' | notice hook` → 通知中"概要："显示"任务成功完成"而非空白；改 `result` 为 `failure` → 显示"任务失败"。

### Tests for User Story 3（先写并确认 Red）

- [x] T015 [P] [US3] Integration tests: summary non-empty fallback in tests/integration/notify-content.test.ts — `resultSummary` 缺失时通知文本 `概要：` 后为对应结论（success/failure/interrupted/unknown 四态）；`resultSummary` 经敏感过滤后为空时同样回退兜底（data-model.md 渲染语义）

### Implementation for User Story 3

- [x] T016 [US3] Wire summary fallback in src/core/event-pipeline.ts — `result_summary = filterSensitiveSummary(event.resultSummary) ?? summaryFallback(event.result)`（依赖 T002、T015）

**Checkpoint**: US3 独立可演示——概要非空且有结论（quickstart.md 场景 A/B）。

---

## Phase 6: User Story 4 - Fixed and Consistent Notification Format/用户故事四：固定且统一的格式 (Priority: P2)

**Goal**: 默认通知按固定结构（标题 → 任务标识 → 结果 → 时间 → 概要）跨渠道一致，存量旧默认模板升级/解决"缺少固定格式"。

**Independent Test**: `notice channel add email` 后发送同一事件 → 飞书与邮箱收到结构一致的通知；`notice template list` 确认默认模板含 `{{title}}` 且顺序固定。

### Tests for User Story 4（先写并确认 Red）

- [x] T017 [P] [US4] Unit tests: default template seed & migration in tests/unit/seed.test.ts — 新默认模板含 `{{title}}` 且结构为"标题 → 任务 → 结果 → 时间 → 概要"；存量旧内置正文（无 `{{title}}`）在 `seedDefaultTemplates` 时被升级为新正文；正文 ≠ 旧内置正文（用户已自定义）不被覆盖（research.md R5）
- [x] T018 [P] [US4] Contract tests: fixed format consistency in tests/contract/notification-content.test.ts — 按 contracts/notification-content.md 断言默认模板字段顺序与齐全性；五类渠道默认模板正文一致（仅渠道适配差异）

### Implementation for User Story 4

- [x] T019 [US4] Update default template + migration in src/storage/seed.ts — 重写 `DEFAULT_BODY` 为固定结构（`标题：{{title}}` 置顶 + `任务 {{task_id}}（来源 {{source_agent}}）已结束` + `结果：{{result_status}}` + `结束时间：{{finished_at}}` + `概要：{{result_summary}}`）；`seedDefaultTemplates` 增补"存量旧内置正文升级"逻辑（仅当正文等于旧内置正文时替换）（依赖 T017）
- [x] T020 [US4] Update renderForChannel fallback message in src/core/dispatcher.ts — 无默认模板时的兜底文本增补 `标题：${values.title}` 并保持与固定格式一致（依赖 T004、T019）

**Checkpoint**: US4 独立可演示——跨渠道固定格式，存量安装升级后生效（quickstart.md 场景 C/D）。

---

## Phase 7: Polish & Cross-Cutting Concerns/阶段七：打磨与横切关注点

**Purpose**: Improvements that affect multiple user stories/影响多个用户故事的收尾工作。

- [x] T021 [P] Run quickstart.md validation — 依次执行 Setup + 场景 A–D，对照预期结果并修复偏差
- [x] T022 [P] Security hardening audit across src/ and tests/ — 验证标题/概要经敏感过滤，通知内容零明文凭据/密钥（FR-009/宪法 IV）；错误信息无原始负载回显
- [x] T023 Final merge gate — 全量 `npm test` 通过 + 宪法合规自查（六原则逐项，重点 II/III/IV/VI）+ 至少一名非作者代码审查（宪法原则 V）后方可合入

---

## Dependencies & Execution Order/依赖与执行顺序

### Phase Dependencies/阶段依赖

- **Setup (Phase 1)**: 无任务（既有项目已初始化）
- **Foundational (Phase 2)**: 阻塞所有用户故事（纯函数与模板白名单为共享前置）
- **User Stories (Phase 3–6)**: 均依赖阶段二完成；顺序执行 US1 → US2 → US3 → US4（P1 → P1 → P2 → P2）
- **Polish (Phase 7)**: 依赖全部用户故事完成

### User Story Dependencies/用户故事依赖

- **US1 (P1)**: Phase 2 后即可开始，不依赖其他故事
- **US2 (P1)**: Phase 2 后即可开始；复用 T002 的 `formatLocalDateTime`；与 US1 同属 MVP
- **US3 (P2)**: Phase 2 后即可开始；复用 T002 的 `summaryFallback`
- **US4 (P2)**: 依赖 T004（模板白名单 `title`）；与 US1/US2/US3 的渲染语义共同作用
- MVP = US1 + US2；US3/US4 为增量补强，各自独立可验证

### Within Each User Story/故事内部顺序

- Tests MUST be written and FAIL before implementation（Red）/测试先写并确认失败，再实现（Green）
- 纯函数先于管线接线；管线接线先于默认模板/迁移（US4）

### Parallel Opportunities/并行机会

- Phase 2: T001/T003 测试并行；实现 T002/T004 并行
- US1: 测试 T005/T006/T007 并行；实现 T008–T012 中 T010 与 T012 与 T008 无相互依赖可部分并行
- US4: 测试 T017/T018 并行
- Phase 7: T021/T022 并行
- 注意：`src/core/event-pipeline.ts` 被 T008/T011/T014/T016 依次修改，**必须顺序执行**（同文件、同函数区）

---

## Parallel Example: User Story 1/并行示例：用户故事一

```bash
# 先并行编写 US1 全部测试（Red）：
Task: "T005 [P] [US1] Unit tests: title parsing in tests/unit/event-pipeline.test.ts"
Task: "T006 [P] [US1] Unit tests: source title mapping in tests/unit/hook-mapping.test.ts"
Task: "T007 [P] [US1] Contract tests: title rendering in tests/contract/notification-content.test.ts"

# 确认失败后并行实现（不同文件）：
Task: "T010 [US1] Add title to REPORT_TASK_END_SCHEMA in src/mcp/server.ts"
Task: "T012 [US1] Add title to PlaceholderValues in src/mcp/tools/send-notification.ts"
```

---

## Implementation Strategy/实施策略

### MVP First (User Story 1 + 2)/MVP 优先

1. Complete Phase 2: Foundational（阻塞项：纯函数 + 模板白名单）
2. Complete Phase 3: US1（标题）→ 独立验证
3. Complete Phase 4: US2（时间）→ **STOP and VALIDATE**: US1+US2 即 MVP，解决"无标题 + 时间不对"两大核心痛点
4. 增量：Phase 5: US3（概要）→ Phase 6: US4（固定格式）
5. Phase 7: 打磨与安全收尾

### Incremental Delivery/增量交付

每个 Checkpoint 都是可独立验证的增量：标题识别 → 本地可读时间 → 非空概要 → 固定格式；任一故事交付不破坏已交付故事（宪法 III：`title` 仅可选新增，旧负载/旧模板/旧数据不受影响）。

---

## Notes/备注

- TDD 顺序为硬约束（宪法 II）：未先写测试并确认失败的功能代码不得合入
- [P] tasks = different files, no dependencies/不同文件且无未完成依赖
- [Story] label maps task to specific user story for traceability/故事标签用于追溯
- Commit after each task or logical group/每任务或逻辑组完成后提交
- 字段约束已在任务描述中逐条引用（`title ≤ 100`、兜底标题格式、四态概要结论、本地时间格式），实现时不得自行放宽
- 巡查适配器（`AgentTask`）可选抽取标题为后续增量，不在本特性范围（缺失时走兜底标题即可）
- Avoid: vague tasks, same file conflicts, cross-story dependencies that break independence/避免模糊任务、同文件冲突、破坏独立性的跨故事依赖
