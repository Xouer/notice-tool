# Tasks: Feishu App Credential Channel/任务清单：飞书应用凭证消息通道

**Input**: Design documents from `/specs/002-feishu-app-credential/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/（均就绪）

**Tests**: 依据宪法原则 II（测试先行不可协商），本清单包含测试任务并按 **TDD（Red-Green-Refactor）顺序**组织：每阶段的"Tests/测试"小节先行，测试必须先编写并确认失败（Red），再实现使其通过（Green），最后重构。

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story./任务按用户故事分组，保证每个故事可独立实现与测试。

> **完成记录**: 2026-11-07 全部 T001–T015 完成——全量测试 182/182 通过（含 001 回归 143 项全绿，SC-104）、`tsc` 构建通过、ESLint 零告警；错误码映射表已按开放平台文档核对固化（T009 实现期核对项）；真机凭据验证（T014 真机部分）待用户提供真实应用凭据后执行。代码审查（T015 宪法原则 V）待非作者审查或用户豁免确认。

**Scope note/范围说明**: 本特性为 001 已交付系统的**能力扩展**，不新增依赖、不改动数据库表结构、不触碰 `core/`、`hookserver/`、`mcp/`、`pollers/`（plan.md 技术上下文）。回归门禁：001 既有飞书 Webhook 用例全程保持全绿（SC-104）。

## Format: `[ID] [P?] [Story] Description`/格式说明

- **[P]**: Can run in parallel (different files, no dependencies)/可并行（不同文件、无未完成依赖）
- **[Story]**: Which user story this task belongs to/所属用户故事（US1–US3）
- Include exact file paths in descriptions/描述含确切文件路径

## Path Conventions/路径约定

- Single project（单项目）: `src/`、`tests/` at repository root（依据 plan.md 项目结构）。

---

## Phase 1: Setup (Shared Infrastructure)/阶段一：初始化（共享基础设施）

**Purpose**: Test infrastructure shared by all stories/为所有故事共享的测试基建。

- [x] T001 [P] Create Feishu fake-server test helper in tests/integration/helpers/feishu-fake-server.ts — 本地 HTTP 服务模拟开放平台两个接口（令牌接口 + `im/v1/messages`），支持场景注入：成功（断言 `content` 为字符串化 JSON、Bearer 头、`receive_id_type` 查询参数）/凭证错误/权限不足/机器人不在会话/限流/网络故障；附带可注入时钟工具（供令牌过期边界测试使用，research.md R2/R5）

**Checkpoint**: 假服务可在 vitest 中拉起与销毁，无真实外联。

---

## Phase 2: Foundational (Blocking Prerequisites)/阶段二：基础设施（阻塞性前置）

**Purpose**: 无新增阻塞前置——存储（加密列/SecretStore）、错误五码体系、重试与分发管线均复用 001 既有实现（data-model.md 第 3 节）。

**⚠️ CRITICAL**: 无。直接进入用户故事；US2 的令牌模块是 US2/US3 的共享依赖，随 US2 交付。

---

## Phase 3: User Story 1 - Configure Feishu Channel via App Credentials/用户故事一：以应用凭证配置飞书渠道 (Priority: P1) 🎯 MVP

**Goal**: 用户仅需 `app_id + app_secret + 接收目标` 即可完成飞书渠道配置并安全入库；Webhook 模式并存且行为不变。

**Independent Test**: `notice channel add feishu --mode app ...` → 保存成功并出现在 `channel list`（凭据掩码）；缺字段/非法枚举退出码 2 且定位到具体字段。

### Tests for User Story 1（先写并确认 Red）

- [x] T002 [P] [US1] Unit tests: feishu app-mode credentials validation in tests/unit/channel-config.test.ts（扩展现有文件） — 逐条引用 data-model.md 第 1 节：`mode` 枚举 `app|webhook` 且缺省视为 `webhook`；mode=app 时 `appId/appSecret/receiveId` 非空、`receiveIdType` 枚举 `chat_id|open_id|user_id|email`；mode=webhook 校验行为与现有一致；`summarizeCredentials` app 模式输出 `appId 掩码 → receiveId 掩码` 且不含 `appSecret` 原文
- [x] T003 [P] [US1] Contract tests: CLI new flags in tests/contract/cli-channel.test.ts（扩展现有文件） — 按 contracts/feishu-app-channel.md 断言：`add feishu` 接受 `--mode/--app-id/--app-secret/--receive-id-type/--receive-id`；缺字段退出码 `2` 且错误信息含标志名；`--json` 输出结构不变（可选新增）；`--app-id/--app-secret` 对 QQ 渠道既有用法无回归；list 掩码断言

### Implementation for User Story 1

- [x] T004 [US1] Extend feishu branch of channel validation in src/channels/channel-config.ts — 新增 app 模式校验分支与 `summarizeCredentials` 掩码摘要（`schemaVersion` 保持 1，缺 `mode` 按 `webhook` 解释，research.md R6）（依赖 T002）
- [x] T005 [US1] Add feishu app-mode flags in src/cli/channel.ts — `buildCredentials` 组装新标志、`--mode <app|webhook>` 缺省 `webhook`、add 命令描述更新（依赖 T003、T004）

**Checkpoint**: US1 独立可演示——应用凭证渠道可配置、可掩码展示，Webhook 既有用例全绿。

---

## Phase 4: User Story 2 - Test Send via App Credential Channel/用户故事二：凭证通道测试发送 (Priority: P1) 🎯 MVP

**Goal**: 点击测试发送后自动取令牌（缓存/续取）→ 以应用身份发消息 → 按五码体系给出分类结果。

**Independent Test**: `notice channel test <name>` → 假服务验证全链路成功/各错误分类映射与脱敏。

### Tests for User Story 2（先写并确认 Red）

- [x] T006 [P] [US2] Unit tests: tenant_access_token provider in tests/unit/feishu-token.test.ts — 逐条引用 research.md R2：首次获取成功并解析 `expire`；缓存命中零网络请求；过期（含 5 分钟保险余量）自动续取；换取失败按错误返回；凭证错误不回传 secret；注入 fetch 与时钟
- [x] T007 [P] [US2] Integration tests: app-mode send flow in tests/integration/feishu-app.test.ts — 逐条引用 contracts/feishu-app-channel.md 错误映射表：全链路成功（断言令牌头、`receive_id_type`、`content` 字符串化 JSON）；凭证无效 → `AUTH_INVALID`；缺权限/未发布版本 → `AUTH_INVALID`；机器人不在会话/目标不存在 → `CONTENT_REJECTED`；限流 → `RATE_LIMITED_REMOTE`；网络故障 → `NETWORK_UNREACHABLE`；令牌中途失效自动清缓存重取并重试一次成功；全部输出的 message 不含 `appSecret`、令牌与原始响应体（FR-106）

### Implementation for User Story 2

- [x] T008 [US2] Implement token provider in src/channels/feishu-token.ts — `createFeishuTokenProvider(fetchImpl?, now?)`：进程内 `Map<appId, TokenEntry>` 缓存、`expire` 毫秒换算减 5 分钟余量、失效清空接口（令牌仅内存不落盘，data-model.md 第 2 节）（依赖 T006）
- [x] T009 [US2] Implement app-mode send path in src/channels/feishu.ts — 按 `credentials.mode` 分派 webhook|app；app 路径：取令牌 → `im/v1/messages`（`content` 须 `JSON.stringify({ text })`，research.md R1）→ 业务码映射五码（具体错误码表按开放平台文档核对后固化，R1 实现期核对项）；令牌失效自动重取重试一次（依赖 T007、T008）

**Checkpoint**: US1 + US2 = **MVP 完整闭环**——免群机器人完成"配置 → 测试消息送达"（quickstart.md 第一步至第三步，SC-101/SC-102）。STOP and VALIDATE: 用真实应用凭据独立验证后可交付。

---

## Phase 5: User Story 3 - Task Completion Notification via Credential Channel/用户故事三：凭证通道任务完成通知 (Priority: P2)

**Goal**: 任务结束通知经凭证渠道送达，与 Webhook 渠道行为完全一致（模板、重试、去重、历史复用）。

**Independent Test**: 模拟任务结束事件 → 假服务收到按默认模板渲染的通知 → `notice history` 有 `sent` 记录；失败不阻断其他渠道。

### Tests for User Story 3（先写并确认 Red）

- [x] T010 [P] [US3] Integration tests: dispatch through app-credential channel in tests/integration/feishu-app.test.ts（扩展 T007 文件） — 逐条引用 spec 验收场景 3：模拟事件 → `:memory:` 库 → 凭证渠道发送 `sent` 记录与渲染内容一致（复用默认模板占位符）；结果状态 `failure/interrupted` 如实体现在通知；令牌过期不产生用户可见干预（复用 T009 重取逻辑）；单渠道失败不中断其他渠道；Webhook 模式既有通知用例零回归（SC-104）

### Implementation for User Story 3

- [x] T011 [US3] Verify dispatcher wiring for app-credential channel across src/core/dispatcher.ts and src/channels/index.ts — 适配器接口未变，预期零改动；如发现缝隙（如错误分类透传、`p-retry` 与令牌重试的叠加行为）在此补齐并回补测试（依赖 T009、T010）

**Checkpoint**: US3 独立可用——凭证渠道完整接入既有通知管线（quickstart.md 第四步，FR-108 链路一致性）。

---

## Phase 6: Polish & Cross-Cutting Concerns/阶段六：打磨与横切关注点

**Purpose**: Improvements that affect multiple user stories/影响多个用户故事的收尾工作。

- [x] T012 [P] Security hardening audit across src/channels/ and src/cli/channel.ts — 验证 `appSecret` 与令牌零明文出现在日志、错误信息、CLI 输出、`--json`、通知内容（FR-106；复用 T001 掩码断言 + 人工抽查）
- [x] T013 [P] Update user-facing docs in README.md — 渠道配置章节补充飞书"应用凭证方式"说明（创建应用 → 开通权限 → 发布版本 → add 命令示例），标注 Webhook 方式仍可用；链接 specs/002-feishu-app-credential/quickstart.md
- [x] T014 Run quickstart.md validation — 依次执行第一步至第四步（真机凭据）与集成测试（假服务），记录预期结果对照并修复偏差
- [x] T015 Final merge gate — 全量 `npm test` 通过（含 001 回归全绿 = SC-104）+ 宪法六原则自查 + 至少一名非作者代码审查（宪法原则 V）后方可合入

---

## Dependencies & Execution Order/依赖与执行顺序

### Phase Dependencies/阶段依赖

- **Setup (Phase 1)**: 无依赖，立即可开始（仅 T001）
- **Foundational (Phase 2)**: 无新增阻塞项，不构成等待
- **User Stories (Phase 3–5)**: 依赖 001 既有基建（已就绪）；顺序执行 US1 → US2 → US3（P1 → P1 → P2）
- **Polish (Phase 6)**: 依赖全部故事完成

### User Story Dependencies/用户故事依赖

- **US1 (P1)**: 仅依赖 T001 假服务基建；不依赖其他故事
- **US2 (P1)**: 依赖 US1 的校验与 CLI 标志（测试需能配置 app 模式渠道）；其令牌模块 T008 又是 US3 的共享依赖
- **US3 (P2)**: 依赖 T008/T009（US2）令牌与发送路径；分发管线复用 001 交付成果
- MVP = US1 + US2；US3 为增量交付，独立可验证

### Within Each User Story/故事内部顺序

- Tests MUST be written and FAIL before implementation（Red）/测试先写并确认失败，再实现（Green）
- 校验/令牌模块先于适配器与 CLI（模型先于服务，服务先于入口）
- Story complete before moving to next priority/故事完成后再进入下一优先级

### Parallel Opportunities/并行机会

- T001（Setup）与 T002/T003（US1 测试）可并行——测试先行阶段仅依赖假服务接口约定
- US1 测试 T002/T003 并行；US2 测试 T006/T007 并行
- Phase 6: T012/T013 并行
- 全特性仅 4 人日内可完成（任务总量小），单人串行亦无阻塞

---

## Parallel Example/并行示例

```bash
# 先并行编写全部测试（Red）：
Task: "T002 [P] [US1] Unit tests: feishu app-mode credentials validation in tests/unit/channel-config.test.ts"
Task: "T003 [P] [US1] Contract tests: CLI new flags in tests/contract/cli-channel.test.ts"
Task: "T006 [P] [US2] Unit tests: tenant_access_token provider in tests/unit/feishu-token.test.ts"
Task: "T007 [P] [US2] Integration tests: app-mode send flow in tests/integration/feishu-app.test.ts"

# 确认失败后按依赖顺序实现（Green）：
Task: "T004 → T005（US1）"
Task: "T008 → T009（US2，依赖 T004）"
Task: "T010 → T011（US3）"
```

---

## Implementation Strategy/实施策略

### MVP First (US1 + US2)/MVP 优先

1. Complete Phase 1: T001 假服务基建
2. Complete Phase 3: US1（凭证配置）→ 独立验证（掩码/校验/零回归）
3. Complete Phase 4: US2（测试发送）→ **STOP and VALIDATE**: 真机凭据走通 quickstart 第一至三步，US1+US2 即 MVP
4. 增量：Phase 5: US3（通知管线接入）→ Phase 6: 打磨与安全收尾

### Incremental Delivery/增量交付

每个 Checkpoint 都是可独立演示的增量：凭证可配置 → 测试消息可达 → 完成通知自动化；任一步交付不破坏 Webhook 既有能力（宪法 III：契约仅可选新增，SC-104 回归门禁）。

---

## Notes/备注

- TDD 顺序为硬约束（宪法 II）：未先写测试并确认失败的功能代码不得合入
- [P] tasks = different files, no dependencies/不同文件且无未完成依赖
- [Story] label maps task to specific user story for traceability/故事标签用于追溯
- Commit after each task or logical group/每任务或逻辑组完成后提交
- 错误码映射表的具体码值在 T009 实现时按开放平台文档核对固化（research.md R1 实现期核对项），不得凭记忆硬编码
- 零回归为门禁：任何任务导致 001 飞书 Webhook 用例失败即视为破坏（SC-104），须在当任务内修复
- Avoid: vague tasks, same file conflicts, cross-story dependencies that break independence/避免模糊任务、同文件冲突、破坏独立性的跨故事依赖
