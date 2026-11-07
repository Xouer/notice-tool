# Implementation Plan/实施计划: C端AI任务对话框通知关联

**Branch**: `005-ai-task-dialog-link` | **Date**: 2026-11-07 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/005-ai-task-dialog-link/spec.md`

## Summary/概述

飞书通知链路已打通，缺口是 CodeBuddy、Claude Code、Codex CLI 三个C端AI对话框的任务结束事件源。调研确认（research.md）：CodeBuddy 支持 Stop 钩子（stdin JSON）、Codex CLI 支持 notify 钩子（argv JSON）且有 `~/.codex/sessions` 本地记录、Claude Code 已被现有巡检适配器覆盖。技术方案完全复用现有钩子入口、事件管线与巡检调度器：

1. `notice hook` 新增可选 `--source` 与 `--payload-argv` 参数（Codex notify 的 argv 传参方式）。
2. 新增 `codex-cli` 巡检适配器（仿 `claude-code`，读取 rollout JSONL）。
3. 编写三产品接入引导（quickstart.md），CodeBuddy IDE 不触发 Stop 时以 MCP 兜底并明示可靠性限制。

无新增常驻进程、无新 HTTP 端点、无数据库迁移。

## Technical Context/技术上下文

**Language/Version**: TypeScript ~5.9 / Node.js ≥22（ESM）

**Primary Dependencies**: commander（CLI）、Fastify（现有 HTTP 钩子，本功能不改动）、drizzle + better-sqlite3（现有存储，无 schema 变更）、vitest（测试）

**Storage**: 复用现有 SQLite（通知历史/去重记录），无新增表；读取外部产品本地文件（`~/.codex/sessions` JSONL、CodeBuddy transcript）为只读访问

**Testing**: Vitest（unit + integration，fixture 驱动）

**Target Platform**: Windows 桌面（win32，PowerShell；路径处理需跨平台兼容 `~` 展开）

**Project Type**: 本地常驻 CLI 工具（hook stdin/argv + polling scheduler）

**Performance Goals**: 钩子路径事件处理秒级完成；巡检路径延迟 ≤ 轮询间隔 + 30s（SC-005）；单次轮询仅读取会话文件尾部，避免全量扫描

**Constraints**: 仅回环/本地访问；通知正文 ≤2000 字符；对外接口仅可选新增（宪法 III）；TDD 不可协商（宪法 II）

**Scale/Scope**: 3 个产品来源、2 个代码改动点（CLI hook 参数、1 个新巡检适配器）、1 套接入文档

## Constitution Check/宪法检查

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| 原则 | 结论 | 说明 |
|------|------|------|
| I 简单设计 | 通过 | 复用现有钩子/巡检/MCP 机制，无并行新机制；备选方案否决理由见 research.md |
| II 测试先行 | 通过 | 实现顺序约束为先写映射/适配器测试（Red）再实现，见"测试策略"节 |
| III API 兼容性 | 通过 | 仅可选 CLI 参数与可选配置项新增；`trigger` 枚举与现有端点不变；无迁移 |
| IV 安全审查 | 通过 | 见"安全审查"节（敏感内容过滤、日志脱敏、只读访问） |
| V 代码审查 | 通过 | 合入前需非作者审查，审查含双语格式与宪法合规检查 |
| VI 中英双语标题 | 通过 | spec/plan/research/data-model/contracts/quickstart/checklist 标题已统一双语 |

**Phase 1 复检**：设计产物（data-model、contracts、quickstart）未引入新复杂度与破坏性变更，上述结论维持。

## Security Review/安全审查（宪法 IV 必需）

- **数据类型**：任务标识（session/thread id）、结果摘要（可能含代码片段或对话内容）、本地文件路径；无新增凭据。
- **信任边界**：外部产品（CodeBuddy/Codex）→ 本地 `notice` 进程为唯一新增边界；输入一律视为不可信，JSON 解析失败即拒绝且错误信息不携带原始负载。
- **访问主体与授权**：全部为当前本地用户上下文；对外部会话记录只读，不修改、不删除；HTTP 钩子仍仅绑回环地址（无变更）。
- **最小权限**：Codex 巡检仅读取 `sessionsDir` 内文件尾部；不递归扫描其他目录。
- **敏感数据处理**：`result_summary` 进入模板前经现有敏感信息过滤（FR-010）；日志仅记录任务标识与状态，脱敏后不记录摘要正文；测试 fixture 使用虚构数据（宪法安全要求）。
- **失效与撤销**：用户移除 hooks/notify 配置或停用巡检适配器即撤销接入，无残留权限。

## Test Strategy/测试策略（宪法 II：先 Red 后 Green）

1. **单元测试（先行编写）**：
   - CodeBuddy stdin 负载 → `TaskEndEvent` 映射（含缺字段默认值、缺 `session_id` 拒绝路径）。
   - Codex argv 负载解析：`--payload-argv` 读取、非 `agent-turn-complete` 静默忽略、JSON 损坏退出码与脱敏错误。
   - `codex-cli` 巡检适配器：以虚构 fixture JSONL 覆盖状态迁移检测、启动基线补检、文件损坏跳过。
   - 跨触发源去重：同一 `source_agent+task_id` 的 hook 与 polling 事件仅通知一次。
2. **集成测试**：模拟 Codex notify 调用 CLI → 事件管线 → 渠道分发（渠道 adapter mock），断言历史记录 `source_agent/trigger` 正确。
3. **验收测试**：按 quickstart.md 在三个产品各完成一个真实任务，核对 SC-001~SC-006。
4. 全部测试通过、lint/format 通过后方可进入审查合入。

## Project Structure/项目结构

### Documentation (this feature)/文档（本功能）

```text
specs/005-ai-task-dialog-link/
├── plan.md              # 本文件（/speckit.plan 输出）
├── research.md          # Phase 0：三产品接入方式调研结论
├── data-model.md        # Phase 1：来源标识/事件映射/配置扩展
├── quickstart.md        # Phase 1：三产品接入引导（FR-008）
├── contracts/
│   └── dialog-source-integration.md  # Phase 1：钩子与巡检适配器契约
├── checklists/
│   └── requirements.md  # 规格质量检查清单（18/18 通过）
└── tasks.md             # Phase 2 输出（/speckit.tasks，不在本阶段创建）
```

### Source Code (repository root)/源代码（仓库根目录）

```text
src/
├── cli/
│   └── hook.ts              # 修改：新增可选 --source / --payload-argv 参数
├── pollers/
│   ├── adapter.ts           # 复用：AgentStatusAdapter 接口（不变）
│   ├── claude-code.ts       # 复用：现有适配器（不变）
│   ├── codex-cli.ts         # 新增：Codex rollout JSONL 巡检适配器
│   └── scheduler.ts         # 复用：调度与基线补检（不变）
├── core/                    # 复用：event-pipeline / dedup / sensitive-filter（不变）
└── config/                  # 修改：polling.adapters 增加可选 codex-cli 配置校验

tests/
├── unit/
│   ├── hook-source-mapping.test.ts   # 新增：CodeBuddy/Codex 负载映射
│   └── poller-codex-cli.test.ts      # 新增：适配器状态迁移/补检/损坏跳过
└── integration/
    └── codex-notify-flow.test.ts     # 新增：argv 钩子到分发的端到端（渠道 mock）
```

**Structure Decision**: 单项目 CLI 结构，沿用现有 `src/cli`、`src/pollers`、`src/core` 分层；新增代码仅 1 个适配器文件与 CLI 参数扩展，测试镜像现有 unit/integration 布局。

## Complexity Tracking/复杂度记录

无宪法违规项，无需复杂度豁免。
