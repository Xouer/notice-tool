# Research: Agent Task Completion Notification/技术调研：智能体任务完成通知

**Date/日期**: 2026-11-07 | **Spec/规格**: [spec.md](../spec.md)

本文件解决规格与用户输入（TypeScript 开发；数据库选型优先安全性、可维护性、可测试性）中提取出的全部技术未知项。每项给出决策、理由与备选方案。

## R1: Database Selection/数据库选型（用户显式提问）

**Decision/决策**: 采用 **SQLite**，通过 `better-sqlite3` 驱动访问，配合 **Drizzle ORM**（`drizzle-orm` + `drizzle-kit`）管理表结构与迁移。数据库文件存放于用户数据目录（如 `%LOCALAPPDATA%/notice-tool/notice.db`），开启 WAL 模式，文件权限仅限当前用户。

**Rationale/理由**:
- **安全性**: SQLite 为嵌入式零网络面数据库——无监听端口、无服务进程、无账号体系，攻击面最小；配合 `SecretStore`（见 R2）将凭据以密文列存储，实现"静态加密 + 最小暴露"；所有查询经 Drizzle 参数化，杜绝拼接注入。
- **可维护性**: Drizzle 以 TypeScript 代码定义表结构（schema 即类型），编译期校验字段与类型；`drizzle-kit` 提供版本化迁移（生成 SQL 迁移文件入库审查），演进可追溯，符合宪法原则 III 的数据格式兼容性要求。
- **可测试性**: `better-sqlite3` 同步 API 无需异步 mock；测试中用 `:memory:` 数据库即可获得完全隔离、毫秒级启动的真实持久层，无需外部服务。
- **匹配规模**: 单用户本地工具，数据量级为"渠道配置数条 + 30 天通知历史数万条"，SQLite 绰绰有余，符合宪法原则 I（简单设计）。

**Alternatives Considered/备选方案**:
- **PostgreSQL**: 功能强大，但要求用户安装并常驻运行数据库服务——对 C 端本地工具是不可接受的部署负担，违背简单设计；仅在多用户云端形态下才合理。
- **Prisma**: 成熟但引入引擎二进制与代码生成链路，运行时更重、构建步骤更多；相较 Drizzle 对本项目收益不成比例。
- **Kysely**: 类型安全良好，但表结构与迁移需另行组装，整体方案拼接成本高于 Drizzle。
- **JSON/lowdb 文件**: 无事务与原子写保证（进程被杀易损坏），30 天历史的查询/去重/分页均需手写，可维护性与可测试性差；仅适合纯配置场景。

## R2: Credential Storage/凭据存储安全

**Decision/决策**: 渠道凭据以 **AES-256-GCM 密文** 存于 SQLite 的 `credentials_blob` 列；加密密钥由 **操作系统用户级凭据保护机制** 托管（Windows 优先使用 DPAPI，经原生绑定如 `@primno/dpapi`；macOS Keychain / Linux Secret Service 作为平台扩展位），通过统一的 `SecretStore` 接口隔离平台差异。密钥不落明文文件、不入日志、不随导出。

**Rationale/理由**: 满足 FR-012 与宪法原则 IV；DPAPI 以"当前 Windows 用户"为边界，无需自管主密码即可实现静态加密；`SecretStore` 接口保证可测试性（测试用内存实现替换）并为跨平台预留最小扩展点，而非投机性地一次实现三平台。

**Alternatives Considered/备选方案**:
- 明文 JSON 配置（直接拒绝：违背 FR-012）；环境变量注入（凭据多渠道管理困难、易被 shell 历史泄露）；`keytar`（上游已归档停维，拒绝）；自研"主密码"方案（增加用户心智负担，无必要）。

## R3: MCP Protocol Integration/MCP 协议接入

**Decision/决策**: 使用官方 **`@modelcontextprotocol/sdk`**（TypeScript）实现 MCP 服务端。v1 以 **stdio 传输**为主（由外部 MCP 客户端按需拉起子进程，多个客户端实例经 WAL 模式共享同一 SQLite 数据库，互不冲突）；Streamable HTTP 传输作为后续扩展（见 R8 的复杂度控制说明）。对外仅暴露两个工具：`send_notification` 与 `report_task_end`（契约见 [contracts/mcp-tools.md](../contracts/mcp-tools.md)）。

**Rationale/理由**: 官方 SDK 保证协议合规与演进跟班；stdio 是兼容面最广、依赖最少的传输方式；仅暴露白名单工具满足授权模型（宪法原则 IV）与 API 兼容性（原则 III）。

**Alternatives Considered/备选方案**: 自行实现 MCP 协议（违背简单设计，拒绝）；仅 Streamable HTTP（要求常驻服务与端口管理，v1 非必需）。

## R4: Hook Reception Pattern/钩子接入方式

**Decision/决策**: 提供**双入口**：① **CLI stdin 模式**（`notice hook` 从标准输入读取 JSON 事件并退出，适配以 shell 命令注册钩子的智能体，如 Claude Code hooks）；② **本地 HTTP 端点**（常驻服务 `notice serve` 暴露 `POST /v1/hooks/task-completed`，适配可发 HTTP 回调的智能体与其他本地工具）。两入口共享同一事件校验与分发管线。HTTP 层基于 **Fastify**（内置 JSON Schema 校验服务 FR-013 的输入校验，测试可经 `inject()` 免网络注入请求）。

**Rationale/理由**: CLI stdin 覆盖"智能体执行命令型钩子"这一最普遍形态；HTTP 覆盖常驻回调形态；二者实现成本均低且互为补充。Fastify 成熟、类型友好、校验内建，避免手写 body 解析与校验。

**Alternatives Considered/备选方案**: 仅 HTTP（对命令型钩子智能体不友好）；仅 CLI stdin（无法接收外部工具回调）；Express（类型与内建校验弱于 Fastify）。

## R5: Task Status Polling/任务状态巡查适配

**Decision/决策**: 定义统一的 **`AgentStatusAdapter` 接口**（读取→解析→返回"任务列表及各自状态"）；v1 提供两个具体适配器：**claude-code**（读取 `~/.claude/projects/` 下的会话 JSONL 尾部，判断最近会话是否到达结束态）与 **generic-file**（用户配置"状态文件路径 + 完成特征正则"的通用模板）。巡查循环默认 10 秒间隔（可配）。无法读取状态时按 FR-002 场景 3 返回明确错误。

**Rationale/理由**: 适配器接口是覆盖"多智能体、演进快"的最小抽象（有明确理由，非投机抽象）；两个开箱适配器分别覆盖"已知头部智能体"与"长尾自助接入"；正则探测是文件型状态的最简可行方案。

**Alternatives Considered/备选方案**: 屏幕截图/OCR 识别（复杂度与误判率高，拒绝）；逆向智能体私有接口（不稳定且可能违约，拒绝）；v1 实现更多具体适配器（可等真实需求出现后增量补充，YAGNI）。

## R6: WeChat & QQ Channel Realization/微信与 QQ 渠道实现

**Decision/决策**: **微信**：支持**企业微信群机器人 Webhook** 与 **Server酱/PushPlus 类推送服务**两种可配置方式；**QQ**：支持**QQ 官方机器人**与 **PushPlus 等第三方推送服务**。全部归一为 `WebhookChannel` 适配器族（差异只在 URL、鉴权头与负载格式），渠道类型在配置中枚举区分。

**Rationale/理由**: 规格假设章节已声明微信/QQ 无官方个人通用推送 API；上述方式均为官方或成熟合规通道，无需逆向个人号协议（存在封号与合规风险，明确拒绝）。统一 Webhook 族最大化代码复用（简单设计）。

**Alternatives Considered/备选方案**: 个人号协议库（itchat 类，封号风险 + 违反服务条款，拒绝）；仅支持其中一种（覆盖面不足）；等待官方 API（不可控）。

## R7: Other Core Dependencies/其余核心依赖

**Decision/决策**:
- **运行时**: Node.js ≥ 22 LTS，TypeScript（严格模式，ESM）。
- **邮件**: `nodemailer`（事实标准，支持 SMTP 授权码模型）。
- **CLI 框架**: `commander`（轻量成熟）。
- **重试**: `p-retry`（成熟退避库，避免手写出错）。
- **模板渲染**: 自实现 `{{placeholder}}` 白名单字段插值器（约 50 行，仅允许任务标识/时间/结果等白名单字段），拒绝通用模板引擎。
- **测试**: `vitest`（单测/集测）+ Fastify `inject()`（HTTP 契约测试）+ `:memory:` SQLite（持久层测试）。

**Rationale/理由**: 每项均为该领域成熟首选且体量小；模板插值器自实现是刻意决策——通用引擎（如 Handlebars）引入额外运行时与注入面，而需求仅为固定字段替换（简单设计）。

**Alternatives Considered/备选方案**: Handlebars/EJS（过重）；axios（Node 22 内建 fetch 足够，减依赖）；Jest（启动慢于 Vitest，Vitest 与 ESM/TS 融合更佳）。

## R8: Deduplication & Anti-Flood/去重与防轰炸

**Decision/决策**:
- **去重**: 原契约按"同 `source_agent` + `task_id` 且 `received_at` 在冷却窗口内"判重；008 更新为有稳定 `event_key` 的 Stop 按 `(source_agent, task_id, event_key)` 在保留历史内判重，旧无键调用保留原冷却语义。重复事件仍仅补充记录不触发通知。不使用唯一约束硬去重（需要保留重复历史）。
- **防轰炸**: 每 `channel` 令牌桶限流 + 事件聚合窗口（同渠道短时间多条待发合并为一条汇总消息，窗口默认 30 秒）。

**Rationale/理由**: 滑动窗口查询式去重对"钩子先到、巡查后到"的时间偏差鲁棒（若按 `finished_at` 分桶唯一约束，两个观察源的时间差会跨桶导致重复）；查询走 `(source_agent, task_id, received_at)` 索引，成本可忽略。防轰炸逻辑为纯函数核心（时间+计数输入→决策输出），最易 TDD。

**Alternatives Considered/备选方案**: 内存 Set 去重（进程重启即失，拒绝）；`finished_at` 截断分桶 + 唯一约束（跨桶重复问题，拒绝）；无限流（FR-013 要求必须有限制）。

## R9: MCP HTTP Transport Deferment/MCP HTTP 传输延后

**Decision/决策**: v1 的 MCP 服务仅 stdio 传输；Streamable HTTP 传输（挂在 `notice serve` 的 Fastify 实例上）列为 v1.x 增量，不进入本特性范围。

**Rationale/理由**: stdio 已满足"其他工具发现并调用能力"的规格要求（SC-006）；HTTP 传输需要考虑会话管理、端口策略与并发写放大，属明确可延后的复杂度（宪法原则 I：无验证理由的复杂度一律拒绝）。

**Alternatives Considered/备选方案**: v1 同时双传输（被上述复杂度理由否决）。

## Conclusion/结论

全部技术未知项已决策，无 `NEEDS CLARIFICATION` 残留；选型总体特征：**嵌入式存储（SQLite）+ 官方/成熟依赖 + 最小自研面（模板插值、去重、限流核心）**，与宪法六项原则一一对应（见 plan.md 的 Constitution Check/宪法检查）。
