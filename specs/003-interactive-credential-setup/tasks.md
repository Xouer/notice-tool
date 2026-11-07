# Tasks: Interactive Channel Setup Wizard/任务清单：交互式渠道配置向导

**Input**: Design documents from `/specs/003-interactive-credential-setup/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/（均就绪）

**Tests**: 依据宪法原则 II（测试先行不可协商），本清单包含测试任务并按 **TDD（Red-Green-Refactor）顺序**组织：每阶段的"Tests/测试"小节先行，测试必须先编写并确认失败（Red），再实现使其通过（Green），最后重构。

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story./任务按用户故事分组，保证每个故事可独立实现与测试。

> **完成记录**（2026-11-07）：全部 T001–T016 完成——全量测试 **220/220 通过**（26 个文件；含 001/002 回归全绿，SC-004）、`tsc` 构建零错误、ESLint 零告警。字段提示文案已按 README 与 002 quickstart 逐字段核对固化（T005，含"创建版本并发布"提示）；契约已与实现同步（`runWizard(io, seed?)` 签名、`WizardIO.interactive`、非交互回落定位行为）。T015 真机交互终端手动走查（quickstart 手动第 1–8 步）待用户在真实 TTY 下执行；代码审查（T016 宪法原则 V）待非作者审查或用户豁免确认。
>
> **TDD 说明**：T006（返回/默认/取消）的 Red 阶段被 T003 文件级 Red 吸收——引擎状态机与导航耦合实现于 T004，T006 用例补写后即 Green（记录于此以保持诚实）。
>
> **T013 安全审计结论**：向导代码不直接引用凭据字段名（全经泛型 `values`/`credentials` 传递，摘要经 `maskValue` 掩码）；38 项脱敏/零落盘断言全绿；无日志调用；取消/中断零落盘。

**Scope note/范围说明**: 本特性为 001/002 已交付系统的**配置体验增强**，零新增依赖、无表结构变更、不触碰 `channels/` 适配器、`core/`、`hookserver/`、`mcp/`、`pollers/`、`storage/`（plan.md 技术上下文）。回归门禁：001 既有 `channel add` 标志路径契约测试零改动保持全绿（SC-004）。

## Format: `[ID] [P?] [Story] Description`/格式说明

- **[P]**: Can run in parallel (different files, no dependencies)/可并行（不同文件、无未完成依赖）
- **[Story]**: Which user story this task belongs to/所属用户故事（US1–US3）
- Include exact file paths in descriptions/描述含确切文件路径

## Path Conventions/路径约定

- Single project（单项目）: `src/`、`tests/` at repository root（依据 plan.md 项目结构）。

---

## Phase 1: Setup (Shared Infrastructure)/阶段一：初始化（共享基础设施）

**Purpose**: 交互向导的测试基建，被全部故事共享。

- [x] T001 [P] Create fake WizardIO test helper in tests/unit/helpers/fake-wizard-io.ts — 预设应答队列式假实现 `createFakeWizardIO(answers)`：`choose/ask/askSecret` 按序消费应答（值/`back`/`cancel`），记录全部 `print` 输出行与 `ask` 的 `secret` 标志（供脱敏断言），队列耗尽即抛错（防止测试静默通过）；被 T003/T006/T007/T010 复用

**Checkpoint**: 假 IO 可在 vitest 中导入并脚本化驱动向导引擎，无真实终端依赖。

---

## Phase 2: Foundational (Blocking Prerequisites)/阶段二：基础设施（阻塞性前置）

**Purpose**: 全部故事共享的类型契约。

- [x] T002 [P] Define WizardIO contract types in src/cli/wizard-io.ts — 仅类型与接口（`StepResult`、`WizardIO`、`choose/ask/print` 签名），与 contracts/wizard.md 逐字一致；不含任何实现（真实实现属 US2/T009）；此文件是 US1/US2/US3 的共享依赖，先于一切故事代码

**Checkpoint**: `tsc --noEmit` 通过；无运行时行为，纯类型层。

---

## Phase 3: User Story 1 - Step-by-Step Guided Feishu Configuration/用户故事一：分步引导式飞书配置 (Priority: P1) 🎯 MVP

**Goal**: 交互终端下 `channel add` 缺省即启动向导：选类型 → 选方式 → 逐项输入（含含义/示例/获取方法提示）→ 脱敏确认摘要 → 确认后才产出等价于标志路径的配置草稿。

**Independent Test**: 注入假 IO 走完飞书应用凭证全流程 → 引擎返回 `save` 且 `type/name/credentials` 与等价标志命令组装结果一致；取消则返回 `cancel` 且零副作用。

### Tests for User Story 1（先写并确认 Red）

- [x] T003 [P] [US1] Unit tests: wizard engine core flow in tests/unit/wizard.test.ts（依赖 T001/T002） — 逐条引用 contracts/wizard.md 步骤流与 data-model.md 状态机：
  - 第 1 步类型菜单：5 类渠道 + 用途说明；type 预选（seed）时跳过第 1 步
  - 第 2 步方式菜单：飞书列出 `app`（含"推荐"标记）与 `webhook`；单方式渠道（dingtalk/email）跳过此步
  - 第 3 步逐字段：飞书 app 模式按目录顺序收集 `name→appId→appSecret→receiveIdType→receiveId`；`appSecret` 走 `askSecret`（断言假 IO 收到 secret=true）；`receiveIdType` 为编号选择且候选项与 `validateChannelInput` 枚举一致
  - 轻量校验：`appId` 空值提交 → 重试且错误文案定位到字段；`webhookUrl` 非法 URL → 重试；重试不推进游标
  - 第 4 步确认摘要：`print` 输出含全部字段标签，敏感值仅 `***` 形式、明文零出现（SC-005）
  - 确认后 `runWizard` 返回 `{ action: "save", ... }` 且 `credentials` 能通过既有 `validateChannelInput`（等价性，FR-009）
  - 取消：任一步 `cancel` → 返回 `{ action: "cancel" }`

### Implementation for User Story 1

- [x] T004 [US1] Implement wizard engine and field catalog in src/cli/wizard.ts — 字段目录按 contracts/wizard.md 速览表组织（8 个 `type×mode` 组合，每项含 `key/label/hint/secret/required/kind/choices/lightCheck`）；`runWizard(flow, io, seed)` 纯状态机：type → mode（单方式跳过）→ fields（`lightCheck` 失败原地重试）→ confirm（脱敏摘要 + 保存/返回/取消）；引擎不接触数据库与终端（依赖 T003）
- [x] T005 [US1] Finalize field catalog hint copy（字段提示文案固化项）in src/cli/wizard.ts — 对照 README.md"通知渠道配置/飞书"章节与 specs/002-feishu-app-credential/quickstart.md，逐字段核对 `hint` 文案三要素：字段含义、格式示例/前缀（`cli_`/`oc_`/`ou_`，仅提示不作硬校验，research R4）、获取方法（含"开放平台创建应用/发布版本"与"把机器人加入群"提示）；核对结果在下方完成记录留痕（依赖 T004）

**Checkpoint**: US1 独立可演示——假 IO 全流程引擎行为正确、摘要脱敏、产物与标志路径等价。STOP and VALIDATE: `npm test` 全绿。

---

## Phase 4: User Story 2 - Navigate Back, Skip and Cancel Safely/用户故事二：返回、跳过与安全取消 (Priority: P2)

**Goal**: 任一步可 `b` 返回上一步（保留已输入值）、可选项跳过走默认、取消/Ctrl+C 零落盘；真实终端 IO（掩码输入、编号菜单）可用。

**Independent Test**: 假 IO 前进一步后 `back` 修改再中途 `cancel` → 返回 `cancel` 且草稿丢弃；真实 IO 用注入流验证掩码与导航键。

### Tests for User Story 2（先写并确认 Red）

- [x] T006 [P] [US2] Unit tests: back navigation, defaults and cancel in tests/unit/wizard.test.ts（扩展 T003 文件，依赖 T001/T002） — 逐条引用 spec 验收场景 2：
  - `fields` 阶段任一字段 `back` → 游标回退一格且更早字段值保留（回退到 `receiveIdType` 无需重输 `appSecret`）
  - `fields` → `confirm` 选"返回上一步修改" → 回到最后一个字段
  - 可选项跳过：`name` 留空回车 → 使用 `{type}-{YYYYMMDD-HHmmss}` 默认名并在摘要标注"(默认生成)"
  - 任一步（含 `askSecret` 中途）`cancel` → `{ action: "cancel" }`；对引擎而言确认前无任何写入调用（SC-003 由 T010 集成断言落盘侧）
  - 字段回退后再前进：曾校验失败的值被替换后不再复发旧错误
- [x] T007 [P] [US2] Unit tests: real WizardIO behaviors in tests/unit/wizard-io.test.ts（依赖 T001/T002） — 逐条引用 research R1/R3：`ask` 正常回显；`askSecret`（secret=true）raw 模式逐字符回显 `*`、退格删除、回车结束、明文零出现于输出流；`choose` 编号菜单（非法序号重试、`0` 取消、`b` 返回）；输入首尾空白去除、多行粘贴取首行并提示；以可注入的流桩（非真实 TTY）驱动

### Implementation for User Story 2

- [x] T008 [US2] Implement back navigation and default naming in src/cli/wizard.ts（扩展 T004） — `fieldIndex` 游标回退、值保留、`fields`/`confirm` 双向导航；默认名生成与 `defaults` 标注（data-model.md 第 1 节）（依赖 T006）
- [x] T009 [US2] Implement real WizardIO in src/cli/wizard-io.ts（实现 T002 接口） — `node:readline/promises` 提问与编号菜单；`askSecret` 用 `setRawMode(true)` 逐字符掩码（research R3）；构造时校验 TTY，非 TTY 抛出（由 T011 分派先行拦截）；Ctrl+C 映射 `cancel`（依赖 T007）

**Checkpoint**: US1 + US2 = **MVP 完整闭环**——交互终端从零开始完成一次飞书渠道向导配置（quickstart.md 手动验证第 1–7 步，SC-001/SC-002/SC-003）。STOP and VALIDATE: 手动走完向导后 `npm test` 全绿。

---

## Phase 5: User Story 3 - Wizard Covers All Channel Types Consistently/用户故事三：向导覆盖全部渠道类型 (Priority: P3)

**Goal**: `channel add` 分派矩阵落地：触发条件、退出码、`--json` 拒绝、标志路径零回归；全部 8 个 `type×mode` 组合可走向导且只出现该组合的字段。

**Independent Test**: 注入假 IO 经 `runCli` 走真实命令：非飞书渠道向导仅出现其字段；非 TTY/`--json` 拒绝向导退出码 2；完整标志命令行为与 002 验收一致。

### Tests for User Story 3（先写并确认 Red）

- [x] T010 [P] [US3] Integration tests: CLI dispatch and all-channel flows in tests/integration/wizard-cli.test.ts（依赖 T001/T002） — 逐条引用 contracts/wizard.md 行为矩阵与 spec 验收场景 3：
  - 触发矩阵：无参数 + TTY（假 IO 注入）→ 向导；`--interactive` + TTY → 向导（已给 type 预选）；非 TTY（stdin 流桩无 isTTY）缺标志 → 退出码 2 且提示需要交互终端；`--json` 缺标志 → 退出码 2 且输出为纯 JSON 无交互文案（R8）；凭据齐全标志路径 → 既有行为、不弹向导（FR-009 回归）
  - 全渠道覆盖：dingtalk/email（跳过方式步）、wechat `webhook|push`、qq `official|push` 各走通一条 → save 产物经 `repo.create` 入库、`channel list` 掩码展示
  - 等价与零落盘：取消场景后 `channel list` 记录数不变（SC-003 落盘侧断言）；重名 → 冲突菜单（改名/覆盖需显式确认/取消），不静默覆盖（R7）
  - 既有标志路径契约测试（001 交付）零改动通过（SC-004 回归门禁）

### Implementation for User Story 3

- [x] T011 [US3] Rework `channel add` dispatch in src/cli/channel.ts — `<type>` 放宽为 `[type]`、`--name` 放宽为可选、新增 `--interactive`；按 contracts/wizard.md 矩阵分派（TTY/`--json`/标志齐全/`--interactive` 四态）；向导 `save` 分支：`validateChannelInput` 终验 → 重名检测（冲突菜单）→ `repo.create`（唯一写入点，data-model 第 3 节）；错误经 `CliFailure`/`ChannelConfigError` 既有退出码通道（依赖 T008/T009/T010）
- [x] T012 [US3] Add WizardIO injection seam in src/cli/index.ts — `CliRunOptions` 新增可选 `wizardIO`（与 `dataDir`/`stdin` 同模式的测试接缝），经 `registerChannelCommands` 透传至 `channel add`；未注入时按需构造真实 IO；`--json` 全局标志随 `makeContext` 传递（依赖 T010、T011）

**Checkpoint**: US3 独立可用——分派矩阵全场景正确、全部渠道可向导配置、标志路径零回归（quickstart.md 边界与取消验证全项通过）。

---

## Phase 6: Polish & Cross-Cutting Concerns/阶段六：打磨与横切关注点

**Purpose**: Improvements that affect multiple user stories/影响多个用户故事的收尾工作。

- [x] T013 [P] Security hardening audit across src/cli/wizard.ts and src/cli/wizard-io.ts — 验证敏感凭据（`appSecret`/`authCode`/`pushKey`/`secret`）零明文出现在：屏幕输出（掩码输入与摘要）、日志、错误信息、`--json`（FR-010/SC-005；复用 T001 假 IO 的输出记录断言 + 人工抽查）；确认取消/中断路径无任何落盘
- [x] T014 [P] Update user-facing docs in README.md — 渠道配置章节新增"交互式向导"说明：直接运行 `notice channel add` 即进入分步引导（选类型 → 选方式 → 逐项输入 → 确认）；标注标志方式仍可用于脚本/CI 与 `--json`；链接 specs/003-interactive-credential-setup/quickstart.md
- [x] T015 Run quickstart.md validation — 依次执行手动端到端验证（真实终端）与自动化验证（假 IO/既有测试），记录预期结果对照并修复偏差（依赖 T011/T012）
- [x] T016 Final merge gate — 全量 `npm test` 通过（含 001/002 回归全绿 = SC-004）+ 宪法六原则自查（含 VI 双语标题）+ 至少一名非作者代码审查（宪法原则 V）后方可合入

---

## Dependencies & Execution Order/依赖与执行顺序

### Phase Dependencies/阶段依赖

- **Setup (Phase 1)**: 无依赖，立即可开始（仅 T001）
- **Foundational (Phase 2)**: 仅 T002（纯类型），与 T001 并行；完成后即可进入任何故事
- **User Stories (Phase 3–5)**: 依赖 T001/T002；顺序执行 US1 → US2 → US3（P1 → P2 → P3）
- **Polish (Phase 6)**: 依赖全部故事完成

### User Story Dependencies/用户故事依赖

- **US1 (P1)**: 仅依赖 T001/T002；交付引擎 + 字段目录（飞书为主场景）
- **US2 (P2)**: 依赖 US1 引擎（在其上扩展导航与默认值）与真实 IO；完成后 MVP 闭环
- **US3 (P3)**: 依赖 T008/T009（US2）的真实 IO 与导航能力；分派与接缝是命令层组装
- MVP = US1 + US2；US3 为增量交付，独立可验证

### Within Each User Story/故事内部顺序

- Tests MUST be written and FAIL before implementation（Red）/测试先写并确认失败，再实现（Green）
- 引擎（纯逻辑）先于真实 IO，真实 IO 先于命令分派（模型 → 服务 → 入口）
- Story complete before moving to next priority/故事完成后再进入下一优先级

### Parallel Opportunities/并行机会

- T001 与 T002 并行（不同文件）
- US1 测试 T003（Red）先行；US2 测试 T006/T007 分别扩展 wizard.test.ts 与新建 wizard-io.test.ts（注意 T006 扩展 T003 文件，须在 T003 完成后进行）
- US3 测试 T010 可与 US2 实现 T008/T009 并行推进（T010 仅依赖接口约定，先于 T011/T012 实现）
- Phase 6: T013/T014 并行
- 全特性仅 5 人日内可完成（任务总量小），单人串行亦无阻塞

---

## Parallel Example/并行示例

```bash
# 先并行完成基建与测试（Red）：
Task: "T001 [P] tests/unit/helpers/fake-wizard-io.ts"
Task: "T002 [P] src/cli/wizard-io.ts (types only)"
Task: "T003 [P] tests/unit/wizard.test.ts（US1，依赖 T001/T002）"
Task: "T007 [P] tests/unit/wizard-io.test.ts（US2）"
Task: "T010 [P] tests/integration/wizard-cli.test.ts（US3）"

# 确认失败后按依赖顺序实现（Green）：
Task: "T004 → T005（US1）"
Task: "T006 → T008（US2 引擎扩展）"
Task: "T007 → T009（US2 真实 IO）"
Task: "T010 → T011 → T012（US3 分派与接缝）"
```

---

## Implementation Strategy/实施策略

### MVP First (US1 + US2)/MVP 优先

1. Complete Phase 1–2: T001/T002 测试基建与类型契约
2. Complete Phase 3: US1（引擎 + 字段目录 + 文案固化）→ 独立验证（假 IO 全流程/脱敏/等价）
3. Complete Phase 4: US2（导航/默认值/真实 IO）→ **STOP and VALIDATE**: 真实终端走完 quickstart 手动验证第 1–7 步，US1+US2 即 MVP
4. 增量：Phase 5: US3（分派矩阵 + 全渠道）→ Phase 6: 打磨与安全收尾

### Incremental Delivery/增量交付

每个 Checkpoint 都是可独立演示的增量：飞书向导可用 → 导航与安全取消完备 → 全渠道一致体验；任一步交付不破坏标志路径与既有测试（宪法 III：契约仅受控新增，SC-004 回归门禁）。

---

## Notes/备注

- TDD 顺序为硬约束（宪法 II）：未先写测试并确认失败的功能代码不得合入
- [P] tasks = different files, no dependencies/不同文件且无未完成依赖
- [Story] label maps task to specific user story for traceability/故事标签用于追溯
- Commit after each task or logical group/每任务或逻辑组完成后提交
- 字段提示文案（含义/示例/获取方法）在 T005 按 README 与 002 quickstart 逐字段核对固化（research.md 遗留核对项），不得凭记忆编写
- 零回归为门禁：任何任务导致 001/002 既有测试失败即视为破坏（SC-004），须在当任务内修复
- 敏感输入掩码与取消零落盘为安全门禁（宪法 IV）：T013 审计未通过不得进入 T016 合入门
- Avoid: vague tasks, same file conflicts, cross-story dependencies that break independence/避免模糊任务、同文件冲突、破坏独立性的跨故事依赖
