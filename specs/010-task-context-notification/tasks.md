# Tasks: Task Context Notification/任务清单：任务上下文通知

**Input/输入**: Design documents from `/specs/010-task-context-notification/`

**Prerequisites/前置**: [plan.md](plan.md)、[spec.md](spec.md)、[research.md](research.md)、[data-model.md](data-model.md)、[contracts/task-context.md](contracts/task-context.md)

**Tests/测试**: 本项目宪法原则 II「测试先行（不可协商）」要求 TDD，因此测试任务为**必选**，且必须先写并确认失败（Red）再实现（Green）。

**Organization/组织**: 任务按用户故事分组，每个故事可独立实现、独立测试、独立交付。

## Format/格式: `[ID] [P?] [Story] Description`

- **[P]**：可并行（不同文件、无未完成依赖）
- **[Story]**：所属用户故事（US1/US2/US3）
- 描述含精确文件路径

## Path Conventions/路径约定

单项目结构：`src/`、`tests/` 位于仓库根。本特性不新增依赖、不改表结构，改动收敛于 `src/core/transcript-title.ts`、`src/core/event-pipeline.ts`、`src/cli/hook.ts` 与配套测试。

---

## Phase 1: Setup (Shared Infrastructure)/阶段 1：搭建（共享基础设施）

**Purpose/目的**: 准备测试所需的虚构转录数据（宪法原则 IV：测试不得使用真实对话）。

- [x] T001 [P] 在 `tests/fixtures/transcript-context.jsonl` 构造虚构转录，含四类记录：`{"type":"ai-title","aiTitle":"..."}`、`{"type":"summary","summary":"...","providerData":{"source":"initial-user-message"}}`、完整 `assistant`（`role:"assistant"`、`content[].output_text.text`、`status:"complete"`）、中断 `assistant`（`status:"incomplete"`、文本 `Interrupted by user`）；全部使用虚构会话 ID 与文本，不得含真实对话

---

## Phase 2: Foundational (Blocking Prerequisites)/阶段 2：基础（阻塞前提）

**Purpose/目的**: 转录解析核心纯函数，所有用户故事都依赖，必须先完成。

**⚠️ CRITICAL/关键**: 本阶段完成前，任何用户故事不得开始。

- [x] T002 先写单元测试（Red）：在 `tests/unit/transcript-title.test.ts` 断言字段识别与结论提取——`ai-title` 记录取 `aiTitle` 字段、`summary` 记录取 `summary` 字段、结论取最后一条 `role:"assistant"` 且 `status != "incomplete"` 的 `output_text`、跳过 `incomplete`/`Interrupted by user`；运行确认失败
- [x] T003 实现（Green）：改造 `src/core/transcript-title.ts`——将 `readTranscriptTitle` 重构为 `readTranscriptContext`，返回 `{ title, firstUserMessage, conclusion }`；修正字段识别（识别 `aiTitle`/`summary`，保留 `title/topic/name/text` 兼容）；新增结论提取（最后一条完整 assistant 的 `output_text`）；标题截断至 100（`data-model.md` 约束「字符串，最长 100」）（依赖 T002）

**Checkpoint/检查点**: 转录解析纯函数就绪，用户故事可并行开始。

---

## Phase 3: User Story 1 - Readable Task Title/可读任务标题 (Priority: P1) 🎯 MVP

**Goal/目标**: 通知首行展示任务可读主题（`custom-title` → `aiTitle` → `summary` → 首条消息 → 技术标识兜底），而非仅技术标识。

**Independent Test/独立验证**: 带 `transcript_path` 的负载触发通知，通知标题为提取的可读主题而非 `{source} · {taskId 前 6}`。

### Tests for User Story 1/测试（先行，Red）

- [x] T004 [P] [US1] 在 `tests/unit/transcript-title.test.ts` 断言标题兜底链：`custom-title` 优先、其次 `ai-title`(`aiTitle`)、再次 `summary`(`summary`)、再次首条真实用户消息、最后技术标识兜底 `{source} · {taskId 前 6 字符}`；运行确认失败

### Implementation for User Story 1/实现

- [x] T005 [US1] 在 `src/cli/hook.ts` 的 `mapCodeBuddyStopPayload` 中改用 `readTranscriptContext` 提取标题并填充 `payload.title`（长度 ≤100，`data-model.md` 约束）（依赖 T003）

**Checkpoint/检查点**: US1 可独立验证——通知标题可读。

---

## Phase 4: User Story 2 - Meaningful Task Summary/有意义的任务概要 (Priority: P2)

**Goal/目标**: 通知概要反映任务结论/内容，优先级 `resultSummary → 任务结论 → 首条用户消息 → 状态兜底`，而非仅「任务成功完成」。

**Independent Test/独立验证**: 虚构转录含完整 assistant 结论时，通知概要展示结论文本而非结果状态词。

### Tests for User Story 2/测试（先行，Red）

- [x] T006 [P] [US2] 在 `tests/contract/notification-content.test.ts` 断言概要优先级：来源 `resultSummary` 优先、其次结论（最后一条完整 assistant 的 `output_text`）、再次 `summary`（首条用户消息）、最后结果状态兜底；运行确认失败

### Implementation for User Story 2/实现

- [x] T007 [US2] 在 `src/core/event-pipeline.ts` 中实现概要填充优先级：`resultSummary → conclusion → firstUserMessage → summaryFallback(result)`，概要长度 ≤500（`data-model.md` 约束「字符串，最长 500」），渲染前敏感过滤（依赖 T003）
- [x] T008 [US2] 在 `src/cli/hook.ts` 的 `mapCodeBuddyStopPayload` 中，当来源未提供 `resultSummary` 时，将 `readTranscriptContext` 返回的 `conclusion`/`firstUserMessage` 作为概要候选填入（依赖 T003）

**Checkpoint/检查点**: US1 与 US2 均可独立工作——标题可读、概要承载结论/内容。

---

## Phase 5: User Story 3 - Distinguish Consecutive Tasks/连续任务可区分 (Priority: P3)

**Goal/目标**: 同一会话连续任务、不同会话任务在通知中身份可区分，不被误认为同一条。

**Independent Test/独立验证**: 同一会话两个不同主题任务的虚构事件，通知携带不同标题/概要。

### Tests for User Story 3/测试（先行，Red）

- [x] T009 [P] [US3] 在 `tests/integration/notify-content.test.ts` 断言：同一 `session_id` 下两个不同 `aiTitle`/`summary` 的事件产生两条可区分通知；不同会话亦如此；运行确认失败

**Checkpoint/检查点**: 全部用户故事独立可用。

---

## Phase 6: Polish & Cross-Cutting Concerns/阶段 6：收尾与横切关注点

**Purpose/目的**: 转录定位兜底与端到端质量验证。

- [x] T010 [P] 在 `src/cli/hook.ts` 实现转录定位：`transcript_path` 优先；缺失时按 `session_id` 在 `~/.codebuddy/projects/<project-slug>/` 下匹配 `<session_id>.jsonl`；并验证 `session_id → 文件名` 映射关系（[research.md](research.md) R5 待验证项）
- [x] T011 运行 [quickstart.md](quickstart.md) 场景 B/C/D 端到端验证，核对通知文本（标题可读、概要承载结论、兜底链路正确）
- [x] T012 质量关卡：`npm test`、`npm run build`、`npm run lint`、`npm run format:check` 全部退出码 0；安全抽查（转录正文/路径不落日志、测试无真实数据）

---

## Dependencies & Execution Order/依赖与执行顺序

### Phase Dependencies/阶段依赖

- **Setup (Phase 1)**: 无依赖，立即开始
- **Foundational (Phase 2)**: 依赖 Setup，**阻塞所有用户故事**
- **User Stories (Phase 3-5)**: 均依赖 Foundational；之后可并行或按 P1→P2→P3 顺序
- **Polish (Phase 6)**: 依赖所有目标用户故事完成

### User Story Dependencies/用户故事依赖

- **US1 (P1)**: Foundational 完成后即可，无跨故事依赖
- **US2 (P2)**: Foundational 完成后即可，复用 US1 的 `readTranscriptContext`（T003），可独立测试
- **US3 (P3)**: Foundational 完成后即可，验证 US1/US2 的标题/概要已足以区分任务

### Within Each User Story/故事内部顺序

- 测试先行：写测试 → 确认失败（Red）→ 最小实现（Green）
- 纯函数实现先于映射层/管线接入
- 一个故事完成后再进入下一优先级

### Parallel Opportunities/并行机会

- Phase 1 的 T001 可单独并行
- Phase 2 的 T002→T003 串行（测试先行），完成后 T004/T006/T009 三个测试任务可并行
- T005、T007、T008 均依赖 T003，可分属不同故事由不同成员并行
- T010、T011、T012 位于收尾，T010 可与 T011 并行

---

## Parallel Example: Foundational Completion/并行示例：基础完成后

```bash
# 基础（T002→T003）完成后，三个故事的测试可并行：
Task: "T004 标题兜底链单元测试 in tests/unit/transcript-title.test.ts"
Task: "T006 概要优先级契约测试 in tests/contract/notification-content.test.ts"
Task: "T009 连续任务可区分集成测试 in tests/integration/notify-content.test.ts"
```

---

## Implementation Strategy/实现策略

### MVP First (User Story 1 Only)/先交付 MVP（仅 US1）

1. 完成 Phase 1: Setup
2. 完成 Phase 2: Foundational（阻塞，关键）
3. 完成 Phase 3: User Story 1（标题可读）
4. **STOP and VALIDATE/停下验证**: 独立测试 US1——通知标题已可读
5. 可交付/演示

### Incremental Delivery/增量交付

1. Setup + Foundational → 基础就绪
2. +US1 → 独立验证 → 交付（MVP：标题可识别任务）
3. +US2 → 独立验证 → 交付（概要承载结论）
4. +US3 → 独立验证 → 交付（任务可区分）
5. 每个故事不破坏前序故事

### Parallel Team Strategy/并行团队策略

1. 团队共同完成 Setup + Foundational
2. Foundational 完成后：成员 A 做 US1、成员 B 做 US2、成员 C 做 US3
3. 各故事独立完成并集成

---

## Notes/说明

- [P] 任务 = 不同文件、无依赖
- [Story] 标签将任务映射到具体用户故事以便追踪
- 每个用户故事应可独立完成、独立测试
- 先验证测试失败再实现（宪法原则 II）
- 每个任务或逻辑组完成后提交
- 可在任意检查点停下独立验证故事
- 避免：模糊任务、同文件冲突、破坏故事独立性的跨故事依赖
