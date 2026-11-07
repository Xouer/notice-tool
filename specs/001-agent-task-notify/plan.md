# Implementation Plan: Agent Task Completion Notification/实施计划：智能体任务完成通知

**Branch**: `001-agent-task-notify` | **Date**: 2026-11-07 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/001-agent-task-notify/spec.md`；用户输入——TypeScript 开发，数据库选型优先安全性、可维护性与可测试性（答案见 [research.md](research.md) R1：SQLite + better-sqlite3 + Drizzle ORM）。

**Note**: This template is filled in by the `/speckit.plan` command; its definition describes the execution workflow.

## Summary/摘要

构建一个单用户本地常驻工具 `notice`：接收本地 AI 编程智能体的"任务结束"事件（CLI stdin 钩子 / 本地 HTTP 端点），或以巡查模式轮询智能体任务状态作为无钩子兜底；事件经"校验 → 去重 → 模板渲染 → 多渠道分发（飞书/钉钉/邮箱/微信/QQ）→ 重试与历史记录"管线，把完成通知第一时间送达用户；同时以 MCP stdio 服务形式向外部工具暴露 `send_notification` 与 `report_task_end` 两个白名单工具。技术路线为嵌入式 SQLite 存储 + 官方/成熟 TypeScript 依赖 + 最小自研核心（模板插值、去重、防轰炸均为纯函数，TDD 友好）。全部选型论证见 [research.md](research.md)。

## Technical Context/技术上下文

**Language/Version**: TypeScript（strict 模式，ESM），运行于 Node.js ≥ 22 LTS。

**Primary Dependencies**: `@modelcontextprotocol/sdk`（MCP 官方 SDK）、`better-sqlite3` + `drizzle-orm`/`drizzle-kit`（存储与迁移）、`fastify`（本地钩子 HTTP 服务）、`commander`（CLI）、`nodemailer`（SMTP 邮件）、`p-retry`（退避重试）、`@primno/dpapi`（Windows DPAPI 凭据保护）。

**Storage**: SQLite（用户数据目录，WAL 模式，仅当前用户可读）；渠道凭据以 AES-256-GCM 密文列存储，密钥经 `SecretStore`（Windows DPAPI 优先，内存实现用于测试）托管——见 [research.md](research.md) R1/R2 与 [data-model.md](data-model.md)。

**Testing**: `vitest`（单测 + 集成）；HTTP 契约测试用 Fastify `inject()` 免网络注入；持久层测试用 `:memory:` SQLite；MCP 工具契约测试经 SDK 会话直连；渠道适配器测试用本地 HTTP 假服务。

**Target Platform**: Windows 10+（优先，当前用户环境）；macOS/Linux 为兼容目标（`SecretStore` 与 `AgentStatusAdapter` 均为平台扩展位）。

**Project Type**: cli（本地常驻服务 + CLI 命令行工具，单用户）。

**Performance Goals**: 钩子事件受理 → 通知开始发送 ≤ 5 秒；巡查默认间隔 10 秒（可配）；常驻内存 < 150 MB；30 天通知历史分页查询 < 200 ms。

**Constraints**: 纯本地运行，除各渠道官方 API 外无外联依赖；凭据与敏感内容不得明文落盘/入日志（FR-012）；HTTP 端点仅绑定回环地址。

**Scale/Scope**: 单用户单机；渠道配置 ≤ 20 条；通知历史量级 ≤ 10^5 条（30 天保留）；外部 MCP 客户端并发 ≤ 5。

## Constitution Check/宪法检查

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*
*门禁：Phase 0 调研前必须通过；Phase 1 设计后复查。*

| 原则 | 门禁问题 | 评估（设计前） | 评估（Phase 1 后复查） |
| --- | --- | --- | --- |
| I. 简单设计 | 是否存在无理由复杂度？ | PASS——全部为嵌入式/官方/成熟依赖；自研面仅模板插值、去重、限流（均有明确 FR 依据） | PASS——数据模型 4 实体、契约 4 份，无投机抽象 |
| II. 测试先行 | 实现是否以测试驱动？ | PASS——`research.md` R7 确定测试基建；任务阶段（`/speckit.tasks`）须按 Red-Green-Refactor 排序 | PASS——纯函数核心 + `:memory:` 库 + `inject()` 均为可测性优先设计 |
| III. API 兼容性 | 对外接口是否受控演进？ | PASS——钩子负载/MCP 工具/CLI/config 四份契约均含版本号与兼容规则 | PASS——契约均声明"仅可选新增，破坏性变更升 MAJOR"（[contracts/](contracts/)） |
| IV. 安全审查 | 敏感数据是否有显式审查？ | PASS——规格含安全章节；R2 确定密钥托管方案 | PASS——[data-model.md](data-model.md) 安全要点 + 契约错误码脱敏规则落实 |
| V. 代码审查 | 合入流程是否有门？ | PASS（流程级）——PR 须经非作者审查；已列入任务清单提示项 | PASS |
| VI. 中英双语标题 | 产物标题是否双语？ | PASS——本计划及全部产物执行 | PASS——research/data-model/contracts/quickstart 均合规 |

无门禁违规，无需填写复杂度豁免表（Complexity Tracking 省略）。

## Project Structure/项目结构

### Documentation (this feature)/文档（本特性）

```text
specs/001-agent-task-notify/
├── plan.md              # This file (/speckit.plan command output)/本文件
├── research.md          # Phase 0 output/Phase 0 产物：技术决策
├── data-model.md        # Phase 1 output/Phase 1 产物：数据模型
├── quickstart.md        # Phase 1 output/Phase 1 产物：端到端验证指南
├── contracts/           # Phase 1 output/Phase 1 产物：接口契约
│   ├── hook-receiver.md # 钩子接收（CLI stdin + HTTP）
│   ├── mcp-tools.md     # MCP 工具（白名单两个）
│   └── cli.md           # CLI 命令与配置文件
└── tasks.md             # Phase 2 output（/speckit.tasks command - NOT created by /speckit.plan）
```

### Source Code (repository root)/源代码（仓库根）

```text
package.json             # 单包，含 notice bin 与 npm scripts（build/test）
tsconfig.json            # strict + ESM
drizzle.config.ts        # 迁移生成配置（产物入库审查）
src/
├── cli/                 # commander 命令定义与进程入口（init/channel/serve/watch/hook/mcp/history/template）
├── hookserver/          # Fastify 实例、POST /v1/hooks/task-completed 路由与 JSON Schema 校验
├── mcp/                 # MCP stdio 服务端与工具实现（send_notification / report_task_end）
├── pollers/             # 巡查循环调度 + AgentStatusAdapter（claude-code 会话日志、generic-file 正则模板）
├── channels/            # 渠道适配器：feishu/dingtalk/email/wechat/qq（Webhook 族复用共同基座）
├── core/                # 事件分发、去重（冷却窗口查询）、防轰炸（令牌桶+聚合窗口）、重试、模板插值（纯函数优先）
├── storage/             # Drizzle schema、迁移、数据库连接、SecretStore（DPAPI 实现 + 内存测试实现）
└── config/              # config.json 加载、默认值合并与校验
tests/
├── unit/                # core 纯函数、模板插值、去重/限流、配置加载
├── contract/            # 钩子负载、MCP 工具、CLI --json 输出契约
└── integration/         # 端到端：模拟事件 → :memory: 库 → 假渠道适配器 → 通知记录断言
```

**Structure Decision/结构决策**: 采用单仓库单包（模板 Option 1）。理由：单用户本地 CLI 工具无多包共享需求，monorepo 属投机复杂度（宪法原则 I）；`channels`/`pollers` 通过适配器接口隔离变化（宪法原则 III 演进需要），`core` 与 `storage` 分层保证纯函数核心可在无 I/O 下先行 TDD（宪法原则 II）。
