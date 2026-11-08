# Implementation Plan: Fix Task Completion Notification Content/实施计划：修复任务完成通知内容

**Branch**: `009-fix-notify-content` | **Date**: 2026-11-08 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/009-fix-notify-content/spec.md`

**Note**: This template is filled in by the `/speckit.plan` command; its definition describes the execution workflow.

## Summary/摘要

修复任务完成通知的内容缺陷：当前默认通知仅输出原始任务标识、UTC ISO 时间与可能为空的概要，导致用户无法识别"是哪一个对话任务结束"。本特性在不改变通知投递链路与渠道适配的前提下，仅调整**内容渲染语义与默认模板**——① 新增可选 `title` 字段（来源侧提供，缺失时生成可读兜底标题）；② 结束时间改为用户本地时区的人类可读格式；③ 概要为空时按结果状态生成有意义的兜底结论；④ 默认模板按固定结构（标题 → 任务标识 → 结果 → 时间 → 概要）重排。全部为纯函数核心改动，向后兼容，技术选型论证见 [research.md](research.md)。

## Technical Context/技术上下文

**Language/Version**: TypeScript（strict 模式，ESM），运行于 Node.js ≥ 22 LTS。

**Primary Dependencies**: 无新增依赖，沿用现有栈（`@modelcontextprotocol/sdk`、`better-sqlite3` + `drizzle-orm`、`fastify`、`commander`、`nodemailer`、`p-retry`、`@primno/dpapi`）。时间格式化采用 Node 内建 `Intl`/`Date` 本地时区能力。

**Storage**: SQLite（既有，**无需 schema 变更**）——`title` 作为在途字段随事件流入渲染管线，不单独落库（见 [research.md](research.md) R5）。

**Testing**: `vitest`；改动面为纯函数（标题兜底、本地时间格式化、概要兜底、模板白名单校验），全部可 TDD；集成测试经 `:memory:` SQLite + 假渠道适配器断言最终通知文本。

**Target Platform**: Windows 10+（优先，当前用户环境）；macOS/Linux 为兼容目标（本地时区读取依赖操作系统时区）。

**Project Type**: cli（本地常驻服务 + CLI 命令行工具，单用户）。

**Performance Goals**: 无新增性能目标；内容渲染为纯函数，单次渲染开销可忽略（微秒级），不影响既有"受理→发送 ≤ 5 秒"等目标。

**Constraints**: 向后兼容（`title` 为可选新增字段，旧负载/旧模板继续可用，遵循宪法原则 III）；标题与概要渲染前均经敏感过滤（原则 IV）；HTTP 端点仍仅绑定回环地址。

**Scale/Scope**: 单用户单机；改动面收敛于 `core/template.ts`、`core/event-pipeline.ts`、`cli/hook.ts`（来源负载映射）、`storage/seed.ts`（默认模板）与 `mcp/server.ts`（工具 schema 补 `title`）。

## Constitution Check/宪法检查

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*
*门禁：Phase 0 调研前必须通过；Phase 1 设计后复查。*

| 原则 | 门禁问题 | 评估（设计前） | 评估（Phase 1 后复查） |
| --- | --- | --- | --- |
| I. 简单设计 | 是否存在无理由复杂度？ | PASS——不新增依赖与表结构，仅纯函数 + 默认模板调整 | PASS——标题为在途字段不落库，无投机抽象 |
| II. 测试先行 | 实现是否以测试驱动？ | PASS——兜底/格式化/白名单均为纯函数，天然 TDD 友好 | PASS——[research.md](research.md) 明确每项决策的可测断言 |
| III. API 兼容性 | 对外接口是否受控演进？ | PASS——`title` 仅可选新增，旧负载/旧模板/旧数据不受影响 | PASS——[contracts/notification-content.md](contracts/notification-content.md) 声明兼容规则 |
| IV. 安全审查 | 敏感数据是否有显式审查？ | PASS——标题与概要同经敏感过滤，不引入新凭据 | PASS——[data-model.md](data-model.md) 安全要点落实 |
| V. 代码审查 | 合入流程是否有门？ | PASS（流程级）——PR 须经非作者审查 | PASS |
| VI. 中英双语标题 | 产物标题是否双语？ | PASS——本计划及全部产物执行 | PASS——research/data-model/contracts/quickstart 均合规 |

无门禁违规，无需填写复杂度豁免表（Complexity Tracking 省略）。

## Project Structure/项目结构

### Documentation (this feature)/文档（本特性）

```text
specs/009-fix-notify-content/
├── plan.md                        # This file (/speckit.plan command output)/本文件
├── research.md                    # Phase 0 output/Phase 0 产物：技术决策
├── data-model.md                  # Phase 1 output/Phase 1 产物：数据模型（字段/渲染语义）
├── quickstart.md                  # Phase 1 output/Phase 1 产物：端到端验证指南
├── contracts/                     # Phase 1 output/Phase 1 产物：接口契约
│   └── notification-content.md    # 通知内容契约（负载扩展 + 模板白名单 + 渲染语义）
└── tasks.md                       # Phase 2 output（/speckit.tasks command - NOT created by /speckit.plan）
```

### Source Code (repository root)/源代码（仓库根）

```text
src/
├── core/
│   ├── template.ts                # PLACEHOLDERS 白名单 + PlaceholderValues 增补 title
│   ├── event-pipeline.ts          # NormalizedEvent 增补 title；finished_at 本地化；result_summary 兜底
│   └── (新增) notification-content.ts  # formatLocalDateTime/titleFallback/summaryFallback 纯函数
├── cli/hook.ts                    # 来源负载映射：title 字段抽取（codebuddy/claude-code/codex）
├── storage/seed.ts                # 默认模板新增 {{title}} 与固定结构；旧默认模板迁移
└── mcp/server.ts                  # report_task_end/send_notification schema 补 title（可选）
tests/
├── unit/                          # 标题兜底、时间格式化、概要兜底、模板白名单
├── contract/                      # 通知内容契约（负载含/不含 title、默认格式）
└── integration/                   # 端到端：模拟事件 → :memory: 库 → 假渠道 → 断言通知文本
```

**Structure Decision/结构决策**: 沿用单仓库单包（与 001 一致，无新增项目）。改动收敛于既有 `core`/`cli`/`storage`/`mcp` 模块；`time-format.ts` 抽为独立纯函数以最大化可测性（宪法原则 II），不引入新分层。

## Complexity Tracking/复杂度跟踪

无门禁违规，本节省略。
