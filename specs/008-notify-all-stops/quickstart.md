# Quickstart/快速验证指南: Notify All Conversation Stops/所有对话停止事件均通知

**Date/日期**: 2026-11-08 | **Spec/规格**: [spec.md](spec.md) | **Plan/计划**: [plan.md](plan.md)

本指南用于实现完成后验证“实际 Stop 必通知、不同 Stop 不合并、同一 Stop 不重复”。接口细节见 [contracts/stop-notification.md](contracts/stop-notification.md)，事件字段见 [data-model.md](data-model.md)。

## Prerequisites/前置条件

- Node.js >= 22，依赖已安装，当前目录为仓库根目录。
- 至少一个通知渠道已配置并通过 `notice channel test <name>`。
- 真实智能体验证前，已按现有指南启用对应 Stop 钩子；Claude/Codex 巡查验证需启用既有适配器。
- 自动化测试和手动负载全部使用虚构数据，真实转录不得复制到测试目录或文档。

## Setup/构建与测试准备

```text
npm ci
npm run build
```

如需隔离手动验证数据，设置 `NOTICE_DATA_DIR` 指向一个新的临时目录，并使用该环境初始化渠道。不要对日常通知数据库执行验证性清理。

## Scenario A: Regression Tests First/场景 A：回归测试先行

实现前先加入并运行以下定向测试：

```text
npm test -- tests/unit/dedup.test.ts tests/unit/hook-source-mapping.test.ts
npm test -- tests/integration/notify-flow.test.ts tests/integration/polling-flow.test.ts tests/integration/codex-notify-flow.test.ts
npm test -- tests/contract/cli-history.test.ts
```

**Expected before implementation/实现前预期**: 新增的“同会话不同 Stop 各自通知”“持续结束态出现新事件键”“事件级历史可见”等测试失败，且失败原因是旧行为而非夹具错误，形成 Red 证据。

**Expected after implementation/实现后预期**: 上述测试全部通过，再进入完整验证。

## Scenario B: Single-Turn Stop Notification/场景 B：单轮 Stop 通知

1. 在 CodeBuddy 当前对话中发起一次只需简短回答的问题，保持对话窗口打开。
2. 等待回答结束并实际触发 `Stop`。
3. 观察已启用通知渠道与事件历史：

```text
notice history events --limit 10
notice history --limit 10
```

**Expected/预期结果**:

- 收到一轮通知，事件来源为 `codebuddy`、触发方式为 `hook`。
- 对话窗口未关闭或切换不影响通知。
- 事件历史可看到 `received` 或 `dispatched`，渠道历史可看到实际 `sent/failed`。
- 只保持窗口打开但未触发 Stop 时，不新增通知。

## Scenario C: Consecutive Stops in One Conversation/场景 C：同一对话连续 Stop

1. 沿用场景 B 的同一对话，再连续进行 9 次简短问答，每次等待实际 Stop 后再继续。
2. 查看渠道消息数量和事件历史。
3. 对多步骤成功、失败或中断任务各执行至少一次回归验证。

**Expected/预期结果**:

- 10 次不同 Stop 恰好形成 10 轮通知，不因 `taskId` 相同而漏发。
- 多步骤任务保持原通知行为；事件提供结果状态时，展示与实际一致。
- 每轮通知仍按现有配置投递到全部已启用渠道。

## Scenario D: Duplicate Stop Dedup/场景 D：重复 Stop 去重

使用带稳定事件键的标准负载手动验证。以下 PowerShell 示例将同一负载发送两次，再发送一个同会话新事件键：

```powershell
$first = '{"schemaVersion":1,"source":"demo","taskId":"session-demo-001","eventKey":"stop-demo-001","result":"success","resultSummary":"虚构单轮问答结束"}'
$second = '{"schemaVersion":1,"source":"demo","taskId":"session-demo-001","eventKey":"stop-demo-002","result":"success","resultSummary":"虚构第二次问答结束"}'
$first | notice hook
$first | notice hook
$second | notice hook
notice history events --limit 10
notice history --limit 10
```

**Expected/预期结果**:

- `stop-demo-001` 第二次返回 `deduplicated=true`，不新增通知记录，事件历史保留一条新的 `duplicated` 记录。
- `stop-demo-002` 虽然任务标识相同，仍返回 `deduplicated=false` 并产生新一轮通知。
- 总计两轮通知，重复提示不再声称仅因“冷却窗口内”而判重。

## Scenario E: Optional Metadata and Failure Paths/场景 E：可选元数据与失败路径

1. 在来源映射测试中使用缺少 `session_id`、摘要和结果的虚构 Stop，确认仍以 `unknown-session` 和默认结果受理。
2. 使用空白或超长显式 `eventKey`，确认返回 `VALIDATION_FAILED`，不写入有效事件。
3. 临时使用无效测试渠道发送一个稳定键事件，随后执行：

```text
notice history events --status dispatched
notice history --status failed
```

**Expected/预期结果**: 可选元数据缺失不导致漏报；非法显式事件键整体拒绝；渠道失败记录准确且不被写成 `sent`，错误输出不包含凭据、完整路径或原始对话。

## Scenario F: Polling and Cross-Trigger Dedup/场景 F：巡查与跨触发去重

1. 使用虚构 Claude `result` 或 Codex `turn_complete` 记录运行对应单元与集成测试。
2. 在同一 fixture 中追加一个具有新事件键的终态记录，保持任务状态仍为完成。
3. 让同一稳定键分别经钩子与巡查进入管线。

**Expected/预期结果**:

- 相同终态键的重复扫描不重复上报。
- 新终态键即使处于连续结束态也会上报并通知。
- 同一稳定键跨钩子和巡查只形成一轮通知，重复路径在事件历史中显示 `duplicated`。

## Scenario G: Legacy Compatibility and Migration/场景 G：旧调用与迁移兼容

1. 用不含 `eventKey` 的旧 `schemaVersion: 1` 负载连续发送两次，确认原冷却去重行为不变。
2. 在升级前数据库副本上执行新版本初始化，确认新增可空列和索引，旧事件仍可查询。
3. 验证现有 `notice history --json` 仍返回 `records`，新增 `notice history events --json` 返回 `events`。

**Expected/预期结果**: 旧 CLI、HTTP、MCP 调用和通知历史结构无破坏；数据库升级不修改旧事件内容，新旧去重分支互不误合并。

## Full Quality Gates/完整质量关卡

```text
npm test
npm run build
npm run lint
npm run format:check
npm run build
node scripts/perf-check.mjs
```

**Expected/预期结果**: 全部命令退出码为 0；性能不明显回退。随后完成 SC-001 至 SC-008 核对、安全抽查和非作者代码审查。

## Troubleshooting/排查

- **第二次问答未通知**: 先比较事件历史中的事件键；若键相同，检查来源终态记录解析，若未出现第二条事件，检查钩子或巡查接入。
- **同一 Stop 重复通知**: 检查两条事件是否具备相同稳定键、来源是否一致；无稳定身份的降级受理只保证不漏发，并应出现脱敏警告。
- **历史只有 duplicated**: 查找同一稳定键的首次事件及其渠道记录；`dispatched` 不代表每个渠道都成功。
- **无可用渠道**: 事件可保持 `received` 且无通知记录，按提示配置渠道；不要将其误判为发送成功。
