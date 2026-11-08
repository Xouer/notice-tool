# Implementation Plan/实施计划: Notify All Conversation Stops/所有对话停止事件均通知

**Branch/分支**: `008-notify-all-stops` | **Date/日期**: 2026-11-08 | **Spec/规格**: [spec.md](spec.md)

**Input/输入**: Feature specification from `/specs/008-notify-all-stops/spec.md`

## Summary/概述

修复同一会话后续 `Stop` 被会话级去重误抑制的问题，使单轮问答和多步骤任务只要实际触发 `Stop` 就进入现有通知管线。方案为事件负载增加可选 `eventKey`，以来源稳定事件或终态记录标识区分每次停止；有键事件按 `(sourceAgent, taskId, eventKey)` 跨钩子与巡查去重，无键旧调用保持原冷却行为。同步调整巡查连续终态识别、增加事件级历史视图并更新旧文档，不新增通知渠道、模板或单轮过滤开关。

## Technical Context/技术上下文

**Language/Version/语言与版本**: TypeScript 5.9，Node.js >= 22，ESM/NodeNext，严格模式

**Primary Dependencies/主要依赖**: Commander、Fastify、MCP SDK、Drizzle ORM、better-sqlite3、p-retry；不新增第三方依赖

**Storage/存储**: 本地 SQLite `notice.db`；通过 Drizzle 版本化迁移为 `task_events` 增加可空 `event_key` 与复合索引

**Testing/测试**: Vitest 5 单元、契约、集成测试；真实 CodeBuddy、Claude Code、Codex CLI 手动端到端验证

**Target Platform/目标平台**: Windows 为主要验证环境，Linux/macOS 保持既有钩子模板与本地存储兼容

**Project Type/项目类型**: 本地 CLI、回环 HTTP 服务与 MCP 工具组成的单项目

**Performance Goals/性能目标**: 去重查询走复合索引，不为每次事件读取完整转录；在接入、工具和渠道可用时，至少 95% 的 `Stop` 在到达后 30 秒内送达至少一个已启用渠道

**Constraints/约束**: `schemaVersion: 1` 与既有 CLI/HTTP/MCP 调用向后兼容；测试先行；不持久化完整转录路径或对话正文；保留现有 30 天历史策略、渠道重试和启停含义

**Scale/Scope/规模与范围**: 三类智能体、三个桌面平台；验证同一会话连续 20 次单轮 Stop、10 次重复上报、钩子与巡查跨来源去重

## Constitution Check/宪法检查

*GATE/关卡：Phase 0 前与 Phase 1 后均须通过。*

| Principle/原则 | Pre-design/设计前 | Post-design/设计后 | Evidence/依据 |
|---|---|---|---|
| I. Simple Design/简单设计 | PASS | PASS | 复用统一管线、存储和适配器，仅增加一个可选事件字段、索引及必要历史视图，无新服务或依赖 |
| II. Test-First/测试先行 | PASS | PASS | 先写同会话连续 Stop、重复上报和连续巡查终态测试并确认 Red，再实现 Green |
| III. API Compatibility/API 兼容性 | PASS | PASS | `eventKey` 可选；旧无键调用保留原语义；数据库仅新增可空列和索引；现有 `notice history` 输出不变 |
| IV. Security Review/安全审查 | PASS | PASS | 已明确信任边界、尾部读取限制、散列事件键、日志脱敏、本地保留和撤销方式 |
| V. Code Review/代码审查 | PASS | PASS | 实现后仍需至少一名非作者审查，本计划不豁免审查门 |
| VI. Bilingual Headings/双语标题 | PASS | PASS | 本特性 plan、research、data-model、contracts、quickstart 均使用英文/中文双语标题 |

**Gate Result/关卡结论**: PASS；无需要复杂度豁免的违规行为。

## Project Structure/项目结构

### Documentation/文档（本特性）

```text
specs/008-notify-all-stops/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── contracts/
│   └── stop-notification.md
├── quickstart.md
└── checklists/
    └── requirements.md
```

### Source Code/源代码（仓库根目录）

```text
src/
├── cli/
│   ├── hook.ts                  # 来源映射、eventKey 提取与降级受理
│   └── history.ts               # 新增 history events 只读视图
├── core/
│   ├── event-pipeline.ts        # 可选 eventKey 校验、事务化受理
│   ├── dedup.ts                 # Stop 级判重与旧无键兼容
│   └── dispatcher.ts            # 复用，不改变渠道分发语义
├── pollers/
│   ├── adapter.ts               # AgentTask 可选 eventKey
│   ├── scheduler.ts             # 识别新的终态事件键
│   ├── claude-code.ts           # result 记录事件身份
│   └── codex-cli.ts             # turn_complete 记录事件身份
└── storage/
    └── schema.ts                # task_events.event_key 与索引

drizzle/                         # 新增一份版本化迁移及快照
tests/
├── unit/                        # 去重、来源映射、巡查解析
├── contract/                    # 负载兼容与事件历史 CLI
├── integration/                 # 连续 Stop、跨入口去重、失败重试
└── fixtures/dialog-sources/     # 虚构的稳定事件与转录样本
```

**Structure Decision/结构决策**: 保持现有单项目布局，在既有钩子、管线、巡查和历史模块内做最小修改；不新增平行通知链路或独立子项目。

## Implementation Phases/实施阶段

### Phase 1: Regression Tests First/阶段一：回归测试先行

1. 在 `tests/unit/dedup.test.ts` 固化新语义：相同事件键判重，同 `source + taskId` 不同事件键不得判重，无键事件保留旧冷却行为。
2. 在来源映射测试中增加单轮负载、缺少可选标识、稳定事件键、Claude 来源正确性和无稳定身份降级场景。
3. 在通知集成测试中增加同一会话连续两个 Stop、第二个 Stop 重复上报、失败渠道历史；在巡查测试中增加“持续结束态但事件键变化”。
4. 运行定向测试并记录旧实现失败（Red），确认失败原因正是会话级误去重或缺失事件身份，而非测试夹具错误。

### Phase 2: Event Identity and Dedup/阶段二：事件身份与去重

1. 在 `NormalizedEvent` 和 `schemaVersion: 1` 校验中增加可选 `eventKey`，限制长度与字符，拒绝非法值但不改变其他字段规则。
2. 新增 Drizzle 可空 `event_key` 列及 `(source_agent, task_id, event_key, received_at)` 索引；验证全新初始化与既有数据库升级。
3. 将稳定键判重与旧无键冷却判重分支封装在现有 `dedup.ts`，稳定键在现有历史保留期内判重，不使用接收时间生成身份。
4. 在现有同步存储事务中完成“判重检查 + 首次事件写入”，重复事件继续记录 `duplicated`，渠道分发、模板和重试保持不变。

### Phase 3: Source and Polling Integration/阶段三：来源与巡查接入

1. CodeBuddy/Claude/Codex 映射优先使用显式事件 ID，其次使用本地终态记录身份生成散列事件键；缺少会话 ID 时使用 `unknown-session`，缺少摘要或状态仍走默认值。
2. 对无法获得任何稳定身份的来源事件按接收次数生成新键并输出脱敏降级警告，优先避免漏发；不得将完整路径或正文写入键、日志或错误。
3. 修正 Claude Code 钩子来源硬编码，确保 `source=claude-code`。
4. 为 `AgentTask` 增加可选事件键；巡查仅在发现新的终态事件键或符合既有启动补检条件时上报，同一终态键不重复扫描上报。

### Phase 4: Observability and Documentation/阶段四：可观测性与文档

1. 增加 `notice history events [--limit N] [--status received|duplicated|dispatched]`，显示事件级处理状态；现有 `notice history` 与 `resend` 保持不变。
2. 更新重复事件的 CLI 文案，不再把所有稳定键重复都描述为“冷却窗口内”。
3. 更新 README、005/006 接入指南、相关数据模型和契约，移除现行“单轮问答不通知”与“相同 taskId 必重复”的旧口径。
4. 使用虚构数据验证事件历史、错误、日志和通知不包含凭据、完整转录路径或新增对话正文。

### Phase 5: Verification/阶段五：验证

1. 运行定向测试、完整 `npm test`、`npm run build`、`npm run lint`、`npm run format:check`。
2. 按 `quickstart.md` 执行同一当前对话连续单轮、重复事件、跨入口去重、缺省字段和失败渠道验证。
3. 核对 SC-001 至 SC-008，完成安全审查、兼容性检查和非作者代码审查后再合入。

## Security Review/安全审查

- **Trust boundary/信任边界**: 当前本机用户、智能体本地钩子/转录与 NoticeTool；外部 HTTP 仍仅回环，事件身份不扩大 MCP 或 HTTP 权限。
- **Least privilege/最小权限**: 只读取解析事件身份所需的既有转录尾部，不遍历无关目录，不新增远程同步。
- **Validation/输入校验**: `eventKey` 可选但须为非空有界字符串；非法显式值整体拒绝，来源缺失值按 R3 降级而非伪造稳定身份。
- **Sensitive data/敏感数据**: 事件键持久化不透明散列；完整转录路径、正文、凭据不得进入通知、日志、错误或测试夹具。
- **Storage and retention/存储与留存**: 仅新增本地事件键列，沿用现有 30 天清理；旧行保持为空，不做包含敏感内容的回填。
- **Revocation/撤销**: 现有钩子模板与渠道停用方式不变，停用后不再产生后续通知，历史仍按既有策略保留和清除。

## Compatibility Impact/兼容性影响

- **Event payload/事件负载**: 新增可选字段，无破坏性版本变更；旧无键 CLI/HTTP/MCP 事件维持原冷却去重。
- **Persistent data/持久化数据**: 新增可空列和索引，需要版本化迁移；不删除或重解释旧字段。
- **CLI/命令行**: 新增只读子命令；既有 `notice history` 参数和 JSON 结构不变，重复提示文案仅更准确。
- **Behavior/行为**: 已接入来源的单轮 Stop 默认开始通知，这是用户明确要求的行为变化；连续不同事件不再被同一会话 ID 抑制。
- **Known limit/已知边界**: 来源完全不提供稳定事件身份时，无法数学上同时识别内容相同的新事件与重报；按 P1 优先选择降级受理并告警，稳定键场景仍严格去重。

## Risks and Mitigations/风险与缓解

| Risk/风险 | Mitigation/缓解 |
|---|---|
| 钩子触发时终态记录尚未落盘 | 优先显式事件 ID；解析失败按降级策略受理并告警，不阻塞通知；真实智能体手动验证 |
| 新旧来源记录格式差异 | 使用虚构夹具覆盖 UUID、时间戳和偏移回退；解析失败不泄露路径或正文 |
| 并发重复投递竞态 | 将判重与首次写入置于同一同步存储事务，增加并发集成测试 |
| 旧数据库升级失败 | 可空 additive 迁移，分别验证旧库升级与全新初始化，不修改旧行 |
| 单轮通知量增加 | 遵循用户要求每 Stop 通知，不新增复杂度过滤；稳定键去重防止重复风暴 |
