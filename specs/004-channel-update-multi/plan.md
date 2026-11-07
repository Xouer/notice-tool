# Implementation Plan: Channel Config Update & Multi-Config/实施计划：渠道配置修改与同类型多条配置

**Branch**: `004-channel-update-multi` | **Date**: 2026-11-07 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/004-channel-update-multi/spec.md`；用户诉求——(1) 增加修改既有渠道配置的能力；(2) 支持同一渠道类型多条配置。

**Note**: This template is filled in by the `/speckit.plan` command; its definition describes the execution workflow.

## Summary/摘要

新增 `notice channel update <name>` 子命令：标志路径下将用户提供的凭据标志**合并**进既有解密凭据（未提供的字段保留原值），再经既有 `validateChannelInput` 归一化校验整体替换（连接方式切换 app↔webhook 时旧方式残留字段被归一化自动丢弃）；支持 `--name` 改名（写入前先做重名预检，保证原子性，SC-002）。交互终端且未提供凭据标志时复用 003 向导进入"修改模式"（类型锁定、当前值预填、敏感项回车保留），`--json`/非 TTY 拒绝向导（与 add 行为一致）。同类型多条配置（US2）由既有 `(type, name)` 唯一索引天然支撑，本特性以契约测试固化各流程行为并优化重名报错指引，**schema 零迁移、零新增依赖**。

## Technical Context/技术上下文

**Language/Version**: TypeScript（strict 模式，ESM），运行于 Node.js ≥ 22 LTS（与 001/002/003 一致）。

**Primary Dependencies**: 无新增。沿用既有：`commander`（CLI）、`better-sqlite3` + `drizzle-orm`（存储）、`@primno/dpapi`（凭据保护）、`vitest`（测试）。

**Storage**: 无表结构变更——`(type, name)` 唯一索引即"同类型多条配置"的数据基础；修改操作仅更新既有行的 `credentials_blob`（重新加密）与 `name`，启用状态与历史记录外键不动（见 [data-model.md](data-model.md)）。

**Testing**: `vitest`。仓储层：改名冲突/凭据合并归一化/原子性用例（内存库）；CLI 契约：经 `runCli` 注入假 `WizardIO` 断言 update 分派矩阵、退出码与 `--json` 输出；回归门禁：既有 `channel add` 全部测试保持全绿。

**Target Platform**: Windows 10+（优先）；macOS/Linux 兼容（与 001/003 一致，非 TTY 拒绝向导）。

**Project Type**: cli（既有本地常驻工具的配置管理能力增强）。

**Performance Goals**: 修改操作为本地事务级写入（无网络调用），毫秒级完成；凭据轮换一条命令内完成（SC-001）。

**Constraints**: 校验失败原配置 100% 保持可用（SC-002，写入前全量校验 + 改名预检）；全程掩码不泄露明文（SC-004，FR-006）；退出码 0/1/2/3 契约不变；`--json` stdout 纯 JSON。

**Scale/Scope**: 单用户；新增/改动文件预计 ≤ 6 个（`channel.ts`、`wizard.ts`、`channel-repository.ts`、`channel-config.ts` 若干导出、测试）；不触碰 `channels/` 适配器、`core/`、`hookserver/`、`mcp/`、`pollers/`。

## Constitution Check/宪法检查

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*
*门禁：Phase 0 调研前必须通过；Phase 1 设计后复查。*

| 原则 | 门禁问题 | 评估（设计前） | 评估（Phase 1 后复查） |
| --- | --- | --- | --- |
| I. 简单设计 | 是否存在无理由复杂度？ | PASS——零新增依赖；部分更新复用 `validateChannelInput` 归一化语义（合并→整体校验），不引入增量补丁语言/差异对比机制 | PASS——update 修改模式仅复用既有字段目录与 WizardIO，新增为 seed 预填与类型锁定，无投机抽象 |
| II. 测试先行 | 实现是否以测试驱动？ | PASS——用例清单先于实现：合并/改名/原子性/分派矩阵逐条对应 FR-001~FR-012 | PASS——contracts/update.md 行为矩阵 + quickstart 场景全部映射为测试用例 |
| III. API 兼容性 | 对外接口是否受控演进？ | PASS——纯新增子命令 `update`；既有 `add/list/enable/disable/remove/test` 与退出码、`--json` 结构零变更；数据格式零迁移 | PASS——既有测试全绿为任务门禁 |
| IV. 安全审查 | 敏感数据是否有显式审查？ | PASS——凭据解密仅在写入瞬间内存中进行，重新加密入库；向导预填敏感值掩码；报错复用 `redactSensitive`（详见 data-model 安全要点） | PASS——contracts/update.md 脱敏规则落实（FR-006/SC-004） |
| V. 代码审查 | 合入流程是否有门？ | PASS（流程级）——PR 须经非作者审查 | PASS |
| VI. 中英双语标题 | 产物标题是否双语？ | PASS——本计划及全部产物执行（spec.md 已同步修正） | PASS |

无门禁违规，无需填写复杂度豁免表（Complexity Tracking 省略）。

## Project Structure/项目结构

### Documentation (this feature)/文档（本特性）

```text
specs/004-channel-update-multi/
├── plan.md              # This file (/speckit.plan command output)/本文件
├── research.md          # Phase 0 output/Phase 0 产物：更新语义、改名、向导复用等决策
├── data-model.md        # Phase 1 output/Phase 1 产物：仓储新增操作与不变量（增量）
├── quickstart.md        # Phase 1 output/Phase 1 产物：端到端验证指南
├── contracts/           # Phase 1 output/Phase 1 产物：接口契约
│   └── update.md        # channel update 命令契约（行为矩阵、合并规则、脱敏规则）
└── tasks.md             # Phase 2 output（/speckit.tasks command - NOT created by /speckit.plan）
```

### Source Code (repository root)/源代码（仓库根，仅列变更文件）

```text
src/
├── cli/
│   ├── channel.ts            # 扩展：新增 channel update 子命令（标志路径分派 + 向导分派 + 输出）
│   └── wizard.ts             # 扩展：runWizard 支持 update 模式 seed（类型锁定、当前值预填、敏感项保留语义）
└── storage/
    └── channel-repository.ts # 扩展：新增 rename(id, name)（同 type 内重名校验）与凭据更新复用 updateCredentials
tests/
├── unit/
│   └── channel-update.test.ts    # 新增：凭据合并归一化、改名冲突、原子性（校验失败零写入）
└── integration/
    └── update-cli.test.ts        # 新增：runCli 端到端（分派矩阵、退出码、--json、同类型多条独立操作）
```

**Structure Decision/结构决策**: 沿用单仓库单包结构（001 既定），不新增目录、不新增依赖。update 的部分更新语义选择"合并既有解密凭据 + `validateChannelInput` 归一化整体校验"而非实现字段级差异补丁：校验器本就按 type×mode 重建规范凭据集，自动丢弃连接方式切换后的残留字段，一处实现同时覆盖 FR-002/FR-003/FR-005（宪法原则 I）。仓储新增 `rename` 而非通用 `update`，保持"名称唯一"校验在仓储层单点收口（宪法原则 I；与 `create` 的唯一索引错误处理对称）。
