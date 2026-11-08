# Quickstart/接入指南: C端AI任务对话框通知关联

**Feature**: [spec.md](spec.md) | **前置条件**: 飞书渠道已配置且 `notice channel test` 发送成功；`notice` 已在 PATH 中。

## CodeBuddy/CodeBuddy 接入（推荐：Stop 钩子）

1. 编辑 `~/.codebuddy/settings.json`（全局）或项目下 `.codebuddy/settings.json`，加入：

   ```json
   {
     "hooks": {
       "Stop": [{ "type": "command", "command": "notice hook --source codebuddy" }]
     }
   }
   ```

2. 在 CodeBuddy 当前对话中运行一个单轮问答或一个多步骤 Agent 任务；只要实际触发 Stop，飞书应在数秒内收到通知，对话窗口保持打开不影响。
3. 验证：`notice history events` 应出现 `source=codebuddy`、`trigger=hook` 的记录；`notice history` 可查看各渠道发送结果。

**指定通知渠道**（可选）：默认发送到 `config.json` 中 `notify.channels` 指定的渠道（未指定则全部已启用渠道）。也可在钩子命令行直接指定（优先级更高），多渠道用重复 `--channels` 参数（跨 shell 最稳妥）：

```json
{ "type": "command", "command": "notice hook --source codebuddy --channels feishu-me --channels app3" }
```

> **注意**：若 IDE 的C端对话框未触发该钩子（见 research.md 待验证项 1），请改用下方 MCP 兜底方式；MCP 依赖 Agent 主动调用，可靠性弱于钩子，可能漏报。

## Claude Code/Claude Code 接入

1. 方式一（钩子）：在 `~/.claude/settings.json` 的 `Stop` 钩子中配置命令 `notice hook --source claude-code`。
2. 方式二（巡检）：在 `config.json` 启用 `polling` 并保留 `claude-code` 适配器，运行 `notice watch`。
3. 验证：运行一个单轮问答或多步骤任务后查看飞书通知、`notice history events` 与 `notice history`。

## Codex CLI/Codex CLI 接入

1. 方式一（notify 钩子，推荐）：编辑 `~/.codex/config.toml`：

   ```toml
   notify = ["notice", "hook", "--source", "codex-cli", "--payload-argv"]
   ```

2. 方式二（巡检兜底）：在 `config.json` 的 `polling.adapters` 中启用 `codex-cli`（可选 `sessionsDir`，默认 `~/.codex/sessions`），运行 `notice watch`。
3. 验证：运行 `codex` 完成一个任务，飞书收到通知；`notice history` 显示 `source_agent=codex-cli`。

## MCP Fallback/MCP 兜底（无钩子且无本地记录时）

- 在目标 Agent 的规则/记忆文件中写入："任务结束时调用 NoticeTool 的 `send-notification` MCP 工具，并注明来源"。
- **可靠性声明**：该方式依赖 Agent 主动调用，可能漏报；仅作为无其他接入手段时的补充。

## Troubleshooting/排查

- **没收到通知**：先 `notice history events` 确认 Stop 是否到达、是否去重，再用 `notice history` 查看渠道发送结果；无事件记录说明事件源未接入，有事件但无渠道记录则检查渠道配置。
- **重复通知**：同一稳定 Stop 事件键的钩子与巡检只通知一轮；若重复出现，检查两条路径的 `source` 和事件身份是否一致。无稳定身份的降级受理只保证不漏报。
- **巡检失效**：目标产品升级后本地记录格式可能变化，查看本地日志中的读取失败记录，并按 contracts 中的适配器契约更新识别规则。
