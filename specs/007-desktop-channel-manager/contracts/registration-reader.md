# Contract/契约: Agent Registration Reader/智能体注册探测器

**Date**: 2026-11-08 | **Feature**: [spec.md](../spec.md) | **Data Model**: [data-model.md](../data-model.md)

## Supported Agents/支持范围

仅覆盖现有事件来源，首期 Windows：

| 智能体      | 检测文件                                                             | 有效形态                                                      |
| ----------- | -------------------------------------------------------------------- | ------------------------------------------------------------- |
| CodeBuddy   | `~/.codebuddy/settings.json`，项目级 `.codebuddy/settings.json` 优先 | `hooks.Stop` 中存在 `notice hook --source codebuddy`          |
| Claude Code | `~/.claude/settings.json`，项目级 `.claude/settings.json` 优先       | `hooks.Stop` 中存在 `notice hook --source claude-code`        |
| Codex CLI   | `~/.codex/config.toml`                                               | `notify` 指向 `notice hook --source codex-cli --payload-argv` |

## Status Classification/状态分类

- **not-registered**：检测文件不存在或未包含 NoticeTool 钩子。
- **registered-valid**：配置存在且形态匹配契约。
- **registered-invalid**：配置存在但字段形态不完整或无法解析（例如 JSON 损坏、notify 缺少参数）。
- **read-failed**：文件存在但无权限或读取异常；错误信息脱敏，不暴露完整路径。

## Last Signal/最近接入信号

- 查询现有通知历史中 `source_agent` 匹配的最近一条通知记录。
- 展示 `lastSignalAt` 与结果状态（成功/失败）。
- 该信号表示最近一次任务结束通知，不表示智能体进程当前运行状态。

## Read Semantics/读取语义

- 全部只读，不创建、不修改、不删除任何智能体配置。
- 单个来源读取失败不影响其他来源条目。
- 输出仅包含来源名称、状态、适用范围、最近信号与脱敏错误；不包含凭据、完整用户路径或消息正文。

## Future Alignment/后续对齐

006 的模板启用功能实现后，本探测器可复用其状态定义；本契约不依赖 006 的实现进度。
