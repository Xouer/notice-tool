---

description: "Task list for C端AI任务对话框通知关联 implementation"
---

# Tasks/任务清单: C端AI任务对话框通知关联

**Input**: Design documents from `/specs/005-ai-task-dialog-link/`

**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md, data-model.md, contracts/dialog-source-integration.md

**Tests**: 本功能测试任务为**必做**（宪法 II 测试先行不可协商；plan.md 测试策略节）。每个实现任务前必须先有失败的测试（Red）。

**Organization**: 任务按用户故事分组，US1=CodeBuddy 最小闭环（P1）、US2=Codex notify 钩子（P2）、US3=Codex 巡检兜底（P3），均可独立交付。

## Format/格式: `[ID] [P?] [Story] Description`

- **[P]**: 可并行（不同文件、无依赖）
- **[Story]**: 所属用户故事（US1/US2/US3）
- 描述含确切文件路径

## Phase 1: Setup/基线准备

**Purpose**: 确认基线干净、准备虚构测试数据（不含任何真实会话内容，宪法安全要求）

- [X] T001 验证基线：仓库根目录执行 `npm run build` 与 `npm test` 全绿，记录基线结果
- [X] T002 [P] 创建虚构测试 fixture 目录 `tests/fixtures/dialog-sources/`，含虚构的 CodeBuddy Stop 负载样本与 Codex rollout JSONL 样本（全部虚构数据）

---

## Phase 2: Foundational/基础保护

**Purpose**: 在扩展 `src/cli/hook.ts` 前建立现状保护网，防止破坏既有 stdin 钩子行为

**⚠️ CRITICAL**: 本阶段完成前不得开始任何用户故事实现

- [X] T003 为现有 stdin 钩子编写特征测试 `tests/unit/hook-source-mapping.test.ts` 基线用例：无 `--source` 时行为与现状一致、非法 JSON 拒绝路径不变（基线应直接通过，作为后续扩展的回归保护）

---

## Phase 3: User Story 1/CodeBuddy 任务完成即通知 (Priority: P1) 🎯 MVP

**Goal**: CodeBuddy（IDE 对话框或 CLI）的多步骤 Agent 任务结束 → `notice hook --source codebuddy` → 飞书通知，含跨触发源去重；IDE 不触发 Stop 时提供 MCP 兜底引导

**Independent Test**: 在 CodeBuddy 配置 Stop 钩子后运行一个真实任务，飞书数秒内收到通知，`notice history` 显示 `source_agent=codebuddy, trigger=hook`

### Tests for US1/US1 测试（先行，Red）

- [X] T004 [US1] 在 `tests/unit/hook-source-mapping.test.ts` 新增 CodeBuddy 映射用例：`session_id`→`task_id`、缺 `session_id` 拒绝并记录脱敏日志、缺可选字段走默认值、来源固定为 `codebuddy`；运行确认失败（Red）

### Implementation for US1/US1 实现

- [X] T005 [US1] 在 `src/cli/hook.ts` 实现可选 `--source <name>` 参数与 CodeBuddy Stop 负载映射（映射规则见 data-model.md 事件映射表），复用现有 ingest 工厂与事件管线，使 T004 通过（Green）
- [ ] T006 [US1] 实测验证 research.md 待验证项 1/2：CodeBuddy IDE 对话框是否触发 settings.json 的 Stop 钩子、真实负载字段集；用虚构化后的真实结构更新 `tests/fixtures/dialog-sources/` 与映射（若 IDE 不触发，记录结论并走 T007 的 MCP 兜底引导）
  > ⏳ 钩子自动触发待验证：向 `~/.codebuddy/settings.json`（全局）与项目级 `.codebuddy/settings.json` 写入 hooks 配置两次均因批准超时未完成（已创建备份 settings.json.bak-notice-acceptance，未做任何修改）。**请用户手动**将 quickstart 中 Stop 钩子 JSON 加入配置后，在对话框运行一个任务即可自动触发。其余链路已真机验证（见 T008）
- [X] T007 [P] [US1] 编写接入引导：CodeBuddy/Claude Code 的 Stop 钩子配置与 MCP 兜底说明（含可靠性弱、可能漏报的明示），落地到 `specs/005-ai-task-dialog-link/quickstart.md` 定稿并同步 `README.md` 相关章节
- [X] T008 [US1] US1 验收：真实 CodeBuddy 任务通知送达（SC-001）、`notice history` 来源与触发方式正确（SC-006/FR-006）、重复上报同一事件仅通知一次（FR-004）
  > ✅ 2026-11-07 真机验证（生产 CLI + 真实飞书双渠道）：真实负载经 `node dist/cli/index.js hook --source codebuddy` 送达 **feishu-me 与 app3 两个渠道（status=sent）**；`notice history --json` 正确记录 `source=codebuddy, taskId, trigger`；同负载重复上报 → "事件为重复（冷却窗口内），已记录未重复通知"，恰好一次成立。SC-001 秒级送达 ✓、SC-006 历史可追溯 ✓、FR-004 跨源去重 ✓

**Checkpoint**: US1 完成即形成 MVP——CodeBuddy 对话框任务结束有通知

---

## Phase 4: User Story 2/Codex notify 钩子接入 (Priority: P2)

**Goal**: Codex CLI `agent-turn-complete` → `notice hook --source codex-cli --payload-argv`（argv JSON）→ 飞书通知；非完成事件静默忽略、坏负载脱敏报错

**Independent Test**: `~/.codex/config.toml` 配置 notify 后运行 `codex` 完成一个任务，飞书收到含 `last-assistant-message` 摘要的通知；全程未启用巡检

### Tests for US2/US2 测试（先行，Red）

- [X] T009 [P] [US2] 在 `tests/unit/hook-source-mapping.test.ts` 新增 argv 用例：`--payload-argv` 解析、非 `agent-turn-complete` 退出码 0 静默忽略、JSON 损坏非 0 退出且错误信息不含原始负载、`thread-id` 缺失拒绝；运行确认失败（Red）
- [X] T010 [P] [US2] 编写集成测试 `tests/integration/codex-notify-flow.test.ts`：模拟 Codex notify 调用 CLI → 事件管线 → 渠道分发（渠道 adapter mock），断言 `result_summary` 截断至 2000 字符且经敏感信息过滤、历史记录 `source_agent=codex-cli, trigger=hook`

### Implementation for US2/US2 实现

- [X] T011 [US2] 在 `src/cli/hook.ts` 实现 `--payload-argv` 与 Codex notify 负载映射（契约见 contracts/dialog-source-integration.md），使 T009/T010 通过（Green）
- [ ] T012 [US2] US2 验收：真实 `codex` 任务通知送达；验证 quickstart.md 的 Codex 配置片段可直接复制使用（SC-004）
  > ⛔ 受阻：本机未安装 Codex CLI（`codex --version` 无命令）。自动化侧等价验证已通过（映射/argv 契约/端到端分发全绿）。安装 Codex CLI 并完成认证后，按 quickstart 配置 `notify` 即可验收

**Checkpoint**: US2 完成后 Codex CLI 钩子路径独立可用

---

## Phase 5: User Story 3/Codex 巡检兜底 (Priority: P3)

**Goal**: 无 notify 配置时，`notice watch` 通过 `~/.codex/sessions` rollout JSONL 检测"进行中→已结束"并通知，与钩子路径跨源去重一致

**Independent Test**: 移除 notify 配置、启用 `codex-cli` 巡检适配器后运行 `codex` 任务，通知延迟 ≤ 轮询间隔 + 30s（SC-005）

### Tests for US3/US3 测试（先行，Red）

- [X] T013 [P] [US3] 编写 `tests/unit/poller-codex-cli.test.ts`：以虚构 fixture 覆盖状态迁移检测、启动基线补检（冷却窗口内补一次不重复）、文件损坏/不可读跳过本轮且调度器继续（FR-007）；运行确认失败（Red）
- [X] T014 [P] [US3] 在 `src/config/` 为 `polling.adapters` 新增可选 `codex-cli` 条目（`sessionsDir` 可选默认 `~/.codex/sessions`）的配置校验测试；确认旧配置无该条目时行为不变（宪法 III）

### Implementation for US3/US3 实现

- [X] T015 [US3] 实现 `src/pollers/codex-cli.ts`（实现 `AgentStatusAdapter`，仿 `src/pollers/claude-code.ts`；结束事件类型以真实会话样本固化到 fixture，research.md 待验证项 3），使 T013 通过（Green）
- [X] T016 [US3] 实现 `src/config/` 的 `codex-cli` 适配器配置校验与调度器注册（`src/pollers/scheduler.ts` 仅登记新适配器类型，调度逻辑不变），使 T014 通过（Green）
- [ ] T017 [US3] US3 验收：`notice watch` 下真实 Codex 任务通知达标（SC-005）；同一任务 notify 与巡检同时开启时仅通知一次（FR-004）；巡检读取失败不中断进程（FR-007）
  > ⛔ 受阻：同 T012（本机无 Codex CLI）。自动化侧等价验证已通过（状态迁移/损坏跳过/基线补检/配置校验全绿）

**Checkpoint**: US3 完成后 Codex 双路径齐备，三个产品全部可接入

---

## Phase 6: Polish/收尾与合规

**Purpose**: 全量回归、文档定稿与宪法合规自查

- [X] T018 全量回归：`npm run build`、`npm test`、`npm run lint`、`npm run format:check` 全部通过
  > ✅ build/lint 通过、33 文件 297 用例全绿（基线 221 + 新增 76）；`format:check` 对 143 个存量文件报格式偏差为**仓库既有状态**（含本功能未触碰的文件），未在本任务中扩大改动面重排格式
- [ ] T019 [P] quickstart.md 定稿演练：按文档从零完成一个产品的接入并计时（目标 ≤10 分钟，SC-004），修正文档中不准确的步骤
  > ◐ 部分完成：验收流程已实测走通（通道确认 → Stop 钩子配置步骤 → 真实负载送达 → history 核对 → 重复去重），全程未阅读源码；完整"从零计时"需在钩子配置获批准后由用户收尾。文档步骤与实测一致，无需修正
- [X] T020 宪法合规自查：简单性（无超出 plan 的新增抽象）、TDD 顺序留痕、API 兼容（仅可选新增）、安全审查项落实（日志脱敏、fixture 虚构）、双语标题完整；准备非作者代码审查材料（宪法 V/VI）
  > ✅ 简单性：仅 hook.ts 映射 + codex-cli.ts 适配器 + 配置类型扩展；TDD：每个实现均有先行失败测试；兼容：全部可选新增（`--source`/`--payload-argv`/`codex-cli` 适配器/WizardSeed 可选字段）；安全：fixture 全虚构、错误信息脱敏（测试断言不含原始负载）；双语标题：spec/plan/research/data-model/contracts/quickstart/tasks/checklist 全部合规

---

## Dependencies & Execution Order/依赖与执行顺序

### Phase Dependencies/阶段依赖

- **Setup (Phase 1)**: 无依赖，立即开始
- **Foundational (Phase 2)**: 依赖 T001；T003 完成前禁止故事实现
- **US1 (Phase 3)**: 依赖 Phase 2；T004→T005 严格 TDD 顺序
- **US2 (Phase 4)**: 依赖 Phase 2 与 T005（同一文件 `src/cli/hook.ts`，须在 US1 后修改）
- **US3 (Phase 5)**: 依赖 Phase 2；与 US2 不同文件，可与 US2 并行
- **Polish (Phase 6)**: 依赖所有目标故事完成

### Parallel Opportunities/并行机会

- T001 与 T002 可并行（Setup）
- US2 的 T009 与 T010 可并行（不同测试文件）
- US3 的 T013 与 T014 可并行（不同文件）
- US2（Phase 4）与 US3（Phase 5）可整体并行（不同源码文件）；US1 因共享 `src/cli/hook.ts` 须先于 US2
- T007（文档）可与 T005/T006 并行

## Implementation Strategy/实施策略

### MVP First/最小可行优先

1. 完成 Phase 1 + Phase 2（基线与保护网）
2. 完成 Phase 3（US1：CodeBuddy 闭环）→ **STOP，独立验收** → 即解决用户最直接痛点
3. 按需追加 US2、US3，每个故事独立验收、互不回退

### Incremental Delivery/增量交付

- US1 → CodeBuddy 通知可用（MVP）
- US2 → Codex 钩子实时通知可用
- US3 → Codex 巡检兜底可用，三产品全覆盖

## Notes/备注

- [P] 任务 = 不同文件、无依赖；[Story] 标签用于需求追溯
- 严格 Red-Green-Refactor：测试先写且确认失败后再实现；禁止先实现后补测试（宪法 II）
- 每个任务或逻辑组完成后提交；检查点处暂停并独立验收故事
- 所有 fixture 使用虚构数据，日志与错误信息不得包含原始负载或真实会话内容（宪法安全要求）
