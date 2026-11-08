# Implementation Plan/实施计划: Cross-Platform Message Hook Configuration/跨平台消息钩子配置

**Branch/分支**: `006-message-hook-config` | **Date/日期**: 2026-11-08 | **Spec/规格**: [spec.md](spec.md)

**Input/输入**: Feature specification from `specs/006-message-hook-config/spec.md`

## Summary/摘要

本功能为 NoticeTool 增加跨平台、跨智能体的钩子配置模板管理能力：内置 Linux、macOS、Windows 与 CodeBuddy、Claude Code、Codex CLI 的九种默认模板，每种模板具备“已启动/不启动”持久状态；用户可查看、启用、停用和验证模板，启用后复用既有任务结束事件管线完成端到端通知。技术方案上新增独立的钩子模板定义、配置适配与状态仓储，不改动现有通知正文模板与事件处理链路。

## Technical Context/技术上下文

**Language/Version/语言与版本**: TypeScript 5.9，Node.js >=22，ESM，严格模式。

**Primary Dependencies/主要依赖**: Commander（CLI）、Fastify（本地服务）、better-sqlite3 + Drizzle ORM（存储）、Vitest（测试）、p-retry（通知重试）。

**Storage/存储**: SQLite（`notice.db`）保存模板实例状态；内置模板定义以代码常量提供，不落库；用户自有配置仍为 `config.json`。

**Testing/测试**: Vitest，覆盖 unit、contract、integration 三层；沿用 `runCli()`、内存 SQLite、临时目录与假渠道适配器。

**Target Platform/目标平台**: Windows、macOS、Linux 桌面环境；单用户本地 CLI。

**Project Type/项目类型**: 本地 CLI + 本地服务。

**Performance Goals/性能目标**: 模板查看、启停与验证操作在本地环境 1 秒内返回；不引入常驻进程。

**Constraints/约束**: 离线可用；不得破坏既有 CLI 与数据格式；启用操作必须原子，失败不留半写入状态；错误与日志不得泄露敏感路径或凭据。

**Scale/Scope/规模与范围**: 九种内置模板（3 系统 × 3 智能体）；单一模板实例状态持久化；不新增智能体类型与通知渠道类型。

## Constitution Check/宪法检查

*GATE/门禁: Must pass before Phase 0 research. Re-check after Phase 1 design./必须在 Phase 0 调研前通过，并在 Phase 1 设计后复检。*

- **简单设计/通过**: 复用现有事件管线、通知模板与渠道分发；新增能力集中在模板定义、配置适配与状态仓储，不引入并行触发机制。
- **测试先行/通过**: 任务拆分将先编写 unit/contract/integration 测试，再实现功能；公开行为含边界与失败路径全覆盖。
- **API 兼容性/通过**: 仅新增 CLI 子命令与数据库表，不修改既有命令语义与数据格式；`--json` 与退出码约定保持不变。
- **安全审查/通过**: 模板不包含渠道凭据；写入目标前展示影响并确认；错误、日志与导出对路径和用户标识脱敏；冲突不静默覆盖。
- **代码审查把关/通过**: 计划产物进入实现后按项目流程提交非作者审查。
- **中英双语标题/通过**: 本计划及派生文档各级标题均采用“英文/中文”格式。

## Project Structure/项目结构

### Documentation (this feature)/文档（本功能）

```text
specs/006-message-hook-config/
├── plan.md              # This file/本文件
├── research.md          # Phase 0 output/Phase 0 产物
├── data-model.md        # Phase 1 output/Phase 1 产物
├── quickstart.md        # Phase 1 output/Phase 1 产物
├── contracts/           # Phase 1 output/Phase 1 产物
│   ├── cli-hook-config.md
│   └── hook-template-schema.md
└── tasks.md             # Phase 2 output/Phase 2 产物（由 /speckit.tasks 生成）
```

### Source Code (repository root)/源代码（仓库根目录）

```text
src/
├── hooks/
│   ├── default-templates.ts        # 9 种内置模板定义与版本
│   ├── codebuddy-config.ts          # CodeBuddy JSON 配置适配
│   ├── claude-code-config.ts        # Claude Code JSON 配置适配
│   ├── codex-config.ts              # Codex TOML 配置适配
│   ├── config-file-writer.ts        # 原子写入、失败恢复、路径脱敏
│   └── manager.ts                   # list/enable/disable/validate 编排
├── storage/
│   ├── schema.ts                    # 新增 hook_template_instances 表
│   └── hook-template-repository.ts # 模板实例状态仓储
├── cli/
│   ├── index.ts                     # 注册 hook-config 命令
│   └── hook-config.ts               # 模板查看、启停、验证 CLI
├── core/
│   ├── event-pipeline.ts            # 复用，不修改
│   ├── dedup.ts                     # 复用，不修改
│   └── dispatcher.ts                # 复用，不修改
└── pollers/
    └── ...                           # 复用，不修改

tests/
├── unit/
│   ├── hook-default-templates.test.ts
│   ├── hook-template-repository.test.ts
│   ├── hook-config-codebuddy.test.ts
│   ├── hook-config-claude-code.test.ts
│   ├── hook-config-codex.test.ts
│   └── hook-config-file-writer.test.ts
├── contract/
│   └── cli-hook-config.test.ts
└── integration/
    └── hook-config-flow.test.ts
```

**Structure Decision/结构决策**: 采用单项目结构，新增 `src/hooks/` 聚合模板与配置适配，新增 `hook-template-repository.ts` 管理实例状态；复用 `src/core/` 事件管线与 `src/cli/` 命令框架，不建立独立服务或并行调度器。

## Complexity Tracking/复杂度跟踪

> **Fill ONLY if Constitution Check has violations that must be justified/仅在宪法检查存在需说明的违规时填写**

无违规项。
