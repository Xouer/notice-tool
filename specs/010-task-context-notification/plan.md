# Implementation Plan: Task Context Notification/实施计划：任务上下文通知

**Branch**: `010-task-context-notification` | **Date**: 2026-11-08 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/010-task-context-notification/spec.md`

**Note**: This template is filled in by the `/speckit.plan` command; its definition describes the execution workflow.

## Summary/摘要

解决「任务完成通知无法识别具体任务」的痛点。实测定位根因：现有标题提取逻辑（009 引入）的字段识别与实际 CodeBuddy 转录格式不匹配——转录中标题存于 `ai-title` 记录的 `aiTitle` 字段、首条用户消息存于 `summary` 记录的 `summary` 字段，而提取逻辑只识别 `title/topic/name/text`，导致标题始终回退到 `codebuddy · 97645996` 这类技术标识，概要只剩「任务成功完成」。

本特性在不改变投递链路与表结构的前提下：① 修正转录标题字段识别（`aiTitle`/`summary`）；② 概要增加「首条用户消息」作为任务内容来源；③ 转录定位增加 `session_id` 兜底。全部为纯函数与映射层改动，向后兼容。技术论证见 [research.md](research.md)。

## Technical Context/技术上下文

**Language/Version**: TypeScript（strict 模式，ESM），运行于 Node.js ≥ 22 LTS。

**Primary Dependencies**: 无新增依赖，沿用现有栈（`better-sqlite3` + `drizzle-orm`、`fastify`、`commander`、`@modelcontextprotocol/sdk`、`nodemailer`、`p-retry`、`@primno/dpapi`）。转录解析用 Node 内建 `fs` 逐行 JSON 解析（零第三方）。

**Storage**: SQLite（既有，**零 schema 变更**）——`title`/`result_summary` 作为在途字段随事件流入渲染管线，不单独落库（见 [research.md](research.md) R3 / [data-model.md](data-model.md)）。

**Testing**: `vitest`；改动面为纯函数（转录标题提取、概要来源、定位），全部可 TDD；集成测试经 `:memory:` SQLite + 假渠道适配器 + **虚构转录 fixture** 断言最终通知文本。

**Target Platform**: Windows 10+（优先，当前用户环境）；macOS/Linux 为兼容目标（转录目录路径随平台 `~/.codebuddy` 归一）。

**Project Type**: cli（本地常驻服务 + CLI 命令行工具，单用户）。

**Performance Goals**: 无新增性能目标；标题/概要提取为逐行解析纯函数，单次开销可忽略（微秒级），不影响既有「受理→发送」目标。

**Constraints**: 向后兼容（字段识别修正不破坏旧负载/旧模板，遵循宪法原则 III）；标题与概要渲染前均经敏感过滤（原则 IV）；转录路径/正文不写入日志与历史。

**Scale/Scope**: 单用户单机；改动收敛于 `core/transcript-title.ts`（字段识别）、`core/event-pipeline.ts`（概要来源）、`cli/hook.ts`（转录定位）与配套测试。

## Constitution Check/宪法检查

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*
*门禁：Phase 0 调研前必须通过；Phase 1 设计后复查。*

| 原则 | 门禁问题 | 评估（设计前） | 评估（Phase 1 后复查） |
| --- | --- | --- | --- |
| I. 简单设计 | 是否存在无理由复杂度？ | PASS——不新增依赖与表结构，仅纯函数字段识别修正 | PASS——无投机抽象，标题/概要保持「在途字段」不落库 |
| II. 测试先行 | 实现是否以测试驱动？ | PASS——字段识别/概要来源/定位均为纯函数，TDD 友好 | PASS——[research.md](research.md) 明确每项决策的可测断言与虚构 fixture 要求 |
| III. API 兼容性 | 对外接口是否受控演进？ | PASS——仅修正字段识别、增强可选来源，不改 schema/占位符 | PASS——[contracts/task-context.md](contracts/task-context.md) 声明兼容规则 |
| IV. 安全审查 | 敏感数据是否有显式审查？ | PASS——标题/概要/转录正文均脱敏，不落日志 | PASS——[data-model.md](data-model.md) 安全要点落实 |
| V. 代码审查 | 合入流程是否有门？ | PASS（流程级）——PR 须经非作者审查 | PASS |
| VI. 中英双语标题 | 产物标题是否双语？ | PASS——本计划及全部产物执行 | PASS——research/data-model/contracts/quickstart 均合规 |

无门禁违规，无需填写复杂度豁免表。

## Project Structure/项目结构

### Documentation (this feature)/文档（本特性）

```text
specs/010-task-context-notification/
├── plan.md                        # This file (/speckit.plan command output)/本文件
├── research.md                    # Phase 0 output/Phase 0 产物：技术决策
├── data-model.md                  # Phase 1 output/Phase 1 产物：数据模型（字段/提取规则）
├── quickstart.md                  # Phase 1 output/Phase 1 产物：端到端验证指南
├── contracts/                     # Phase 1 output/Phase 1 产物：接口契约
│   └── task-context.md            # 任务上下文提取与渲染契约
└── tasks.md                       # Phase 2 output（/speckit.tasks command - NOT created by /speckit.plan）
```

### Source Code (repository root)/源代码（仓库根）

```text
src/
├── core/
│   ├── transcript-title.ts        # 修正：识别 aiTitle / summary 字段
│   ├── notification-content.ts    # 增强：概要增加「首条用户消息」来源
│   └── event-pipeline.ts          # 概要填充优先级：resultSummary → 转录 summary → 状态兜底
├── cli/hook.ts                    # 转录定位：transcript_path 优先、session_id 兜底
tests/
├── unit/                          # 字段识别、概要来源、定位纯函数
├── contract/                      # 任务上下文契约（负载含/不含标题与转录路径）
└── integration/                   # 端到端：虚构转录 → :memory: 库 → 假渠道 → 断言通知文本
```

**Structure Decision/结构决策**: 沿用单仓库单包（与 001/009 一致，无新增项目）。改动收敛于既有 `core`/`cli` 模块；`transcript-title` 的字段识别修正与 `notification-content` 的概要来源增强均保持纯函数，最大化可测性（宪法原则 II）。

## Complexity Tracking/复杂度跟踪

无门禁违规，本节省略。
