---
description: "Task list for Desktop Channel Manager implementation"
---

# Tasks/任务清单: Desktop Channel Manager/桌面渠道管理工具

**Input**: Design documents from `/specs/007-desktop-channel-manager/`

**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md, data-model.md, contracts/

**Tests**: 本功能测试任务为**必做**（宪法 II 测试先行不可协商；plan.md 测试策略节）。每个实现任务前必须先有失败的测试（Red）。

**Organization**: 任务按用户故事分组，US1=服务状态与启停（P1）、US2=渠道注册（P1）、US3=渠道测试（P1）、US4=渠道修改（P2）、US5=注册信息（P2）、US6=托盘托管（P2），均可独立交付。

## Format/格式: `[ID] [P?] [Story] Description`

- **[P]**: 可并行（不同文件、无依赖）
- **[Story]**: 所属用户故事（US1~US6）
- 描述含确切文件路径

## Phase 1: Setup/基线准备

**Purpose**: 确认基线干净、引入桌面构建链并创建目录骨架

- [ ] T001 验证基线：仓库根目录执行 `npm run build`、`npm test`、`npm run lint` 全绿，记录基线结果
- [ ] T002 初始化桌面工程：在 `package.json` 新增 Electron/React/Vite/electron-vite/electron-builder 开发依赖与 `desktop:dev`、`desktop:build`、`desktop:package` 脚本，新增 `electron.vite.config.ts` 并调整 `tsconfig.json` 以同时编译 CLI 与桌面源码
- [ ] T003 [P] 创建目录骨架：`src/desktop/main/`、`src/desktop/preload/`、`src/desktop/renderer/{pages,components,styles}`、`src/registration/`、`tests/unit/renderer/`，保持现有 `src/` 与 `tests/` 分层不变
- [ ] T004 [P] 创建虚构测试 fixture：`tests/fixtures/desktop/` 下新增虚构的 CodeBuddy/Claude Code/Codex CLI 配置样本与渠道草稿样本（全部虚构数据，不含真实凭据）

---

## Phase 2: Foundational/基础保护

**Purpose**: 提取服务运行时并搭建安全桌面壳，阻塞全部用户故事实现

**⚠️ CRITICAL**: 本阶段完成前不得开始任何用户故事实现

- [ ] T005 [P] 编写 `tests/unit/service-runtime.test.ts`：覆盖状态机迁移、重复启动/停止、外部端口占用、启动失败回滚、停止顺序（定时器 → scheduler → Fastify）；运行确认失败（Red）
- [ ] T006 [P] 编写 `tests/unit/hook-server-health.test.ts`：`GET /health` 返回 200、无副作用、现有 POST 契约不变；运行确认失败（Red）
- [ ] T007 实现 `src/core/service-runtime.ts` 并改造 `src/cli/serve.ts` 复用该运行时；在 `src/hookserver/server.ts` 新增只读 `GET /health`；使 T005/T006 通过（Green）
- [ ] T008 创建 Electron 安全壳：`src/desktop/main/index.ts`、`src/desktop/main/window.ts`（sandbox、contextIsolation、禁远程内容、CSP）、`src/desktop/preload/index.ts`（仅暴露 `noticeDesktop` 白名单）、`src/desktop/renderer/App.tsx`（左侧导航与三个空页面）；实现单实例窗口与基础设计令牌 `src/desktop/renderer/styles/`

**Checkpoint**: 基础运行时与安全桌面壳就绪，用户故事可并行开始

---

## Phase 3: User Story 1/服务状态与启停 (Priority: P1) 🎯 MVP

**Goal**: 用户在首页看到真实服务状态，可启动/停止应用内服务，并能识别外部 `notice serve`

**Independent Test**: 启动桌面应用，仅通过首页完成服务启动、状态刷新与停止；外部占用端口时显示“外部运行中”

### Tests for US1/US1 测试（先行，Red）

- [ ] T009 [US1] 编写 `tests/unit/renderer/home-page.test.tsx`：首页状态徽标、启停按钮、过渡态禁用、失败提示、外部运行中提示；运行确认失败（Red）
- [ ] T010 [US1] 编写 `tests/integration/desktop-service-lifecycle.test.ts`：fake IPC 调用 start/status/stop/refresh，断言状态广播、重复操作防抖与外部探测降级；运行确认失败（Red）

### Implementation for US1/US1 实现

- [ ] T011 [US1] 在 `src/desktop/main/ipc.ts` 注册 `service:getStatus/start/stop` 通道并桥接 `ServiceRuntime`；在 `src/desktop/preload/index.ts` 暴露服务 API 与 `onServiceStatusChanged`；实现脱敏错误封装
- [ ] T012 [US1] 实现 `src/desktop/renderer/pages/HomePage.tsx` 与状态徽标组件，展示服务状态、渠道/注册摘要入口；使 T009/T010 通过（Green）
- [ ] T013 [US1] US1 验收：按 `specs/007-desktop-channel-manager/quickstart.md` 第 1 节实测启动、刷新、停止与外部服务占用场景（SC-001/SC-003）

**Checkpoint**: US1 完成即形成 MVP——桌面端可安全控制本地服务

---

## Phase 4: User Story 2/渠道注册 (Priority: P1)

**Goal**: 用户通过分步表单注册渠道，保存前校验并脱敏，新渠道默认未启用

**Independent Test**: 从空渠道列表新增一条有效渠道，列表显示掩码摘要与未启用状态；非法/重名输入被阻止

### Tests for US2/US2 测试（先行，Red）

- [ ] T014 [US2] 编写 `tests/unit/channel-controller.test.ts`：新增校验、同类型重名、字段级错误、敏感值不回显、取消零写入；运行确认失败（Red）
- [ ] T015 [P] [US2] 编写 `tests/unit/renderer/channel-form.test.tsx`：类型/连接方式选择、必填提示、敏感字段掩码、保存前摘要、取消不保存；运行确认失败（Red）

### Implementation for US2/US2 实现

- [ ] T016 [US2] 实现 `src/desktop/main/channel-controller.ts` 的 create/list/getFieldSchema，复用 `ChannelRepository`、`validateChannelInput`、`summarizeCredentials`，输出 `ChannelSummary`
- [ ] T017 [US2] 在 `src/desktop/main/ipc.ts` 注册 `channels:list/create/getFieldSchema`，在 `src/desktop/preload/index.ts` 暴露对应 API 与字段级错误封装
- [ ] T018 [US2] 实现 `src/desktop/renderer/pages/ChannelsPage.tsx` 新增表单、列表与空状态；使 T014/T015 通过（Green）
- [ ] T019 [US2] US2 验收：按 quickstart 第 2 节完成新增渠道、摘要脱敏、非法输入阻止与未启用状态（SC-002/SC-004）

**Checkpoint**: US2 完成后桌面端具备独立渠道注册能力

---

## Phase 5: User Story 3/渠道测试 (Priority: P1)

**Goal**: 用户对单一渠道发送测试消息，看到进行中/成功/失败/超时，成功自动启用

**Independent Test**: 使用有效配置测试成功并自动启用；使用失效配置测试失败且原状态不变；进行中重复点击不重复发送

### Tests for US3/US3 测试（先行，Red）

- [ ] T020 [US3] 在 `tests/unit/channel-controller.test.ts` 新增测试：成功自动启用、失败保持状态、同渠道防重复、30 秒超时、错误脱敏；运行确认失败（Red）
- [ ] T021 [P] [US3] 编写 `tests/integration/desktop-channel-flow.test.ts`：新增 → 测试成功 → 自动启用 → 列表刷新；使用内存库与 fake 渠道适配器；运行确认失败（Red）

### Implementation for US3/US3 实现

- [ ] T022 [US3] 在 `src/desktop/main/channel-controller.ts` 实现测试发送、结果 DTO、进行中锁与成功自动启用；在 IPC 增加 `channels:test` 与 `channels:test-progress` 事件
- [ ] T023 [US3] 在 `src/desktop/renderer/pages/ChannelsPage.tsx` 增加测试按钮、进度状态、结果提示与失败排查建议；使 T020/T021 通过（Green）
- [ ] T024 [US3] US3 验收：按 quickstart 第 2 节实测成功/失败路径，目标接收端收到可识别测试消息（SC-002/SC-006）

**Checkpoint**: US3 完成后桌面端具备完整“注册 → 测试 → 启用”闭环

---

## Phase 6: User Story 4/渠道修改 (Priority: P2)

**Goal**: 用户可部分修改渠道，未提交字段保留，失败零写入，可选字段可显式清除

**Independent Test**: 仅修改名称或一项凭据后，其余字段与启用状态不变；冲突/非法保存被拒绝且原配置不变

### Tests for US4/US4 测试（先行，Red）

- [ ] T025 [US4] 在 `tests/unit/channel-controller.test.ts` 新增修改测试：三态字段（keep/replace/clear）、必填字段禁止清除、连接方式整体校验、改名冲突、失败原子性；运行确认失败（Red）
- [ ] T026 [P] [US4] 在 `tests/unit/renderer/channel-form.test.tsx` 新增修改用例：当前值预填（敏感值不回显）、留空保留、显式清除、冲突提示与取消；运行确认失败（Red）

### Implementation for US4/US4 实现

- [ ] T027 [US4] 在 `src/desktop/main/channel-controller.ts` 实现 update 与 `ChannelUpdatePatch` 合并，复用 `updateCredentials/rename/validateChannelInput`，不隐式触发测试
- [ ] T028 [US4] 在 `src/desktop/renderer/pages/ChannelsPage.tsx` 实现修改表单、保存结果与外部变更冲突提示；使 T025/T026 通过（Green）
- [ ] T029 [US4] US4 验收：按 quickstart 第 3 节实测单字段修改、可选字段清除、冲突拒绝与状态保留（SC-005）

**Checkpoint**: US4 完成后桌面端具备安全维护能力，无需删除重建

---

## Phase 7: User Story 5/注册信息查看 (Priority: P2)

**Goal**: 用户集中查看三个智能体的注册状态、适用范围与最近接入信号，可刷新且只读

**Independent Test**: 至少一个智能体已注册、另一个未注册时，页面准确区分状态；外部修改配置后刷新更新

### Tests for US5/US5 测试（先行，Red）

- [ ] T030 [P] [US5] 编写 `tests/unit/registration-reader.test.ts`：使用 `tests/fixtures/desktop/` 覆盖未注册/有效/无效/读取失败、最近接入信号、脱敏错误；运行确认失败（Red）
- [ ] T031 [P] [US5] 编写 `tests/unit/renderer/registration-page.test.tsx`：状态分类展示、最近信号、刷新按钮、读取失败不阻断列表、空状态；运行确认失败（Red）

### Implementation for US5/US5 实现

- [ ] T032 [US5] 实现 `src/registration/reader.ts`，按 `contracts/registration-reader.md` 只读检测三个配置位置并查询最近通知记录
- [ ] T033 [US5] 在 `src/desktop/main/ipc.ts` 注册 `registration:list/refresh`，在 preload 暴露只读 API；实现 `src/desktop/renderer/pages/RegistrationPage.tsx`；使 T030/T031 通过（Green）
- [ ] T034 [US5] US5 验收：按 quickstart 第 4 节实测三种状态与刷新，确认无凭据/完整路径泄露（SC-007/SC-008）

**Checkpoint**: US5 完成后用户可定位接入链路问题，无需命令行

---

## Phase 8: User Story 6/托盘托管 (Priority: P2)

**Goal**: 窗口最小化到托盘且服务状态不变，可恢复单一窗口，显式退出需确认

**Independent Test**: 服务运行时最小化/恢复/退出，服务与配置不变；取消退出保持原状态

### Tests for US6/US6 测试（先行，Red）

- [ ] T035 [US6] 编写 `tests/unit/desktop-tray.test.ts`：以注入 fake Tray/Menu/BrowserWindow 覆盖最小化隐藏、恢复不重复、退出确认、取消退出、托盘不可用降级；运行确认失败（Red）

### Implementation for US6/US6 实现

- [ ] T036 [US6] 实现 `src/desktop/main/tray.ts` 并接入 `src/desktop/main/index.ts`：最小化到托盘、恢复单一窗口、显式退出确认与停止由应用管理的服务；使 T035 通过（Green）
- [ ] T037 [US6] US6 验收：按 quickstart 第 5 节连续执行 20 次最小化/恢复/退出流程（SC-003）

**Checkpoint**: US6 完成后桌面工具可常驻后台且不影响服务状态

---

## Phase 9: Polish/收尾与合规

**Purpose**: 全量回归、安全抽查、文档与审查准备

- [ ] T038 全量回归：`npm run build`、`npm test`、`npm run lint`、`npm run format:check` 全部通过；`npm run desktop:build` 可产出桌面构建
- [ ] T039 安全抽查：验证渠道列表、IPC 响应、日志、错误信息与测试结果均无明文凭据；渲染进程无法访问 Node API 或本地文件（SC-008）
- [ ] T040 [P] 文档定稿：更新 `README.md` 桌面端使用章节，核对 `specs/007-desktop-channel-manager/quickstart.md` 与实际流程一致
- [ ] T041 [P] 打包验证：执行 `npm run desktop:package`，确认产物不改变 `dist/cli` 与 npm bin 入口（宪法 III）
- [ ] T042 宪法合规自查：简单性（无超出 plan 的新抽象）、TDD 顺序留痕、API 兼容（仅可选 `/health`）、安全审查落实、双语标题完整；准备非作者代码审查材料（宪法 V/VI）

---

## Dependencies & Execution Order/依赖与执行顺序

### Phase Dependencies/阶段依赖

- **Setup (Phase 1)**: 无依赖，立即开始
- **Foundational (Phase 2)**: 依赖 Phase 1；T007 完成前禁止任何故事实现
- **US1 (Phase 3)**: 依赖 Phase 2；T009/T010 → T011/T012 严格 TDD 顺序
- **US2 (Phase 4)**: 依赖 Phase 2；可与 US1 并行（不同文件），但 `src/desktop/main/ipc.ts` 变更需按 US1 → US2 顺序合入
- **US3 (Phase 5)**: 依赖 US2 的渠道控制器基础；测试发送建立在渠道存在之上
- **US4 (Phase 6)**: 依赖 US2；与 US3 可并行但共享 `channel-controller.test.ts`，建议串行
- **US5 (Phase 7)**: 依赖 Phase 2；与 US1~US4 可并行（独立文件）
- **US6 (Phase 8)**: 依赖 Phase 2 与 US1 的服务控制；托盘退出需停止服务
- **Polish (Phase 9)**: 依赖全部目标故事完成

### Parallel Opportunities/并行机会

- T003 与 T004 可并行（不同目录）
- T005 与 T006 可并行（不同测试文件）
- T015、T021、T026、T030/T031 可与其他故事的实现并行（不同测试文件）
- US5 整体可与 US1~US4 并行（独立源码目录）
- T040 与 T041 可并行（文档与打包）

## Implementation Strategy/实施策略

### MVP First/最小可行优先

1. 完成 Phase 1 + Phase 2（基线、运行时、安全壳）
2. 完成 Phase 3（US1：服务控制）→ **STOP，独立验收**
3. 追加 Phase 4 + Phase 5（US2/US3：渠道闭环）
4. 按需追加 US4、US5、US6，每个故事独立验收、互不回退

### Incremental Delivery/增量交付

- US1 → 桌面服务控制可用（MVP）
- US2 + US3 → 渠道注册与测试闭环
- US4 → 凭据轮换无需删除重建
- US5 → 接入状态可视化
- US6 → 常驻托盘体验

## Notes/备注

- [P] 任务 = 不同文件、无依赖；[Story] 标签用于需求追溯
- 严格 Red-Green-Refactor：测试先写且确认失败后再实现；禁止先实现后补测试（宪法 II）
- 每个任务或逻辑组完成后提交；检查点处暂停并独立验收故事
- 所有 fixture 使用虚构数据；日志、错误与测试断言不得包含真实凭据或完整敏感路径（宪法 IV）
