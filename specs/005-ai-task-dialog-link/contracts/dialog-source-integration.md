# Contracts/接口契约: 对话框事件源接入

**Date**: 2026-11-07 | **Feature**: [spec.md](../spec.md) | **Data Model**: [data-model.md](../data-model.md)

## CodeBuddy Stop Hook/CodeBuddy Stop 钩子契约

**配置侧**（`~/.codebuddy/settings.json` 或项目级 `.codebuddy/settings.json`）：

```json
{
  "hooks": {
    "Stop": [
      {
        "type": "command",
        "command": "notice hook --source codebuddy"
      }
    ]
  }
}
```

**输入**：CodeBuddy 通过 stdin 传入 JSON（含 `session_id`、`transcript_path` 等，实测字段以 research.md 待验证项 2 为准）。

**处理契约**（008 更新）：
- `session_id` → `task_id`；缺失时使用 `unknown-session`，Stop 仍进入通知流程。
- `eventKey` 或 stop/event ID 优先作为事件身份；否则用转录终态记录稳定身份生成不可逆散列；均不可得时按本次调用降级受理并输出脱敏提示。
- 其余字段缺失一律走默认值（见 data-model.md 事件映射表），不视为错误。
- 复用现有 stdin 钩子的 JSON 校验、限流与事件管线，退出码语义不变。

**输出**：任务结束事件进入现有通知管线，飞书等渠道收到通知；历史记录 `source_agent=codebuddy, trigger=hook`。

## Codex Notify/Codex notify 契约

**配置侧**（`~/.codex/config.toml`）：

```toml
notify = ["notice", "hook", "--source", "codex-cli", "--payload-argv"]
```

**输入**：Codex 在 `agent-turn-complete` 时以 argv 传入事件 JSON（`type`、`thread-id`、`last-assistant-message`、`input_messages`、`cwd`）。

**处理契约**（008 更新）：
- `--payload-argv` 时从 argv 解析 JSON；仅处理 `type == "agent-turn-complete"`，其他类型静默忽略（退出码 0）。
- `thread-id` → `task_id`，缺失时使用 `unknown-session`。
- turn/event ID 或 `eventKey` 优先作为事件身份；无稳定身份时按本次调用降级受理并提示。
- `last-assistant-message` → `result_summary`，截断并经敏感信息过滤。
- JSON 解析失败：退出码非 0 并输出脱敏错误信息，不抛出原始负载。

**输出**：同 CodeBuddy 契约（`source_agent=codex-cli, trigger=hook`）。

## Codex CLI Polling Adapter/Codex CLI 巡检适配器契约

**输入**：`config.json` 中 `polling.adapters` 的 `codex-cli` 条目（`sessionsDir` 可选，默认 `~/.codex/sessions`）。

**行为契约**（与现有 `claude-code` 适配器同一 `AgentStatusAdapter` 接口）：
- 读取 sessionsDir 下最新 rollout JSONL，识别"进行中 → 已结束"状态迁移（结束事件类型以 research.md 待验证项 3 的 fixture 为准）。
- 状态迁移触发 `ingestTaskEndEvent(..., trigger="polling")`，去重键与钩子路径一致。
- 启动基线扫描：冷却窗口内已结束任务补检一次，之后不重复。
- 文件损坏/不可读：跳过本轮、记录脱敏日志，不抛出到调度器之外（FR-007）。

**输出**：`source_agent=codex-cli, trigger=polling` 的通知事件。

## Compatibility/兼容性说明

- 008 增加可选 `eventKey` 与本地 `task_events.event_key`；旧无键 CLI、HTTP、MCP 负载保持原冷却去重语义。
- Claude Stop 来源必须保持 `claude-code`；同会话不同 Stop 不再因会话 ID 相同被合并。
- 详细规则见 `specs/008-notify-all-stops/contracts/stop-notification.md`。
