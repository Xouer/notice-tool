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

2. 在 CodeBuddy 中运行一个多步骤 Agent 任务，任务结束时飞书应在数秒内收到通知。
3. 验证：`notice history` 应出现 `source_agent=codebuddy`、`trigger=hook` 的记录。

> **注意**：若 IDE 的C端对话框未触发该钩子（见 research.md 待验证项 1），请改用下方 MCP 兜底方式；MCP 依赖 Agent 主动调用，可靠性弱于钩子，可能漏报。

## Claude Code/Claude Code 接入

1. 方式一（钩子）：在 `~/.claude/settings.json` 的 `Stop` 钩子中配置命令 `notice hook --source claude-code`。
2. 方式二（巡检）：在 `config.json` 启用 `polling` 并保留 `claude-code` 适配器，运行 `notice watch`。
3. 验证：运行一个任务后查看飞书通知与 `notice history`。

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

- **没收到通知**：先 `notice history` 确认事件是否到达及触发方式（SC-006）；无记录说明事件源未接入，有记录但无通知则检查渠道配置。
- **重复通知**：同一任务的钩子与巡检应在冷却窗口内去重；若重复出现，检查两条路径的 `source` 是否一致。
- **巡检失效**：目标产品升级后本地记录格式可能变化，查看本地日志中的读取失败记录，并按 contracts 中的适配器契约更新识别规则。
