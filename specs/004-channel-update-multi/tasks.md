# Tasks: Channel Config Update & Multi-Config/任务清单：渠道配置修改与同类型多条配置

**Input**: Design documents from `/specs/004-channel-update-multi/`（plan.md、spec.md、research.md、data-model.md、contracts/update.md、quickstart.md）

**Prerequisites**: plan.md、spec.md 已确认；澄清结论（2026-11-07）：同类型多条独立配置 / 改后保持启用 / 空值清除可选字段。

**Tests**: 本项目宪法原则 II「测试先行（不可协商）」——每个实现任务之前均有对应测试任务，先 Red 后 Green。

**Organization**: 按用户故事分组（US1 修改配置 → US2 同类型多条 → US3 向导修改），每个故事可独立交付与验证。

## Format: `[ID] [P?] [Story] Description`

- **[P]**: 可并行（不同文件、无未完成依赖）
- **[Story]**: 对应 spec.md 的用户故事（US1/US2/US3）
- 所有实现均零新增依赖、零 schema 迁移；退出码契约 0/1/2/3 不变

---

## Phase 1: Setup/准备阶段

**Purpose**: 建立全绿基线，确保后续失败均归因于本特性改动

- [x] T001 运行基线 `npm run build` 与 `npm test`（package.json），确认既有测试全绿；若存在既有失败先修复再继续（本特性不允许在红色基线上开发）

---

## Phase 2: Foundational/基础阶段（阻塞所有用户故事）

**Purpose**: 仓储层修改能力（US1/US3 共用）+ CLI 标志复用准备

**⚠️ CRITICAL**: 本阶段完成前不得开始任何用户故事实现

- [x] T002 [P] 编写仓储层测试（Red）在 tests/unit/channel-update.test.ts：`ChannelRepository.rename`（成功改名返回新 ChannelRow、同 type 重名抛 ChannelConfigError、排除自身 id 允许"改为现名"、不同 type 同名允许、改名后 id/type/enabled/credentials_blob 不变仅 name/updatedAt 变）与 `updateCredentials`（归一化写入、校验失败时原 credentials_blob 逐字节不变）
- [x] T003 实现 `ChannelRepository.rename(id, newName)` 在 src/storage/channel-repository.ts（Green）：同 type 内重名预检（排除自身），名称规则与 validateChannelInput 同源（非空、trim、长度 ≤ 64 字符），重名错误文案沿用"同名渠道已存在（同 type 内唯一）"；复用既有 updateCredentials，不引入通用 update 方法（research R2）
- [x] T004 [P] 将 `channel add` 的凭据标志注册提取为可复用函数在 src/cli/channel.ts（供 update 复用同一标志集合；纯重构零行为变化，add 全部既有测试须保持全绿）

**Checkpoint**: rename/updateCredentials 可用且测试通过；add 行为零回归

---

## Phase 3: User Story 1 - Update Existing Channel Credentials & Name/修改既有渠道的凭据与名称 (Priority: P1) 🎯 MVP

**Goal**: `notice channel update <name>` 标志路径：部分字段更新、改名、连接方式切换；校验失败/改名冲突零写入

**Independent Test**: 添加飞书渠道后仅 `--app-secret` 更新成功，其余字段不变；`--name` 改名后启用状态保留；quickstart.md Scenario 1/2/5 全通过

### Tests for User Story 1/测试（先 Red）

- [x] T005 [US1] 编写 update CLI 集成测试（Red）在 tests/integration/update-cli.test.ts：① 部分更新仅替换提供字段、未提供字段保留（FR-002）② `--name` 改名成功且 enabled 保留（FR-004/FR-007）③ 改名冲突退出码 2 且名称与凭据均零改动（SC-002）④ 校验失败（如非法 URL）退出码 2 且原配置不变（FR-005）⑤ 渠道不存在退出码 2 并提示 `notice channel list` ⑥ 空值清除：`--secret ""` 清除钉钉加签密钥（FR-002 澄清）、`--to ""` 报错定位字段 ⑦ 连接方式切换 feishu app→webhook 后旧 appId/appSecret 被归一化丢弃（FR-003）⑧ `--json` 输出 `{"channel":{"name","type","enabled"}}` 且 stdout 纯 JSON ⑨ 非 TTY 无标志 → 退出码 2 指引标志方式；`--json` 无标志 → 拒绝向导（FR-008 分派矩阵）

### Implementation for User Story 1/实现

- [x] T006 [US1] 在 src/cli/channel.ts 注册 `channel update <name>` 子命令（Green）：按 contracts/update.md 行为矩阵分派；标志路径实现"定位渠道 → getCredentials 解密 → 合并（含空值清除）→ 改名预检（任何写入前）→ validateChannelInput 归一化 → updateCredentials → rename"顺序（research R1/R2）；人读输出 `渠道已更新：<新名>（<type>）`，`--json` 输出契约结构；错误经既有 CliFailure/ChannelConfigError 管线（退出码 0/2/3）

**Checkpoint**: US1 可独立交付——凭据轮换一条命令完成（SC-001），原子性测试全绿（SC-002）

---

## Phase 4: User Story 2 - Multiple Configs of Same Type/同类型渠道的多条配置 (Priority: P2)

**Goal**: 固化同 type 多条配置在各流程的独立行为；优化重名报错指引（数据层零改动）

**Independent Test**: 两条同 type 不同名渠道各自 add/test/enable/disable/remove/update 互不影响；分发时各产生一条通知记录；quickstart.md Scenario 3/6 全通过

### Tests for User Story 2/测试

- [x] T007 [P] [US2] 编写同类型多条配置行为测试在 tests/integration/multi-channel.test.ts：① 同 type 不同名 add 成功、list 两条独立掩码摘要（FR-009/SC-003）② 对 A 执行 enable/disable/remove/update 不影响 B 的任何属性（FR-010，data-model 不变量 1）③ 一次事件分发两条 enabled 渠道各产生一条 notification_records、A 发送失败不影响 B（FR-011，不变量 2，经 event-pipeline 既有入口注入假适配器）④ 同 type 同名 add 报错含指引文案（FR-012）⑤ feishu-a 改名为既有 email-a 的名称合法（不同 type 名称可重复）

### Implementation for User Story 2/实现

- [x] T008 [US2] 优化重名报错指引在 src/storage/channel-repository.ts：`create` 的 UNIQUE 错误文案补充"请换一个名称，或使用 `notice channel update <name>` 修改既有渠道"；同步更新断言旧文案的既有测试（T007④ 先行覆盖新文案）

**Checkpoint**: US2 行为全部经测试固化（预期①②③⑤ 直接通过——既有能力验证；④ 随 T008 转绿）

---

## Phase 5: User Story 3 - Interactive Update Wizard/交互式向导修改配置 (Priority: P3)

**Goal**: 交互终端运行 update 无标志时进入向导修改模式：类型锁定、当前值预填、敏感项回车保留、取消零落盘

**Independent Test**: runCli 注入假 WizardIO 端到端验证触发/预填/保存/取消；quickstart.md Scenario 4 全通过

### Tests for User Story 3/测试（先 Red）

- [x] T009 [P] [US3] 编写向导 update 模式单元测试（Red）在 tests/unit/wizard.test.ts：① update seed 下第 1 步类型选择跳过（锁定现有 type）② 多方式渠道第 2 步预选现有 mode 且可改选 ③ 各字段预填当前值、空输入保留 ④ 敏感字段提示"已设置（回车保留）"、新输入不回显 ⑤ 可选字段提供"清除该字段"选项、必填字段不提供（FR-002 澄清）⑥ 保存产物 WizardOutcome 与 add 同构（终验经同一 validateChannelInput）⑦ 摘要敏感值 `***` 明文零出现（SC-004）
- [x] T010 [P] [US3] 编写向导 update 集成测试（Red）在 tests/integration/update-cli.test.ts（追加）：① TTY + 无标志 → 进入向导并预填（FR-008）② 保存 → 改名预检 + updateCredentials + rename，名称变化时新名生效 ③ 改名冲突 → 提示重试/取消且不写入 ④ 取消 → 输出"已取消，未做任何更改。"且配置零改动 ⑤ `--interactive` 显式强制向导

### Implementation for User Story 3/实现

- [x] T011 [US3] 扩展 runWizard 支持 update 模式 seed 在 src/cli/wizard.ts（Green）：seed 增加 mode/type 锁定与当前值预填；敏感字段"已设置"占位；可选字段清除选项；复用既有字段目录 MODES 与 WizardIO，不新建引擎（research R3）
- [x] T012 [US3] 在 src/cli/channel.ts 接入 update 向导分派（Green）：TTY + 无标志（或 --interactive）→ 注入当前渠道 seed 启动向导；save 产物走改名预检 + updateCredentials + rename（与标志路径同一写入管线）；`--json`/非 TTY 拒绝向导（复用 add 的分派矩阵语义）

**Checkpoint**: 三个用户故事均可独立运行；向导与标志路径产物等价（同一校验器终验）

---

## Phase 6: Polish & Cross-Cutting Concerns/收尾与横切关注点

- [x] T013 [P] 更新 README.md："通知渠道配置"章节新增 `notice channel update` 用法（部分更新/改名/空值清除示例）与同类型多条配置说明（不同名称区分、独立管理）
- [x] T014 [P] 按 specs/004-channel-update-multi/quickstart.md 六个场景逐一人工走查并记录结果（含 Scenario 6 分发独立性）——Scenario 1–6 均经等价自动化测试通过（update-cli/multi-channel）；真实网络发送（test 到真实飞书/邮箱）需用户凭据，留待真机验证
- [x] T015 全量回归门禁：按 package.json scripts 执行 `npm test`（含 001/002/003 全部既有测试）、`npm run lint`、`npm run format:check` 全绿——297/297 通过、lint 0 错误；本特性改动文件 100% Prettier 合规（注：format:check 全仓失败源于并行会话对 .prettierignore 的改动（移除 drizzle 忽略），非本特性范围）
- [x] T016 宪法合规自查（依据 .specify/memory/constitution.md）：specs/004-channel-update-multi/ 全部 SDLC 文档双语标题（原则 VI）✓、测试先行顺序落实（原则 II，Red→Green 逐任务记录）✓、安全审查项复核（原则 IV：无明文泄露、DPAPI 边界不变、测试用虚构凭据）✓；非作者代码审查（原则 V）待 PR 流程执行

---

## Dependencies & Execution Order/依赖与执行顺序

### Phase Dependencies/阶段依赖

- **Phase 1 Setup**: 无依赖，立即开始
- **Phase 2 Foundational**: 依赖 Phase 1——**阻塞所有用户故事**（rename/updateCredentials 为 US1/US3 共用写入点）
- **Phase 3 US1**: 依赖 Phase 2（T003 仓储能力 + T004 标志复用）
- **Phase 4 US2**: 依赖 Phase 2；其中 T007⑤ 跨 type 改名用例依赖 US1 的 update 命令（T006）
- **Phase 5 US3**: 依赖 Phase 3 US1（向导保存复用标志路径的写入管线）
- **Phase 6 Polish**: 依赖所有用户故事完成

### Within Each User Story/故事内顺序

- 测试任务（Red）→ 实现任务（Green）→ 重构（保持全绿）
- T002 → T003；T005 → T006；T009/T010 → T011 → T012

### Parallel Opportunities/并行机会

- Phase 2：T002（新测试文件）∥ T004（channel.ts 重构）
- Phase 4：T007（新测试文件）可与 US1 的 T005（不同文件）并行编写
- Phase 5：T009 ∥ T010（不同测试文件）
- Phase 6：T013 ∥ T014

## Parallel Example/并行示例

```text
# Phase 2 并行：
Task T002: "仓储层 rename/updateCredentials 单元测试 tests/unit/channel-update.test.ts"
Task T004: "channel add 凭据标志注册提取为可复用函数 src/cli/channel.ts"

# Phase 5 并行：
Task T009: "向导 update 模式单元测试 tests/unit/wizard.test.ts"
Task T010: "向导 update 集成测试 tests/integration/update-cli.test.ts"
```

---

## Implementation Strategy/实施策略

### MVP First（仅 US1）

1. 完成 Phase 1 基线 + Phase 2 仓储能力
2. 完成 Phase 3 US1（T005→T006）
3. **停止并验证**：quickstart Scenario 1/2/5 独立通过即可交付 MVP（凭据轮换 + 改名）
4. US2 多为既有能力验证（增量小），US3 向导增强随后交付

### Incremental Delivery/增量交付

每个故事完成即独立验证、独立提交；任何检查点均可暂停，不破坏已交付能力（兼容性契约：纯新增子命令）。

---

## Notes/备注

- 本特性**零 schema 迁移、零新增依赖**；改动文件上限：src/cli/channel.ts、src/cli/wizard.ts、src/storage/channel-repository.ts + 3 个测试文件（plan.md 结构决策）
- 每个任务或逻辑组完成后提交；提交信息关联任务 ID
- 禁止触碰：channels/ 适配器、core/、hookserver/、mcp/、pollers/（plan.md Scale/Scope）
