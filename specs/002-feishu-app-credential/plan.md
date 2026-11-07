# Implementation Plan: Feishu App Credential Channel/实施计划：飞书应用凭证消息通道

**Branch**: `002-feishu-app-credential` | **Date**: 2026-11-07 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/002-feishu-app-credential/spec.md`；用户约束——沿用现有技术栈，仅必要时新增依赖。

**Note**: This template is filled in by the `/speckit.plan` command; its definition describes the execution workflow.

## Summary/摘要

在既有飞书渠道适配器上扩展"应用凭证"连接方式：用户配置自建应用的 `app_id`、`app_secret` 与接收目标（类型 + 标识）后，适配器自动向飞书开放平台换取 `tenant_access_token`（内存缓存、按接口返回的有效期自动续取），再以应用身份调用 `im/v1/messages` 主动推送消息。Webhook 模式保留并存，既有配置与行为零回归。**技术栈零新增依赖**：HTTP 复用 `channels/adapter.ts` 的 `postJson`，令牌缓存为纯内存模块，错误分类复用既有五码体系（分类区分落在人读消息中），测试复用 vitest + 本地 HTTP 假服务。

## Technical Context/技术上下文

**Language/Version**: TypeScript（strict 模式，ESM），运行于 Node.js ≥ 22 LTS（与 001 一致）。

**Primary Dependencies**: 无新增。沿用既有：`better-sqlite3` + `drizzle-orm`（存储）、`commander`（CLI）、`p-retry`（重试）、`@primno/dpapi`（凭据保护）、`vitest`（测试）。飞书令牌与消息接口均通过内置 `fetch` 封装（`postJson`）调用。

**Storage**: 无表结构变更——凭证仍是加密 JSON 列（`notification_channels.credentials_blob`），应用凭证作为飞书凭据的另一种模式变体存入同一列，沿用 `schemaVersion: 1`（纯可选新增，见 [data-model.md](data-model.md)）；访问令牌仅驻内存，不落盘。

**Testing**: `vitest`。适配器测试用本地 HTTP 假服务模拟令牌接口与消息接口（成功/凭证无效/缺权限/机器人不在会话/限流/网络故障）；CLI 契约测试断言 `--json` 输出与掩码规则；既有飞书 Webhook 测试保持全绿（回归门禁，SC-104）。

**Target Platform**: Windows 10+（优先）；macOS/Linux 兼容（无平台特定代码）。

**Project Type**: cli（既有本地常驻工具的渠道能力扩展）。

**Performance Goals**: 令牌缓存命中时，凭证渠道发送路径与 Webhook 渠道耗时同量级（无额外网络往返）；令牌过期时最多增加一次令牌接口往返（< 1 s，网络正常）。

**Constraints**: 凭据与令牌不得明文落盘/入日志（FR-106）；无需公网回调地址（纯出站调用）；开放平台接口限流按响应退避。

**Scale/Scope**: 单用户；新增/改动文件预计 ≤ 8 个（适配器、令牌模块、校验、CLI、契约、测试）；不触碰 `core/`、`hookserver/`、`mcp/`、`pollers/`。

## Constitution Check/宪法检查

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*
*门禁：Phase 0 调研前必须通过；Phase 1 设计后复查。*

| 原则 | 门禁问题 | 评估（设计前） | 评估（Phase 1 后复查） |
| --- | --- | --- | --- |
| I. 简单设计 | 是否存在无理由复杂度？ | PASS——零新增依赖；令牌缓存为单一内存 Map，不引入持久化令牌、不引入定时刷新器 | PASS——一个适配器文件 + 一个令牌模块，无投机抽象 |
| II. 测试先行 | 实现是否以测试驱动？ | PASS——令牌缓存与错误映射均为纯函数/可注入 fetch 的可测单元；假服务先行 | PASS——research R5 确定用例清单覆盖 FR-105 全部分类 |
| III. API 兼容性 | 对外接口是否受控演进？ | PASS——CLI 仅可选新增 `--mode/--app-id/...` 标志；凭据 schema 纯可选新增；契约见 [contracts/feishu-app-channel.md](contracts/feishu-app-channel.md) | PASS——五码错误体系不变，分类细化落在 message 层 |
| IV. 安全审查 | 敏感数据是否有显式审查？ | PASS——`app_secret` 走既有加密列与掩码管线；令牌不落盘 | PASS——data-model 安全要点 + 契约脱敏规则落实 |
| V. 代码审查 | 合入流程是否有门？ | PASS（流程级）——PR 须经非作者审查 | PASS |
| VI. 中英双语标题 | 产物标题是否双语？ | PASS——本计划及全部产物执行 | PASS |

无门禁违规，无需填写复杂度豁免表（Complexity Tracking 省略）。

## Project Structure/项目结构

### Documentation (this feature)/文档（本特性）

```text
specs/002-feishu-app-credential/
├── plan.md                    # This file (/speckit.plan command output)/本文件
├── research.md                # Phase 0 output/Phase 0 产物：接口调研与技术决策
├── data-model.md              # Phase 1 output/Phase 1 产物：凭据结构与令牌生命周期（增量）
├── quickstart.md              # Phase 1 output/Phase 1 产物：端到端验证指南
├── contracts/                 # Phase 1 output/Phase 1 产物：接口契约
│   └── feishu-app-channel.md  # 应用凭证通道契约（CLI 标志、凭据 JSON、错误映射）
└── tasks.md                   # Phase 2 output（/speckit.tasks command - NOT created by /speckit.plan）
```

### Source Code (repository root)/源代码（仓库根，仅列变更文件）

```text
src/
├── channels/
│   ├── adapter.ts             # 不改：postJson/classify* 原样复用
│   ├── feishu-token.ts        # 新增：tenant_access_token 获取与内存缓存（可注入 fetch）
│   ├── feishu.ts              # 扩展：按 credentials.mode 分派 webhook|app 两种发送路径
│   ├── channel-config.ts      # 扩展：feishu 分支校验 app 模式字段；summarizeCredentials 掩码 appId
│   └── index.ts               # 不改：getAdapter("feishu") 返回同一适配器实例
└── cli/
    └── channel.ts             # 扩展：feishu 新增 --mode/--app-id/--app-secret/--receive-id-type/--receive-id
tests/
├── unit/
│   ├── feishu-token.test.ts   # 新增：缓存命中/过期续取/凭证错误
│   └── channel-config.test.ts # 扩展：app 模式校验用例
└── integration/
    └── feishu-app.test.ts     # 新增：本地假服务端到端（FR-105 全分类 + Webhook 回归）
```

**Structure Decision/结构决策**: 沿用单仓库单包结构（001 既定），不新增目录。令牌管理独立为 `feishu-token.ts` 的理由：适配器需要"缓存命中则零往返、过期则自动续取并重试一次"的独立可测行为（SC-103），与消息发送解耦后各自可 TDD（宪法原则 II）；不做定时刷新器——按需续取即可满足，定时器属无理由复杂度（宪法原则 I）。
