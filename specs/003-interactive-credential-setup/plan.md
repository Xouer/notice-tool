# Implementation Plan: Interactive Channel Setup Wizard/实施计划：交互式渠道配置向导

**Branch**: `003-interactive-credential-setup` | **Date**: 2026-11-07 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/003-interactive-credential-setup/spec.md`；用户约束——使用目前的技术栈进行（零新增依赖）。

**Note**: This template is filled in by the `/speckit.plan` command; its definition describes the execution workflow.

## Summary/摘要

在既有 `notice channel add` 命令上增加交互式向导路径：当用户未提供凭据类标志（或在交互终端）时，启动分步向导——第一步选渠道类型，第二步选连接方式（多方式渠道才出现），第三步按字段目录逐项输入值（每项含含义、格式示例、获取方法提示，敏感项不回显明文），最后展示脱敏确认摘要，用户确认后才经既有仓储写入。向导产物与命令行标志产物完全等价（同一 `validateChannelInput` 校验、同一加密存储）；既有命令行标志路径行为零回归。**技术栈零新增依赖**：交互 IO 用 Node 内置 `node:readline/promises` 与原始模式，数字序号选择天然满足极简终端回退；向导引擎为纯状态机，经 `WizardIO` 注入接缝实现 TDD。

## Technical Context/技术上下文

**Language/Version**: TypeScript（strict 模式，ESM），运行于 Node.js ≥ 22 LTS（与 001/002 一致）。

**Primary Dependencies**: 无新增。沿用既有：`commander`（CLI）、`better-sqlite3` + `drizzle-orm`（存储）、`@primno/dpapi`（凭据保护）、`vitest`（测试）。交互输入与选择列表使用 Node 内置 `node:readline` / `node:readline/promises` 与 `process.stdin` 原始模式（research R1/R3）。

**Storage**: 无表结构变更——向导只是既有"通知渠道配置"（`notification_channels`，凭据加密 JSON 列）的另一种创建入口；向导会话仅驻内存，不落盘（见 [data-model.md](data-model.md)）。

**Testing**: `vitest`。向导引擎用脚本化 `WizardIO` 假实现做单元测试（每步选择/输入/校验失败重试/返回/取消）；CLI 契约测试经 `runCli` 注入假 `WizardIO` 断言触发条件与退出码；既有 `channel add` 标志路径测试保持全绿（回归门禁，SC-004）。

**Target Platform**: Windows 10+（优先，终端为 Windows Terminal/PowerShell）；macOS/Linux 兼容（raw 模式为 POSIX/Windows 通用能力，非 TTY 时拒绝向导）。

**Project Type**: cli（既有本地常驻工具的配置体验增强）。

**Performance Goals**: 向导各步骤响应为本地即时交互（无网络调用）；完成一次飞书应用凭证配置的输入步骤 ≤ 8 次人机往返。

**Constraints**: 敏感凭据输入不回显明文、全程不写日志（FR-004/FR-010）；取消/中断零落盘（SC-003）；非 TTY/`--json` 环境绝不弹向导（FR-008/FR-009）；既有标志路径行为不变（契约 [contracts/wizard.md](contracts/wizard.md)）。

**Scale/Scope**: 单用户；新增/改动文件预计 ≤ 5 个（向导引擎、向导 IO、`channel.ts` 入口改造、CLI 根注入接缝、测试）；不触碰 `channels/` 适配器、`core/`、`hookserver/`、`mcp/`、`pollers/`、`storage/`。

## Constitution Check/宪法检查

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*
*门禁：Phase 0 调研前必须通过；Phase 1 设计后复查。*

| 原则 | 门禁问题 | 评估（设计前） | 评估（Phase 1 后复查） |
| --- | --- | --- | --- |
| I. 简单设计 | 是否存在无理由复杂度？ | PASS——零新增依赖；向导为单文件状态机 + 薄 IO 层，不引入持久化草稿、不引入 TUI 框架 | PASS——字段目录驱动各渠道步骤，无投机抽象；定时刷新/多页 UI 均不做 |
| II. 测试先行 | 实现是否以测试驱动？ | PASS——引擎纯逻辑经 `WizardIO` 注入可脚本化测试；先写用例清单再实现 | PASS——research R5 用例清单覆盖 FR-001~FR-008 全部验收场景 |
| III. API 兼容性 | 对外接口是否受控演进？ | PASS——仅放宽 `channel add` 的 `<type>`→`[type]` 与 `--name` 必填（缺省时在 TTY 下转向导，非 TTY 下保持退出码 2）；标志路径行为不变，契约见 [contracts/wizard.md](contracts/wizard.md) | PASS——既有测试全绿为任务门禁；`--json` 输出结构零变更 |
| IV. 安全审查 | 敏感数据是否有显式审查？ | PASS——敏感输入不回显（raw 模式掩码）；会话仅内存；复用既有加密列与掩码管线 | PASS——data-model 安全要点 + 契约脱敏规则落实（FR-010 对应 R3/R7） |
| V. 代码审查 | 合入流程是否有门？ | PASS（流程级）——PR 须经非作者审查 | PASS |
| VI. 中英双语标题 | 产物标题是否双语？ | PASS——本计划及全部产物执行 | PASS |

无门禁违规，无需填写复杂度豁免表（Complexity Tracking 省略）。

## Project Structure/项目结构

### Documentation (this feature)/文档（本特性）

```text
specs/003-interactive-credential-setup/
├── plan.md              # This file (/speckit.plan command output)/本文件
├── research.md          # Phase 0 output/Phase 0 产物：交互 IO 调研与技术决策
├── data-model.md        # Phase 1 output/Phase 1 产物：向导会话结构与状态机（增量）
├── quickstart.md        # Phase 1 output/Phase 1 产物：端到端验证指南
├── contracts/           # Phase 1 output/Phase 1 产物：接口契约
│   └── wizard.md        # 交互式向导契约（触发条件、步骤流、WizardIO、脱敏规则）
└── tasks.md             # Phase 2 output（/speckit.tasks command - NOT created by /speckit.plan）
```

### Source Code (repository root)/源代码（仓库根，仅列变更文件）

```text
src/
└── cli/
    ├── wizard.ts            # 新增：向导引擎状态机 + 字段目录（纯逻辑，可注入 WizardIO）
    ├── wizard-io.ts         # 新增：WizardIO 接口 + readline/raw 模式真实实现 + 脚本化假实现工厂
    ├── channel.ts           # 扩展：add 命令 [type] 可选化、--name 可选化、--interactive、向导分派
    └── index.ts             # 扩展：CliRunOptions 增加 wizardIO 测试注入接缝（与 dataDir/stdin 同模式）
tests/
├── unit/
│   ├── wizard.test.ts       # 新增：引擎用例（类型/方式选择、逐项输入、校验重试、返回、取消、默认名、重名）
│   └── wizard-io.test.ts    # 新增：掩码输入与数字回退行为（可注入流）
└── integration/
    └── wizard-cli.test.ts   # 新增：runCli + 假 WizardIO 端到端（触发条件、退出码、--json 拒绝向导、标志路径回归）
```

**Structure Decision/结构决策**: 沿用单仓库单包结构（001 既定），不新增目录。向导引擎独立为 `wizard.ts` 纯状态机、IO 独立为 `wizard-io.ts` 的理由：分步导航、返回上一步、即时校验是可穷举的纯逻辑（SC-001/SC-003 的测试对象），与终端读写解耦后各自可 TDD（宪法原则 II）；不做 TUI 框架/方向键列表——数字序号选择即可满足 FR-008 且零依赖（宪法原则 I）。
