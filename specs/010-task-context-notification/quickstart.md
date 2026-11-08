# Quickstart/快速验证指南: Task Context Notification/任务上下文通知

**Date/日期**: 2026-11-08 | **Spec/规格**: [spec.md](spec.md) | **Plan/计划**: [plan.md](plan.md)

本指南用于实现完成后验证「通知能识别具体任务」。接口细节见 [contracts/task-context.md](contracts/task-context.md)，字段与提取规则见 [data-model.md](data-model.md)。

## Prerequisites/前置条件

- Node.js ≥ 22，依赖已安装，当前目录为仓库根目录。
- 至少一个通知渠道已配置并通过 `notice channel test <name>`。
- 自动化测试与手动负载一律使用**虚构数据**；不得将真实转录复制到测试目录或文档。

## Setup/构建与测试准备

```text
npm ci
npm run build
```

## Scenario A: Field Recognition Regression/场景 A：字段识别回归测试

实现前先加入并运行以下定向测试（预期实现前失败、实现后通过，形成 Red→Green 证据）：

```text
npm test -- tests/unit/transcript-title.test.ts tests/unit/notification-content.test.ts
npm test -- tests/contract/notification-content.test.ts
npm test -- tests/integration/notify-content.test.ts
```

**Expected/预期结果**: 实现前「`ai-title` 记录的 `aiTitle` 字段」「`summary` 记录的 `summary` 字段」提取用例失败；实现后全部通过。

## Scenario B: Manual Simulation with Transcript Path/场景 B：带转录路径手动模拟

1. 构造一个虚构转录文件（JSONL，含 `ai-title`、`summary` 与 assistant 结论记录）：

```text
{"type":"ai-title","aiTitle":"修复登录页样式问题","sessionId":"sess-demo-001","cwd":"c:/tmp"}
{"type":"summary","summary":"帮我修复登录页样式","providerData":{"source":"initial-user-message"},"sessionId":"sess-demo-001"}
{"type":"message","role":"assistant","content":[{"type":"output_text","text":"已修复样式，更新了 3 个文件并通过测试"}],"status":"complete","sessionId":"sess-demo-001"}
```

2. 以带 `transcript_path` 的负载调用钩子（PowerShell 示例，路径按需替换）：

```powershell
'{"schemaVersion":1,"source":"codebuddy","taskId":"sess-demo-001","eventKey":"stop-ctx-001","result":"success","transcript_path":"C:/tmp/transcript-demo.jsonl"}' | notice hook --source codebuddy
```

3. 查看通知与历史：

```text
notice history --limit 10
notice history events --limit 10
```

**Expected/预期结果**:

- 通知标题为 `修复登录页样式问题`（取自 `aiTitle`），而非 `codebuddy · sess-de`。
- 概要为 `已修复样式，更新了 3 个文件并通过测试`（取自任务结论），而非仅「任务成功完成」。
- 事件历史来源 `codebuddy`、触发方式 `hook`；渠道历史为 `sent`。

## Scenario C: Fallback Chain/场景 C：兜底链路

1. 使用**无** `transcript_path`、**无**标题与概要的负载：

```powershell
'{"schemaVersion":1,"source":"codebuddy","taskId":"sess-demo-002","eventKey":"stop-ctx-002","result":"success"}' | notice hook --source codebuddy
```

2. 查看通知文本。

**Expected/预期结果**: 标题回退为 `codebuddy · sess-de`、概要回退为「任务成功完成」；通知仍成功发出、可区分。

## Scenario D: Real Stop Verification/场景 D：真实 Stop 验证

1. 在 CodeBuddy 中发起一个多步骤任务（主题明确），等待实际触发 `Stop`。
2. 观察飞书通知：标题应展示任务可读主题（如 AI 标题或首条请求），概要反映任务结论（或任务内容）。
3. 记录实际 `session_id` 与转录文件名，验证 [research.md](research.md) R5 的「session_id → 转录文件」映射关系。

**Expected/预期结果**: 通知能一眼识别具体任务；`session_id` 与转录文件名的对应关系得到确认（或据此修正定位策略）。

## Full Quality Gates/完整质量关卡

```text
npm test
npm run build
npm run lint
npm run format:check
```

**Expected/预期结果**: 全部命令退出码为 0。随后完成安全抽查（转录正文/路径不落日志、测试无真实数据）与非作者代码审查。

## Troubleshooting/排查

- **标题仍是技术标识**: 检查转录文件是否含 `ai-title`/`summary` 记录、`transcript_path` 是否传入、字段名是否匹配（`aiTitle`/`summary`）。
- **概要仍是「任务成功完成」**: 检查首条用户消息是否为空、是否为系统注入（被跳过）、`summary` 记录是否存在。
- **session_id 匹配不到转录**: 属于 R5 待验证项，改用显式 `transcript_path`，并回到 [research.md](research.md) 核对映射关系。
