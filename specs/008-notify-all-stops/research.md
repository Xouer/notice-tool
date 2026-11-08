# Research/技术调研: Notify All Conversation Stops/所有对话停止事件均通知

**Date/日期**: 2026-11-08 | **Feature/特性**: [spec.md](spec.md) | **Plan/计划**: [plan.md](plan.md)

## Research Summary/调研结论

当前代码不存在“单轮问答”分类器，也不读取对话窗口状态。实际漏报根因是 CodeBuddy、Claude Code 和 Codex CLI 将会话级标识映射为 `taskId`，共享去重又以 `sourceAgent + taskId + 冷却窗口` 判重，导致同一会话后续的合法 `Stop` 被误合并。修复重点不是删除一个单轮判断，而是为每次停止建立独立、可跨触发源复用的事件身份。

## R1: Root Cause/根因确认

**Decision/决定**: 保留现有统一通知管线，修复事件身份与去重粒度，不新增任务复杂度分类。

**Rationale/理由**:

- `src/cli/hook.ts` 将 `session_id` 或 `thread-id` 映射为 `taskId`，没有步骤数或单轮过滤。
- `src/core/dedup.ts` 只按 `sourceAgent + taskId` 查询冷却窗口内事件；`src/core/event-pipeline.ts` 命中后只写入 `duplicated`，不分发。
- 因此首次 `Stop` 可以通知，同一会话后续 `Stop` 会在默认 10 分钟内被抑制，与是否单轮无关。

**Alternatives considered/备选方案**:

- 新增“单轮问答”判断并删除：没有对应实现，无法解决实际根因。
- 完全关闭去重或把冷却时间设为零：会造成重复投递和钩子/巡查双通知，拒绝。

## R2: Stop-Level Identity/停止级事件身份

**Decision/决定**: 在现有 `schemaVersion: 1` 事件负载中增加可选 `eventKey`，表示来源侧一次确定的完成事件；`taskId` 继续表示对话或任务上下文，不再独自承担事件幂等身份。

**Rationale/理由**:

- 可选字段符合既有“新增字段可选”的兼容策略，旧 CLI、HTTP 和 MCP 调用不需要同步修改。
- 有 `eventKey` 时，以 `(sourceAgent, taskId, eventKey)` 判重；同键跨钩子与巡查只通知一轮，不同键即使同属一个会话也分别通知。
- `eventKey` 只保存不透明标识或散列，不保存完整转录路径、对话正文或原始负载。

**Alternatives considered/备选方案**:

- 将 `finishedAt` 拼入旧去重键：缺省时间在每次接收时重新生成，且钩子与巡查观察时间可能不同，无法稳定判重。
- 使用内部随机 `eventId`：每次受理都会变化，不能识别重复上报。
- 直接修改 `taskId` 为 turn ID：会破坏通知模板、历史关联和“任务/会话标识”的既有含义，拒绝。

## R3: Source Identity Resolution/来源事件身份解析

**Decision/决定**: 按“显式事件标识 → 来源终态记录标识 → 降级受理”的顺序生成 `eventKey`，优先保证不漏掉真实 `Stop`。

**Rationale/理由**:

1. 调用方显式提供 `eventKey`，或来源负载提供稳定 stop/turn/event ID 时，直接使用其命名空间化散列。
2. CodeBuddy/Claude Code 有 `transcript_path` 时，读取既有本地转录的终态记录，以记录 UUID、时间戳或稳定偏移结合会话标识生成散列；Claude 与 Codex 巡查适配器复用各自已经解析的终态记录身份。
3. Codex 优先使用 turn/event ID；缺失时使用匹配 rollout 中 `turn_complete` 的记录身份，使 notify 与巡查指向同一事件。
4. 如果来源既无稳定 ID 也无可用终态记录，信息上无法可靠区分“相同负载的新 Stop”和“同一 Stop 的重报”。此时以来源映射接收次数生成新键并记录降级警告，优先满足 P1 的“不漏通知”；只有具备稳定事件身份时才承诺精确去重。

**Alternatives considered/备选方案**:

- 无稳定 ID 时按原始内容散列并冷却去重：连续两次相同问答仍会被误合并，违背 P1。
- 无稳定 ID 时拒绝事件：违背可选信息缺失仍通知的要求。
- 引入模糊时间窗口猜测新旧事件：同时存在漏报和重复风险，且行为难以解释，拒绝。

## R4: Optional Metadata/可选元数据处理

**Decision/决定**: 来源映射器在缺少会话标识时使用安全的 `unknown-session` 占位，并继续通过独立 `eventKey` 受理；通用标准事件的 `taskId` 必填契约保持不变。

**Rationale/理由**:

- 当前 `src/cli/hook.ts` 会因缺少 `session_id` 或 `thread-id` 拒绝事件，与 FR-007 不一致。
- 占位避免把本机路径或用户内容写入通知，同时事件级键仍可区分不同停止。
- 不改变既有通用 API 的必填字段，降低兼容影响。

**Alternatives considered/备选方案**:

- 全面放宽通用事件的 `taskId`：影响所有调用方和历史关联，超出本次必要范围。
- 使用完整转录路径作为任务标识：可能泄露本机用户名和目录，拒绝。

## R5: Persistence and Dedup/持久化与去重

**Decision/决定**: 通过 Drizzle 版本化迁移为 `task_events` 增加可空 `event_key` 及复合索引；有键事件按保留期内的稳定键判重，无键旧调用沿用原冷却窗口语义。

**Rationale/理由**:

- 可空列让旧数据库行无需回填，旧无键事件与新有键事件互不误判。
- 新索引为 `(source_agent, task_id, event_key, received_at)`；稳定键判重不再因 10 分钟冷却结束而重复通知，仍受现有 30 天历史保留边界约束。
- 去重检查与首次事件写入需要在同一同步存储事务中完成，避免并发重复投递都通过“先查再插”。重复上报仍写 `duplicated` 历史，因此不设置阻止重复历史行的唯一约束。

**Alternatives considered/备选方案**:

- 新建独立幂等表：可以支持唯一约束，但增加实体与同步复杂度，当前事务方案已足够。
- 保留旧 `(source_agent, task_id, received_at)` 索引作为唯一去重依据：无法区分连续 Stop，拒绝。

## R6: Polling Continuity/巡查连续完成

**Decision/决定**: 为 `AgentTask` 增加可选 `eventKey`，巡查调度器以“终态事件身份是否变化”识别新完成，而非只看“非结束态 → 结束态”。

**Rationale/理由**:

- 当前 `src/pollers/scheduler.ts` 只保存任务状态，同一任务持续处于结束态时不会上报新完成。
- Claude 的每个 `result` 记录和 Codex 的每个 `turn_complete` 记录可提供不同事件键；新键应触发受理，相同键继续由共享去重抑制。
- 启动基线补检仍沿用冷却窗口，其他巡查配置和错误处理不变。

**Alternatives considered/备选方案**:

- 仅修改共享去重：巡查层仍会提前吞掉连续结束事件，无法完整修复。
- 每轮扫描都上报：会放大重复历史与处理量，没有必要。

## R7: Event History/事件级历史

**Decision/决定**: 新增 `notice history events` 只读子命令，保留现有 `notice history` 的渠道通知记录视图。

**Rationale/理由**:

- 当前 `src/cli/history.ts` 仅从 `notification_records` 查询，`received` 无渠道事件和 `duplicated` 事件不可见。
- 新视图展示事件来源、任务标识、事件键摘要、触发方式、接收时间和 `received/duplicated/dispatched` 状态，满足排查需求。
- 使用子命令而非改变现有输出字段，保持脚本兼容。

**Alternatives considered/备选方案**:

- 直接改变 `notice history` 默认输出：会混淆通知记录与事件记录，并可能破坏现有使用方式。
- 不增加事件视图：数据库虽有记录但用户无法排查，不满足 FR-009。

## R8: Source Mapping Correction/来源映射修正

**Decision/决定**: 将 Claude Code 映射函数显式接收并保留 `source=claude-code`，不再复用硬编码为 `codebuddy` 的输出。

**Rationale/理由**:

- 当前共用映射把 Claude 钩子写成 `codebuddy`，会破坏来源展示和钩子/巡查跨入口去重。
- 共用字段解析仍可保留，仅将来源作为参数传入，属于最小修正。

**Alternatives considered/备选方案**: 完整复制一套 Claude 映射函数，重复代码且无必要。

## R9: Security Review/安全审查

**Decision/决定**: 延续本地最小权限和脱敏策略，事件身份解析只读取必要转录尾部，不新增敏感内容持久化。

**Rationale/理由**:

- 信任边界仍为当前本机用户、已接入智能体和本地 NoticeTool；HTTP 继续仅绑定回环地址。
- 转录路径仅用于定位来源事件；持久化的 `eventKey` 使用散列，日志和错误信息不得输出完整路径、转录正文或凭据。
- 文件读取复用现有尾部大小限制和错误跳过策略；测试只使用虚构路径、会话与消息。
- 数据仍仅存本地 SQLite，保留与清除沿用 30 天策略；停用钩子或渠道即可撤销后续通知。

**Alternatives considered/备选方案**: 为排查保存完整原始负载或转录片段，泄露风险大于收益，拒绝。

## R10: Validation Strategy/验证策略

**Decision/决定**: 严格按 Red-Green-Refactor，先增加公开行为回归测试并确认旧实现失败，再实施最小修改。

**Rationale/理由**:

- `tests/unit/dedup.test.ts`：同键判重、同会话不同键放行、无键旧行为兼容。
- `tests/unit/hook-source-mapping.test.ts`：三来源稳定键、缺省元数据、Claude 来源和降级行为。
- `tests/integration/notify-flow.test.ts`：单轮与多步骤、连续 Stop、重复上报、失败记录。
- `tests/integration/polling-flow.test.ts` 与 `tests/integration/codex-notify-flow.test.ts`：连续终态和跨入口去重。
- `tests/contract/cli-history.test.ts`：事件级历史可见且输出脱敏。
- 真实 CodeBuddy/Claude/Codex 手动验证保持当前对话打开，覆盖连续单轮问答。

**Alternatives considered/备选方案**: 只测试映射函数不足以证明通知实际分发；只手工测试则无法防止去重语义回归。

## Documentation Updates/文档同步范围

- 更新 `README.md`、`specs/005-ai-task-dialog-link/quickstart.md`、`specs/006-message-hook-config/quickstart.md` 的触发与去重说明。
- 将 `specs/005-ai-task-dialog-link/spec.md`、`specs/006-message-hook-config/spec.md` 中旧的单轮排除规则标记为由本特性取代，并同步相关数据模型和契约。
- 更新 `specs/001-agent-task-notify/quickstart.md` 等仍以“相同 taskId 即重复”为例的说明，区分无键旧契约与有键 Stop 契约。

## Unresolved Questions/未解决问题

无。技术栈、迁移方式、兼容策略、测试位置和安全边界均已确定；无稳定来源标识时的降级策略已在 R3 明确，不需要阻塞规划。
