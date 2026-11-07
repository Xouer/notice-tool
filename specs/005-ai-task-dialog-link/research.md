# Research/技术调研: C端AI任务对话框通知关联

**Date**: 2026-11-07 | **Feature**: [spec.md](spec.md)

## Research Questions/调研问题

三个目标产品（CodeBuddy、Claude Code、Codex CLI）各自的任务完成事件源形态：是否支持任务完成钩子、钩子负载格式、本地会话记录位置，以及对应的接入路径选择。

## CodeBuddy/CodeBuddy 调研结论

- **支持 Stop 钩子**：CodeBuddy Code 提供 Hooks 机制（SessionStart、UserPromptSubmit、PreToolUse、PostToolUse、Stop 等事件），`Stop` 在 Agent 完成响应时触发，与"多步骤 Agent 任务整体结束"（FR-012）对应。
- **配置位置**：`~/.codebuddy/settings.json`（全局）或 `<project>/.codebuddy/settings.json`（项目级），`type: "command"`，钩子通过 **stdin 接收 JSON**（含 `session_id`、`transcript_path` 等字段）。
- **结果状态**：Stop 负载不含显式成功/失败字段；失败/中断判定需结合 `transcript_path` 指向的会话记录尾部内容，无法判定时以默认值渲染（FR-002 允许缺失字段）。
- **证据**：`codebuddy.ai/docs/cli/hooks`、`cloud.tencent.com.cn/document/api/876/137030`（Hooks 配置参考）、`sct.ftqq.com/docs/integrations/codebuddy`（Stop 钩子推送实践）。
- **决策**：主路径 = Stop 钩子 → `notice hook`（现有 stdin 入口），零新增服务端代码。**待验证项**：IDE 的C端对话框是否与 CLI 共用 hooks 配置体系并触发 Stop——实现阶段首先验证；若 IDE 对话框不触发，则按 FR-013 走 MCP 兜底并在接入引导中明示。

## Codex CLI/Codex CLI 调研结论

- **支持 notify 钩子**：`config.toml` 的 `notify` 配置项指定外部程序，Codex 在 `agent-turn-complete` 时调用该程序，事件 JSON 以 **argv（命令行参数）** 而非 stdin 传递，字段含 `type`、`thread-id`、`last-assistant-message`、`input_messages`、`cwd`。
- **本地会话记录**：`~/.codex/sessions/` 下按日期组织的 rollout JSONL 文件，记录会话事件流，可用于巡检识别结束态。
- **证据**：Codex config 文档（notify 示例：`notification.get("type") == "agent-turn-complete"`，读取 `last-assistant-message`/`input_messages`）、社区集成实践（`lemonaid` 的 codex notify 集成，负载含 `thread-id`/`cwd`）。
- **决策**：主路径 = `notify` → `notice hook --payload-argv`（CLI 需新增可选的 argv 负载读取方式，这是本功能唯一需要的钩子入口扩展）；兜底路径 = 新增 `codex-cli` 巡检适配器（仿照现有 `claude-code` 适配器读取 rollout JSONL）。

## Claude Code/Claude Code 调研结论

- 现有 `claude-code` 巡检适配器已覆盖其本地会话记录；其 Stop hook 体系与 CodeBuddy 一致（stdin JSON），可直接配置到 `notice hook`。
- **决策**：不新增代码，仅补齐接入引导文档（quickstart）。

## Decision Summary/接入决策总表

| 产品 | 主路径 | 兜底路径 | 新增代码 |
|------|--------|----------|----------|
| CodeBuddy | Stop 钩子 → `notice hook`（stdin） | MCP 主动上报（IDE 不触发 Stop 时） | 仅接入引导与负载映射校验 |
| Claude Code | Stop 钩子 → `notice hook`（stdin） | 现有 `claude-code` 巡检适配器 | 无（仅文档） |
| Codex CLI | `notify` → `notice hook --payload-argv` | 新增 `codex-cli` 巡检适配器 | CLI argv 入口扩展 + 巡检适配器 |

## Alternatives Considered/备选方案与否决理由

- **新建并行的事件接收机制**（如专用对话框事件服务）：否决，违反宪法原则 I（简单设计），现有 stdin/HTTP 钩子入口与巡检调度器已能覆盖。
- **自研 IDE 插件直接监听对话框 UI**：否决，范围过大且依赖未公开的 IDE 内部 API，维护成本高。
- **所有产品统一只走巡检**：否决，钩子实时性更好且 CodeBuddy/Codex 均已确认支持钩子（宪法 I：从最简单可行方案出发，但不放弃已验证的更优路径）。

## Open Items/实现阶段待验证项

1. CodeBuddy IDE 对话框是否触发 settings.json 中的 Stop 钩子（若不触发 → MCP 兜底）。
2. CodeBuddy Stop 负载的确切字段集（以实测为准调整映射，缺失字段走默认值）。
3. Codex CLI rollout JSONL 中表示任务结束/失败的具体事件类型（实现阶段以真实会话样本固化 fixture）。
