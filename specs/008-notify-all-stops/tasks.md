---
description: "Task list for Notify All Conversation Stops implementation"
---

# Tasks/任务: Notify All Conversation Stops/所有对话停止事件均通知

**Input/输入**: Design documents from `/specs/008-notify-all-stops/`

**Prerequisites/前置文档**: [plan.md](plan.md)、[spec.md](spec.md)、[research.md](research.md)、[data-model.md](data-model.md)、[contracts/stop-notification.md](contracts/stop-notification.md)、[quickstart.md](quickstart.md)

**Tests/测试**: 必须包含测试任务；项目宪法要求所有缺陷修复严格遵循 Red-Green-Refactor。

**Organization/组织方式**: 按用户故事组织，每个故事均可独立验证；共享事件身份与持久化在 Foundational 阶段完成。

## Format/格式

- `[P]` 表示任务可与同阶段其他 `[P]` 任务并行：涉及不同文件，且不依赖未完成任务。
- `[US1]`、`[US2]` 对应规格中的用户故事；Setup、Foundational、Polish 不使用故事标签。
- 所有路径均相对于仓库根目录；先写公开行为测试并确认失败，再编写实现。

## Phase 1: Setup/阶段一：测试准备

**Purpose/目的**: 在现有单项目中准备虚构来源样本，不初始化新框架、不增加依赖。

- [ ] T001 [P] 扩充 CodeBuddy/Claude 虚构 Stop 与终态转录样本，覆盖显式事件 ID、终态 UUID/时间戳/稳定偏移及缺省元数据，修改 `tests/fixtures/dialog-sources/codebuddy-stop-sample.json`，新增 `tests/fixtures/dialog-sources/claude-stop-sample.json` 和 `tests/fixtures/dialog-sources/codebuddy-transcript-sample.jsonl`
- [ ] T002 [P] 扩充 Codex notify 与 rollout 虚构样本，使同一 `turn_complete` 可用稳定事件身份对齐并包含连续两个不同终态，修改 `tests/fixtures/dialog-sources/codex-notify-sample.json` 和 `tests/fixtures/dialog-sources/codex-rollout-sample.jsonl`

**Checkpoint/检查点**: 所有夹具只含虚构会话、路径和消息，可供来源映射、巡查和跨触发测试共同使用。

---

## Phase 2: Foundational/阶段二：共享事件身份与持久化

**Purpose/目的**: 建立所有故事共用的可选 `eventKey`、兼容去重和原子受理基础。

**Critical/关键要求**: 本阶段完成前不得开始用户故事实现。

### Foundational Tests/基础测试

> 先完成 T003-T005，再执行 T006；新增测试必须在旧实现上失败。

- [ ] T003 [P] 在 `tests/contract/hook-payload.test.ts` 增加 `schemaVersion: 1` 可选 `eventKey` 契约测试：合法值通过，空白、非字符串和超过 512 字符返回 `VALIDATION_FAILED`，未提供时保持旧行为
- [ ] T004 [P] 新增 `tests/integration/event-key-migration.test.ts`，验证 `task_events.event_key` 为可空文本、复合索引为 `(source_agent, task_id, event_key, received_at)`、旧行不回填且全新初始化与旧库升级均可受理旧无键事件
- [ ] T005 [P] 在 `tests/unit/dedup.test.ts` 增加稳定键判重测试：同 `(sourceAgent, taskId, eventKey)` 判重，同会话不同键放行，不同摘要/结束时间/触发方式不改变同键判重，无键旧调用保留冷却语义并与有键事件隔离
- [ ] T006 按 `specs/008-notify-all-stops/quickstart.md` 场景 A 运行 T003-T005 定向测试，确认新增断言因缺少事件键字段、迁移和新去重语义而 Red，并排除夹具或测试命令错误

### Foundational Implementation/基础实现

- [ ] T007 在 `src/core/event-pipeline.ts` 的 `NormalizedEvent` 与负载校验中增加可选 `eventKey`：必须是非空字符串且最长 512，非法显式值整体拒绝，缺失值不报错，其他既有字段规则不变
- [ ] T008 在 `src/storage/schema.ts` 为 `task_events` 增加可空 `event_key` 和 `(source_agent, task_id, event_key, received_at)` 索引，通过 `drizzle.config.ts` 使用 `npm run db:generate` 生成 `drizzle/` 与 `drizzle/meta/` 版本化迁移，不回填旧行且不添加唯一约束
- [ ] T009 在 `src/core/dedup.ts` 实现双分支判重：有键按 `(sourceAgent, taskId, eventKey)` 在现有 30 天保留历史内判重，无键按原 `(sourceAgent, taskId, cooldownMinutes)` 判重，并确保两种分支互不误合并（依赖 T007、T008）
- [ ] T010 在 `src/core/event-pipeline.ts` 持久化 `eventKey`，将判重检查与首次事件写入置于同一同步存储事务，重复上报仍新增 `duplicated` 事件且不分发，首次事件继续复用现有模板、渠道和重试流程（依赖 T009）
- [ ] T011 按 `specs/008-notify-all-stops/quickstart.md` 场景 A 和场景 G 运行 T003-T005 及既有去重/负载/迁移测试，确认全部 Green 且旧无键 CLI、HTTP、MCP 契约未回归

**Checkpoint/检查点**: 标准事件可携带稳定身份，旧数据库与旧调用兼容，用户故事可开始。

---

## Phase 3: User Story 1/阶段三：用户故事 1 - Receive Notification for Every Stop/每次停止均收到通知 (Priority: P1)

**Goal/目标**: 单轮问答和多步骤任务只要实际触发 `Stop` 就通知，当前对话保持打开不影响处理，缺少可选元数据不再造成漏报。

**Independent Test/独立测试**: 按 `specs/008-notify-all-stops/quickstart.md` 场景 B，在同一保持打开的 CodeBuddy 对话中分别完成一次单轮问答和一次多步骤任务，两次实际 Stop 均各自产生一轮通知；仅停留窗口但未触发 Stop 时不新增通知。

### Tests for User Story 1/用户故事 1 测试

> 先完成 T012-T013，再执行 T014；不得先改来源映射实现。

- [ ] T012 [P] [US1] 在 `tests/unit/hook-source-mapping.test.ts` 增加单轮与多步骤负载、显式 `eventKey` 透传、缺少 `session_id/thread-id` 时使用 `unknown-session`、缺省结果与摘要、Claude 来源保持 `claude-code`、无稳定身份时降级受理及脱敏警告测试
- [ ] T013 [P] [US1] 在 `tests/integration/notify-flow.test.ts` 增加当前对话单轮和多步骤 Stop 的端到端测试，验证两类事件均进入同一分发管线、窗口状态不参与判断、未收到 Stop 不合成事件、无渠道与渠道失败状态不被误记为成功
- [ ] T014 [US1] 按 `specs/008-notify-all-stops/quickstart.md` 场景 A 运行 T012-T013，确认新增断言因旧来源必填校验、Claude 来源硬编码和缺少身份解析而 Red

### Implementation for User Story 1/用户故事 1 实现

- [ ] T015 [US1] 在 `src/cli/hook.ts` 将来源显式传入共用映射，修正 Claude `source=claude-code`，为缺失会话 ID 的来源事件提供 `unknown-session`，保留缺省结果/摘要/时间和 Codex 非目标事件忽略规则，并透传合法显式 `eventKey`
- [ ] T016 [US1] 新增 `src/core/stop-identity.ts` 并在 `src/cli/hook.ts` 使用：按“显式 ID → 有界终态记录 UUID/时间戳/稳定偏移 → 每次调用降级键”生成不可逆事件键，限制转录尾部读取，读取失败仍通知并输出不含路径/正文的警告，同时更新重复事件人读提示
- [ ] T017 [US1] 按 `specs/008-notify-all-stops/quickstart.md` 场景 B 运行 T012-T013 与真实 CodeBuddy 手动验证，确认单轮、多步骤和窗口保持打开场景全部 Green，并核对通知及日志不含凭据、完整转录路径或对话正文

**Checkpoint/检查点**: 用户故事 1 可独立交付，形成“当前对话实际 Stop → 已启用渠道通知”的 MVP。

---

## Phase 4: User Story 2/阶段四：用户故事 2 - Distinguish New Stops from Duplicate Reports/区分新停止与重复上报 (Priority: P2)

**Goal/目标**: 同一对话中的新 Stop 独立通知，同一 Stop 的重复投递和跨触发上报只通知一轮，连续巡查终态与事件级历史均可追溯。

**Independent Test/独立测试**: 按 `specs/008-notify-all-stops/quickstart.md` 场景 D，在同一 `taskId` 下发送两个不同 `eventKey` 并重复发送其中一个，验证恰好两轮通知和一条重复历史；无需依赖真实智能体即可独立验证本故事核心行为。

### Tests for User Story 2/用户故事 2 测试

> 先完成 T018-T023，再执行 T024；测试文件之间可并行。

- [X] T018 [P] [US2] 在 `tests/integration/notify-flow.test.ts` 增加同一稳定键连续及并发重复 10 次仅一轮通知、同会话不同键各自通知、重复事件写 `duplicated` 历史、原子判重和失败渠道记录准确的集成测试
- [X] T019 [P] [US2] 在 `tests/integration/polling-flow.test.ts` 增加相同终态键重复扫描不上报、连续结束态出现新终态键仍上报、启动补检窗口不变的测试
- [X] T020 [P] [US2] 在 `tests/integration/codex-notify-flow.test.ts` 增加 Codex 新 turn 通知、同一 `turn_complete` 经 notify 与 polling 跨入口仅一轮通知的测试
- [X] T021 [P] [US2] 在 `tests/contract/cli-history.test.ts` 增加 `history events` 默认/ limit/状态过滤/空结果/`--json` 的 `events` 结构测试，验证 `received/duplicated/dispatched` 可见且现有 `records` 输出与 `resend` 不变
- [X] T022 [P] [US2] 在 `tests/unit/poller-claude-code.test.ts` 增加从每个 `result` 终态记录提取稳定 `eventKey`、损坏行跳过和路径/正文不进入事件键的测试
- [X] T023 [P] [US2] 在 `tests/unit/poller-codex-cli.test.ts` 增加从每个 `turn_complete` 提取稳定 `eventKey`、连续终态键不同和与 notify 身份对齐的测试
- [X] T024 [US2] 按 `specs/008-notify-all-stops/quickstart.md` 场景 A 运行 T018-T023，确认连续终态、跨入口事件键和事件历史断言在旧实现上 Red

### Implementation for User Story 2/用户故事 2 实现

- [X] T025 [US2] 在 `src/pollers/adapter.ts` 为 `AgentTask` 增加可选 `eventKey`，并在 `src/pollers/scheduler.ts` 保存最后终态事件键：相同键不上报，新终态键即使持续结束态也上报，载荷传递事件键且启动补检规则不变
- [X] T026 [P] [US2] 在 `src/pollers/claude-code.ts` 复用 `src/core/stop-identity.ts`，从每个 Claude `result` 终态记录生成与钩子一致的散列事件键，保留现有尾部读取和损坏行处理（依赖 T016、T025）
- [X] T027 [P] [US2] 在 `src/pollers/codex-cli.ts` 复用 `src/core/stop-identity.ts`，从每个 Codex `turn_complete` 生成与 notify 对齐的散列事件键并保留最后摘要和状态映射（依赖 T016、T025）
- [X] T028 [P] [US2] 在 `src/cli/history.ts` 新增 `notice history events [--limit N] [--status received|duplicated|dispatched]` 只读子命令，默认 limit 20，支持人读与 `{ "events": [...] }`，仅展示事件键不可逆短摘要且不改变现有历史与重发命令
- [X] T029 [US2] 按 `specs/008-notify-all-stops/quickstart.md` 场景 D-F 运行 T018-T023 及手动重复负载验证，确认两轮通知、十次重复仅一轮、连续终态和跨触发去重全部 Green（依赖 T026、T027、T028）
- [X] T030 [US2] 按 `specs/008-notify-all-stops/quickstart.md` 场景 E 检查 `received/duplicated/dispatched` 与各渠道 `sent/failed` 的关联，确认用户能在 2 分钟内区分事件未到达、已去重、发送成功和发送失败，且失败不会被误记为成功

**Checkpoint/检查点**: 用户故事 2 可独立验证，且与用户故事 1 集成后通知轮次与真实 Stop 次数一致。

---

## Phase 5: Polish & Cross-Cutting Concerns/阶段五：文档、安全与完整验证

**Purpose/目的**: 统一现行说明并完成跨故事质量关卡，不增加新功能。

- [X] T031 [P] 更新 `README.md` 的 AI 对话框通知说明，明确单轮与多步骤实际 Stop 均通知、同会话不同 Stop 独立通知、同稳定键跨触发去重及无稳定身份的降级边界
- [X] T032 [P] 同步 `specs/005-ai-task-dialog-link/spec.md`、`specs/005-ai-task-dialog-link/quickstart.md`、`specs/005-ai-task-dialog-link/data-model.md` 和 `specs/005-ai-task-dialog-link/contracts/dialog-source-integration.md`，以本特性的事件键规则取代单轮排除与会话级去重旧口径
- [X] T033 [P] 同步 `specs/006-message-hook-config/spec.md`、`specs/006-message-hook-config/quickstart.md` 和 `specs/006-message-hook-config/data-model.md`，扩充单轮与连续 Stop 验收并保留模板启停语义
- [X] T034 [P] 更新 `specs/001-agent-task-notify/quickstart.md`、`specs/001-agent-task-notify/data-model.md` 和 `specs/001-agent-task-notify/research.md`，区分旧无键冷却去重与新稳定键去重，避免继续声称相同 `taskId` 必然重复
- [X] T035 [P] 在 `tests/integration/notify-flow.test.ts` 和 `tests/contract/cli-history.test.ts` 补充并运行安全回归断言，确保事件键、日志、错误、历史与通知不泄露凭据、完整转录路径、原始对话正文或敏感事件键原文
- [X] T036 按 `specs/008-notify-all-stops/quickstart.md` 的 Full Quality Gates 依次运行完整 `npm test`、`npm run build`、`npm run lint`、`npm run format:check` 和 `node scripts/perf-check.mjs`，修复所有回归并保留退出码结果
- [X] T037 按 `specs/008-notify-all-stops/spec.md` 核对 SC-001 至 SC-008，并依据 `specs/008-notify-all-stops/plan.md` 完成兼容性、安全审查和非作者代码审查；未通过项不得合入

---

## Dependencies & Execution Order/依赖与执行顺序

### Phase Dependencies/阶段依赖

- **Phase 1 Setup**: 无依赖，T001 与 T002 可并行。
- **Phase 2 Foundational**: 依赖 Phase 1；T003-T005 并行编写，T006 确认 Red 后才可执行 T007-T010，T011 通过后解锁故事。
- **Phase 3 US1**: 依赖 Phase 2；T012-T013 并行，T014 Red 后执行 T015 → T016 → T017。
- **Phase 4 US2**: 核心测试在 Phase 2 后可开始；T026-T027 依赖 US1 的 T016 共享身份规则和本阶段 T025，T028 仅依赖 Phase 2，最终集成验证在 US1 后执行。
- **Phase 5 Polish**: 依赖所有目标故事完成；T031-T035 可并行，T036 在其后，T037 最后执行。

### User Story Dependencies/用户故事依赖

- **US1 (P1)**: 仅依赖共享基础，不依赖 US2，可独立交付实际 Stop 通知。
- **US2 (P2)**: 使用共享事件键即可通过合成负载独立测试；与真实 Claude/Codex 来源集成时复用 US1 的 `src/core/stop-identity.ts`，不改变 US1 行为。
- **顺序交付**: 默认按 P1 → P2 执行；只有不同文件且满足上述依赖的任务才并行。

### Within Each User Story/故事内部顺序

1. 准备测试并运行，确认新增公开行为断言失败。
2. 实现模型/映射，再实现服务与入口集成。
3. 运行定向测试和故事独立验证，确认 Green。
4. 重构仅在测试保持通过时进行，不改变已通过的契约。

### Parallel Opportunities/并行机会

- Setup: T001、T002。
- Foundational tests: T003、T004、T005。
- US1 tests: T012、T013。
- US2 tests: T018、T019、T020、T021、T022、T023。
- US2 implementation: 完成 T016 与 T025 后，T026、T027、T028 可并行。
- Polish: T031、T032、T033、T034、T035 可并行。

## Parallel Examples/并行执行示例

### User Story 1/用户故事 1

```text
并行编写 T012：tests/unit/hook-source-mapping.test.ts 来源映射测试
并行编写 T013：tests/integration/notify-flow.test.ts 单轮/多步骤通知集成测试
等待 T014 确认 Red 后，再顺序执行 T015、T016，避免同时修改 src/cli/hook.ts
```

### User Story 2/用户故事 2

```text
并行编写 T018-T023：分别修改 notify-flow、polling-flow、codex-notify-flow、cli-history 和两个 poller 单元测试文件
完成 T016 与 T025 后，并行执行 T026、T027、T028：分别修改 claude-code.ts、codex-cli.ts、history.ts
最后由 T029 统一执行跨触发与历史集成验证
```

## Implementation Strategy/实施策略

### MVP First/最小可用交付（仅用户故事 1）

1. 完成 Phase 1 和 Phase 2，确认事件键、迁移、去重与兼容测试通过。
2. 完成 Phase 3 的来源映射、身份解析和真实 CodeBuddy 验证。
3. 在同一保持打开的对话中验证单轮与多步骤实际 Stop 均通知。
4. 在 MVP 检查点暂停评审，不等待事件历史或文档收尾即可演示核心价值。

### Incremental Delivery/增量交付

1. Foundation ready：旧无键调用兼容，新事件键可用。
2. US1：实际 Stop 全量通知，形成 MVP。
3. US2：连续 Stop、重复上报、巡查和事件历史达到准确可排查。
4. Polish：文档、安全、性能和完整质量关卡全部通过后再合入。

## Notes/备注

- 不得通过关闭去重、把冷却设为零或新增单轮过滤开关实现本特性。
- 稳定 `eventKey` 不等于内部随机 `eventId`；缺省 `finishedAt` 不得用于事件身份。
- 无稳定来源身份时按 P1 优先降级受理并告警，不宣称能精确识别后续重报。
- 同一文件的实现任务未标记 `[P]`，避免并行编辑冲突。
- 所有测试和文档只使用虚构数据；真实凭据、转录正文和完整本机路径不得写入仓库。
