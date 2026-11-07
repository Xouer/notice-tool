# Tasks: Agent Task Completion Notification/任务清单：智能体任务完成通知

**Input**: Design documents from `/specs/001-agent-task-notify/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/（均就绪）

**Tests**: 依据宪法原则 II（测试先行不可协商）与用户显式要求，本清单包含测试任务并按 **TDD（Red-Green-Refactor）顺序**组织：每阶段的"Tests/测试"小节先行，测试必须先编写并确认失败（Red），再实现使其通过（Green），最后重构。

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story./任务按用户故事分组，保证每个故事可独立实现与测试。

> **修订记录**: v2（2026-11-07，依据 `/speckit.analyze` 修复方案 E1–E8 应用）——新增 seeder 测试（T007，修 C1）、模板管理任务组（T032/T034/T039/T040，修 G1）、敏感过滤测试（T033，修 G4）、启动补检与零渠道可见性描述补充（修 G2/G3）、依赖与 CLI 根入口归属修正（修 O1/O2）；全量重编号 57→63，任务间依赖引用同步更新。

## Format: `[ID] [P?] [Story] Description`/格式说明

- **[P]**: Can run in parallel (different files, no dependencies)/可并行（不同文件、无未完成依赖）
- **[Story]**: Which user story this task belongs to/所属用户故事（US1–US4）
- Include exact file paths in descriptions/描述含确切文件路径

## Path Conventions/路径约定

- Single project（单项目）: `src/`、`tests/` at repository root（依据 plan.md 项目结构）。

---

## Phase 1: Setup (Shared Infrastructure)/阶段一：初始化（共享基础设施）

**Purpose**: Project initialization and basic structure/项目初始化与基础结构。

- [ ] T001 Create project structure per plan.md in package.json, tsconfig.json, drizzle.config.ts — 建立 `src/{cli,hookserver,mcp,pollers,channels,core,storage,config}/` 与 `tests/{unit,contract,integration}/` 目录；`package.json` 声明 bin `notice`（ESM、Node ≥ 22 engines）
- [ ] T002 Initialize TypeScript project with dependencies in package.json — 安装 `better-sqlite3`、`drizzle-orm`、`drizzle-kit`、`@modelcontextprotocol/sdk`、`fastify`、`commander`、`nodemailer`、`p-retry`、`@primno/dpapi`；dev 依赖 `typescript`（strict）、`vitest`、`@types/node`（版本以当期稳定版锁定并提交 lockfile）
- [ ] T003 [P] Configure linting, formatting and npm scripts in eslint.config.js, .prettierrc, package.json — ESLint（flat config）+ Prettier；scripts: `build`、`test`（vitest run）

**Checkpoint**: 项目骨架就绪，`npm run build` 与 `npm test`（空套件）可执行。

---

## Phase 2: Foundational (Blocking Prerequisites)/阶段二：基础设施（阻塞性前置）

**Purpose**: Core infrastructure that MUST be complete before ANY user story can be implemented/所有用户故事实现前必须完成的核心基础设施。

**⚠️ CRITICAL**: No user story work can begin until this phase is complete./本阶段完成前不得开始任何用户故事。

### Tests for Foundation（先写并确认 Red）

- [ ] T004 [P] Unit tests: config loader in tests/unit/config-loader.test.ts — 断言默认值合并（`127.0.0.1:47650`、巡查 10 秒、去重 10 分钟、聚合 30 秒、`perChannelPerMinute: 20`、`retentionDays: 30`）、未知字段忽略并告警、缺字段取默认
- [ ] T005 [P] Unit tests: AES-256-GCM cipher round-trip in tests/unit/crypto.test.ts — 加解密往返、篡改密文检测失败、掩码函数输出不含明文凭据
- [ ] T006 [P] Unit tests: database bootstrap in tests/unit/storage-db.test.ts — `:memory:` 建库执行迁移、文件库开启 WAL、迁移可重复执行（幂等）
- [ ] T007 [P] Unit tests: default template seeding in tests/unit/seed.test.ts — 断言每渠道恰好一个默认模板 + 一个通用默认模板、`is_default` 标记、重复执行幂等、内置模板删除被拒（宪法 II：seeding 实现前先行 Red）

### Implementation for Foundation

- [ ] T008 Implement config loader in src/config/loader.ts — 按 contracts/cli.md 配置结构：顶层键 `schemaVersion/server/polling/dedup/antiFlood/retentionDays`，未知字段忽略并告警（向前兼容）（依赖 T004）
- [ ] T009 Implement SecretStore interface with in-memory implementation in src/storage/secret-store.ts — 接口：`getMainKey()`/`seal()`/`unseal()`；内存实现供测试（依赖 T005）
- [ ] T010 [P] Implement Windows DPAPI SecretStore in src/storage/secret-store.dpapi.ts — 经 `@primno/dpapi` 以当前用户为边界保护主密钥（依赖 T009）
- [ ] T011 Implement AES-256-GCM blob cipher in src/storage/crypto.ts — 主密钥来自 SecretStore；明文仅发送瞬间驻留内存，不缓存不落日志（依赖 T005、T009）
- [ ] T012 Create Drizzle schema and initial migration in src/storage/schema.ts and drizzle/ — 四实体，约束逐条引用 data-model.md：`notification_channels.type` 枚举 `feishu/dingtalk/email/wechat/qq`；`name` 非空且"同 type 内唯一"；`enabled` 默认 `false`；`credentials_blob` 仅存密文；`task_events.result_status` 枚举 `success/failure/interrupted/unknown`；`task_events.trigger_type` 枚举 `hook/polling/mcp`；`notification_records.status` 枚举 `pending/sent/retrying/failed`；`notification_templates.body` ≤ 2000 字符、每渠道至多一个 `is_default`；`notification_records` 外键 `event_id`/`channel_id`；`(source_agent, task_id, received_at)` 建索引支撑去重查询
- [ ] T013 Implement database connection layer in src/storage/db.ts — 文件库（用户数据目录、WAL、仅当前用户可读）与 `:memory:` 测试库两种打开方式 + 迁移执行器（依赖 T006、T012）
- [ ] T014 [P] Implement credential-masking logger in src/core/logger.ts — Webhook 地址、令牌、授权码、推送密钥一律掩码输出（宪法 IV / FR-012）
- [ ] T015 [P] Implement default template seeding in src/storage/seed.ts — 每渠道一个默认模板 + 一个通用默认模板，`is_default` 标记且内置模板不可删除（data-model.md 通知模板实体）（依赖 T007）

**Checkpoint**: Foundation ready - user story implementation can now begin（in parallel or P1 → P2 → P3）/基础设施就绪，用户故事可开始。

---

## Phase 3: User Story 1 - Configure Notification Channels/用户故事一：配置通知渠道 (Priority: P1) 🎯 MVP（与 US2 共同构成 MVP）

**Goal**: 用户可添加飞书/钉钉/邮箱/微信/QQ 渠道、安全保存凭据并发送测试消息验证连通性/交付通知通路。

**Independent Test**: `notice channel add feishu`（输入 Webhook）→ `notice channel test feishu` → 飞书群收到测试消息，输出结果不含明文凭据。

### Tests for User Story 1（先写并确认 Red）

- [ ] T016 [P] [US1] Unit tests: channel config validation in tests/unit/channel-config.test.ts — 约束逐条引用 data-model.md：`type` 枚举五值；`name` 非空、同 `type` 内唯一；Webhook URL 合法；`email` 密文结构须含收件地址与 SMTP 授权码；`enabled` 默认 `false`；删除渠道后凭据一并清除且历史通知记录保留（`channel_id` 置空）
- [ ] T017 [P] [US1] Contract tests: CLI channel subcommands in tests/contract/cli-channel.test.ts — 按 contracts/cli.md 断言子命令集合（add/list/enable/disable/remove/test）、退出码 `0/1/2/3`、`--json` 输出结构、list 输出一律掩码凭据
- [ ] T018 [P] [US1] Integration tests: add → test send in tests/integration/channel-test-send.test.ts — 本地假 HTTP 服务承接 Webhook 负载与 SMTP 假服务器，断言：add 即加密入库、test 送达、无效 Webhook 返回 `AUTH_INVALID`/`NETWORK_UNREACHABLE` 分类且不崩溃

### Implementation for User Story 1

- [ ] T019 [US1] Implement channel repository in src/storage/channel-repository.ts — CRUD + 凭据经 T011 加解密 + 删除即物理清除（依赖 T012、T011、T016）
- [ ] T020 [US1] Define ChannelAdapter interface in src/channels/adapter.ts — 统一 `send(payload, credentials)` 返回逐渠道结果与错误分类码 `AUTH_INVALID/NETWORK_UNREACHABLE/RATE_LIMITED_REMOTE/CONTENT_REJECTED/UNKNOWN`（contracts/cli.md 错误码分类）
- [ ] T021 [P] [US1] Implement feishu webhook adapter in src/channels/feishu.ts（依赖 T020）
- [ ] T022 [P] [US1] Implement dingtalk webhook adapter in src/channels/dingtalk.ts（依赖 T020）
- [ ] T023 [P] [US1] Implement email SMTP adapter in src/channels/email.ts — nodemailer，SMTP 授权码模型（依赖 T020）
- [ ] T024 [P] [US1] Implement wechat adapter in src/channels/wechat.ts — 企业微信机器人 Webhook 与 Server酱/PushPlus 两种可配置方式（research.md R6，Webhook 族）（依赖 T020）
- [ ] T025 [P] [US1] Implement qq adapter in src/channels/qq.ts — QQ 官方机器人与 PushPlus 类服务（research.md R6）（依赖 T020）
- [ ] T026 [US1] Implement CLI channel commands in src/cli/channel.ts and src/cli/index.ts — `add`（交互式输入，即时加密入库）、`list`（掩码）、`enable/disable`、`remove`、`test`（显示成功/失败及原因）；并组装 CLI 根入口（commander 程序、全局参数 `--config`/`--json` 注册）（依赖 T019、T021–T025、T017、T018）

**Checkpoint**: US1 独立可演示——配置渠道 + 测试消息送达（quickstart.md Setup 与场景 A 前置部分）。

---

## Phase 4: User Story 2 - Hook-Triggered Notification/用户故事二：钩子触发任务完成通知 (Priority: P1) 🎯 MVP

**Goal**: 钩子事件（CLI stdin 或 HTTP）→ 校验 → 去重 → 模板渲染 → 多渠道自动通知 → 重试与历史/完成核心自动化闭环。

**Independent Test**: `echo '{...task-001...}' | notice hook` → 飞书收到按默认模板渲染的完成通知；再次发送同 `taskId` 不再通知；`notice history` 显示 `sent` 记录。

### Tests for User Story 2（先写并确认 Red）

- [ ] T027 [P] [US2] Unit tests: template renderer in tests/unit/template.test.ts — 白名单占位符 `{{task_id}}/{{source_agent}}/{{result_status}}/{{finished_at}}/{{result_summary}}`；未知占位符保存/渲染即报错；正文 ≤ 2000 字符（data-model.md 模板实体约束）
- [ ] T028 [P] [US2] Unit tests: dedup cooldown in tests/unit/dedup.test.ts — 同 `(source_agent, task_id)` 且 `received_at` 在冷却窗口（默认 10 分钟，可配）内判重；跨窗口放行；重复仅补充记录不触发通知（FR-007）
- [ ] T029 [P] [US2] Unit tests: anti-flood in tests/unit/anti-flood.test.ts — 渠道级令牌桶（默认 `perChannelPerMinute: 20`）+ 聚合窗口（默认 30 秒）纯函数行为
- [ ] T030 [P] [US2] Contract tests: hook payload schema in tests/contract/hook-payload.test.ts — 按 contracts/hook-receiver.md 断言字段必填性/长度上限（`source ≤64`、`taskId ≤256`、`resultSummary ≤500`）/枚举值；非法负载整体拒绝；HTTP 响应 `202/400/429/500` 及 `deduplicated` 标记；CLI 退出码 `0/2/3`
- [ ] T031 [P] [US2] Integration tests: notify flow in tests/integration/notify-flow.test.ts — 模拟事件 → `:memory:` 库 → 假渠道适配器：每个已启用渠道恰好一条 `sent` 记录；单渠道失败不阻断其他渠道；重试超限进入 `failed` 且错误码分类正确；重复 `taskId` 第二轮零通知；无任何已启用渠道时事件仍落库且不产生通知记录
- [ ] T032 [P] [US2] Unit tests: template repository validation in tests/unit/template-repository.test.ts — 未知占位符保存即拒绝、正文 ≤2000 字符、每渠道至多一个 `is_default`、内置模板不可删除（data-model.md 模板实体约束，复用 T035 渲染器白名单规则）
- [ ] T033 [P] [US2] Unit tests: sensitive content filtering in tests/unit/sensitive-filter.test.ts — `resultSummary` 敏感模式（密钥/令牌样式）过滤、长度 ≤500 截断、`raw_payload_ref` 仅存脱敏摘要（contracts/hook-receiver.md + data-model.md）
- [ ] T034 [P] [US2] Contract tests: CLI template commands in tests/contract/cli-template.test.ts — 按 contracts/cli.md 断言 `template list/set-default/edit` 子命令、退出码 `0/1/2/3` 与 `--json` 输出

### Implementation for User Story 2

- [ ] T035 [US2] Implement template renderer in src/core/template.ts — 白名单占位符插值器（research.md R7，约 50 行纯函数）（依赖 T027）
- [ ] T036 [US2] Implement dedup service in src/core/dedup.ts — 冷却窗口查询式去重，走 `(source_agent, task_id, received_at)` 索引（依赖 T028、T012）
- [ ] T037 [US2] Implement anti-flood in src/core/anti-flood.ts — 令牌桶 + 聚合窗口纯函数（依赖 T029）
- [ ] T038 [US2] Implement notification dispatcher in src/core/dispatcher.ts — 每已启用渠道创建 `pending` 记录 → 渲染模板 → 发送（`p-retry` 指数退避）→ 更新 `sent/retrying/failed`；错误码脱敏分类（依赖 T035、T037、T020）
- [ ] T039 [US2] Implement template repository in src/storage/template-repository.ts — CRUD + 保存校验（白名单占位符、≤2000、默认唯一、内置不可删）（依赖 T032、T035）
- [ ] T040 [US2] Implement CLI template commands in src/cli/template.ts — `list`/`set-default`/`edit`（依赖 T034、T039）
- [ ] T041 [US2] Implement event ingestion pipeline in src/core/event-pipeline.ts — 校验 → 去重 → 落库 → 分发的统一管线（CLI/HTTP/MCP 三入口共用，FR-007/FR-010）；落库前对 `resultSummary` 做敏感模式过滤，`raw_payload_ref` 仅存脱敏摘要（依赖 T033、T036、T038）
- [ ] T042 [US2] Implement Fastify hook server in src/hookserver/server.ts — `POST /v1/hooks/task-completed`，仅绑定 `127.0.0.1`，JSON Schema 内建校验，响应体与错误码按 contracts/hook-receiver.md（依赖 T041、T030）
- [ ] T043 [US2] Implement CLI notice hook in src/cli/hook.ts — stdin 读取 JSON、复用管线、退出码 `0/2/3`（依赖 T041、T030）
- [ ] T044 [US2] Implement CLI notice serve in src/cli/serve.ts — 常驻启动 hook server（巡查调度在 US3 接入）（依赖 T042）
- [ ] T045 [US2] Implement CLI notice history/resend in src/cli/history.ts — `--limit/--status` 过滤、`resend` 将 `failed` 重置 `pending`、输出无明文凭据；输出中标注"有事件但无可用渠道"的明确提示（依赖 T031、T019）

**Checkpoint**: US1 + US2 = **MVP 完整闭环**（quickstart.md Setup + 场景 A/B/C 可全部通过）。STOP and VALIDATE: 独立验证后可交付演示。

---

## Phase 5: User Story 3 - Task Status Polling/用户故事三：无钩子时的任务状态巡查 (Priority: P2)

**Goal**: 无钩子条件下按可配间隔巡查智能体任务状态，识别"进行中 → 已结束"并触发与钩子一致的通知流程。

**Independent Test**: 配置 generic-file 适配器指向演示状态文件 → `notice watch` → 向文件追加完成特征 → 下一巡查周期内收到通知；不可读适配器打印明确不支持提示。

### Tests for User Story 3（先写并确认 Red）

- [ ] T046 [P] [US3] Unit tests: claude-code adapter in tests/unit/poller-claude-code.test.ts — 基于 fixtures 会话 JSONL 尾部解析：识别最近会话到达结束态、任务列表与各自状态
- [ ] T047 [P] [US3] Unit tests: generic-file adapter in tests/unit/poller-generic-file.test.ts — "状态文件路径 + 完成特征正则"命中/未命中/文件不存在三种行为
- [ ] T048 [P] [US3] Integration tests: polling flow in tests/integration/polling-flow.test.ts — 巡查检测到状态迁移触发与钩子一致的管线；钩子 + 巡查双通道先后命中同一任务仅一轮通知（SC-003）；无法读取状态返回明确错误不静默；`notice serve` 重启后对离线期间已结束任务补检并仅通知一次

### Implementation for User Story 3

- [ ] T049 [US3] Define AgentStatusAdapter interface in src/pollers/adapter.ts — `readTasks()` 返回任务列表及状态（research.md R5）
- [ ] T050 [US3] Implement claude-code adapter in src/pollers/claude-code.ts — 读取 `~/.claude/projects/` 会话 JSONL 尾部（依赖 T046、T049）
- [ ] T051 [US3] Implement generic-file adapter in src/pollers/generic-file.ts — 路径 + 完成特征正则的通用模板（依赖 T047、T049）
- [ ] T052 [US3] Implement polling scheduler in src/pollers/scheduler.ts — 默认 10 秒可配间隔、状态迁移检测、不可读状态按 FR-002 场景 3 明确报错；启动时执行一次基线扫描，对冷却窗口内离线期间已结束的任务补发通知（spec 边界情况 2）（依赖 T050、T051、T041）
- [ ] T053 [US3] Implement CLI notice watch and integrate scheduler into notice serve in src/cli/watch.ts and src/cli/serve.ts — 前台巡查模式 + serve 内巡查调度（依赖 T052、T048、T044）

**Checkpoint**: US3 独立可用——无钩子智能体同样获得完成提醒（quickstart.md 场景 E）。

---

## Phase 6: User Story 4 - MCP Capability/用户故事四：MCP 能力供外部工具调用 (Priority: P3)

**Goal**: 以 MCP stdio 服务向外部工具暴露 `send_notification` 与 `report_task_end` 两个白名单工具，外部事件走与本地钩子一致的流程。

**Independent Test**: 任一 MCP 客户端以 `notice mcp` 拉起服务 → 发现且仅发现两个工具 → 调用 `report_task_end` 后飞书收到通知且去重生效。

### Tests for User Story 4（先写并确认 Red）

- [ ] T054 [P] [US4] Contract tests: MCP tools in tests/contract/mcp-tools.test.ts — 按 contracts/mcp-tools.md 断言：工具白名单仅 `send_notification`/`report_task_end`；入参 Schema（`message ≤2000` 必填、`channels` 可选数组、`report_task_end` 负载与 hook 一致且 `trigger` 强制 `mcp`）；输出 `delivered/failed` 逐渠道结构与 `deduplicated`；错误码 `VALIDATION_FAILED/RATE_LIMITED/INTERNAL`

### Implementation for User Story 4

- [ ] T055 [US4] Implement MCP stdio server in src/mcp/server.ts — `@modelcontextprotocol/sdk`，工具注册与协议合规（依赖 T054）
- [ ] T056 [US4] Implement send_notification tool in src/mcp/tools/send-notification.ts — 缺省发送全部已启用渠道，返回逐渠道结果（依赖 T055、T038）
- [ ] T057 [US4] Implement report_task_end tool in src/mcp/tools/report-task-end.ts — 复用 T041 事件管线与去重（依赖 T055、T041）
- [ ] T058 [US4] Implement CLI notice mcp in src/cli/mcp.ts — stdio 启动入口（依赖 T055）

**Checkpoint**: US4 独立可用——外部工具可发现并调用通知能力（quickstart.md 场景 D，SC-006）。

---

## Phase 7: Polish & Cross-Cutting Concerns/阶段七：打磨与横切关注点

**Purpose**: Improvements that affect multiple user stories/影响多个用户故事的收尾工作。

- [ ] T059 [P] Implement 30-day retention purge in src/core/retention.ts with tests in tests/unit/retention.test.ts — 清理 `task_events`/`notification_records` 超 `retentionDays`（默认 30 天）记录，serve 内定期执行；模板与渠道配置不清理（data-model.md 保留策略）
- [ ] T060 [P] Security hardening audit across src/ and tests/ — 验证日志/错误信息/CLI 输出/导出/通知内容零明文凭据（FR-012/SC-005）；HTTP 仅回环；错误响应无原始负载回显
- [ ] T061 Run quickstart.md validation — 依次执行 Setup + 场景 A–E，记录预期结果对照并修复偏差
- [ ] T062 [P] Performance validation — 钩子受理 → 开始发送 ≤ 5 秒；巡查间隔 10 秒生效；常驻内存 < 150 MB；历史分页查询 < 200 ms（plan.md 性能目标）
- [ ] T063 Final merge gate — 全量 `npm test` 通过 + 宪法合规自查（六原则逐项）+ 至少一名非作者代码审查（宪法原则 V）后方可合入

---

## Dependencies & Execution Order/依赖与执行顺序

### Phase Dependencies/阶段依赖

- **Setup (Phase 1)**: No dependencies - can start immediately/无依赖，立即可开始
- **Foundational (Phase 2)**: Depends on Phase 1 - BLOCKS all user stories/依赖阶段一，阻塞所有用户故事
- **User Stories (Phase 3–6)**: All depend on Phase 2 completion/均依赖阶段二完成
  - 顺序执行：US1 → US2 → US3 → US4（P1 → P1 → P2 → P3）；也可在阶段二完成后并行（多开发者）
- **Polish (Phase 7)**: Depends on all desired user stories being complete/依赖全部预期故事完成

### User Story Dependencies/用户故事依赖

- **US1 (P1)**: Phase 2 后即可开始，不依赖其他故事
- **US2 (P1)**: Phase 2 后即可开始；实现上复用 US1 的渠道适配器与仓库（T019–T025），但触发管线（T027–T044）可独立开发验证
- **US3 (P2)**: 依赖 T041 事件管线（US2）保证"与钩子一致的流程"
- **US4 (P3)**: 依赖 T038/T041（US2）复用分发与管线
- MVP = US1 + US2；US3/US4 为增量交付，各自独立可验证

### Within Each User Story/故事内部顺序

- Tests MUST be written and FAIL before implementation（Red）/测试先写并确认失败，再实现（Green）
- Models before services, services before endpoints（CLI/HTTP/MCP）/模型先于服务，服务先于入口
- Core implementation before integration/核心先于集成
- Story complete before moving to next priority/故事完成后再进入下一优先级

### Parallel Opportunities/并行机会

- Phase 1: T003；Phase 2: T004–T007 测试并行，实现侧 T010/T014/T015 并行
- US1: 五个渠道适配器 T021–T025 完全并行（不同文件）
- US2: 单测 T027/T028/T029/T032/T033 与契约测试 T030/T034 并行；US3: T046/T047/T048 并行
- Phase 7: T059/T060/T062 并行
- 多人时阶段二完成后可分人推进 US1/US2/US3/US4（注意 US2/3/4 对 T041 的共享依赖）

---

## Parallel Example: User Story 1/并行示例：用户故事一

```bash
# 先并行编写 US1 全部测试（Red）：
Task: "T016 [P] [US1] Unit tests: channel config validation in tests/unit/channel-config.test.ts"
Task: "T017 [P] [US1] Contract tests: CLI channel subcommands in tests/contract/cli-channel.test.ts"
Task: "T018 [P] [US1] Integration tests: add → test send in tests/integration/channel-test-send.test.ts"

# 确认失败后并行实现五个渠道适配器（Green）：
Task: "T021 [P] [US1] Implement feishu webhook adapter in src/channels/feishu.ts"
Task: "T022 [P] [US1] Implement dingtalk webhook adapter in src/channels/dingtalk.ts"
Task: "T023 [P] [US1] Implement email SMTP adapter in src/channels/email.ts"
Task: "T024 [P] [US1] Implement wechat adapter in src/channels/wechat.ts"
Task: "T025 [P] [US1] Implement qq adapter in src/channels/qq.ts"
```

---

## Implementation Strategy/实施策略

### MVP First (User Story 1 + 2)/MVP 优先

1. Complete Phase 1: Setup + Phase 2: Foundational（阻塞项）
2. Complete Phase 3: US1（通知通路）→ 独立验证
3. Complete Phase 4: US2（钩子闭环）→ **STOP and VALIDATE**: US1+US2 即 MVP，可交付演示
4. 增量：Phase 5: US3（巡查兜底）→ Phase 6: US4（MCP 生态）
5. Phase 7: 打磨与安全收尾

### Incremental Delivery/增量交付

每个 Checkpoint 都是可独立演示的增量：渠道测试消息 → 钩子自动通知 → 无钩子巡查 → MCP 外部调用；任一故事交付不破坏已交付故事（宪法 III：对外契约仅可选新增）。

---

## Notes/备注

- TDD 顺序为硬约束（宪法 II）：未先写测试并确认失败的功能代码不得合入
- [P] tasks = different files, no dependencies/不同文件且无未完成依赖
- [Story] label maps task to specific user story for traceability/故事标签用于追溯
- Commit after each task or logical group/每任务或逻辑组完成后提交
- 数据模型字段约束已在任务描述中逐条引用，实现时不得自行放宽
- Avoid: vague tasks, same file conflicts, cross-story dependencies that break independence/避免模糊任务、同文件冲突、破坏独立性的跨故事依赖
