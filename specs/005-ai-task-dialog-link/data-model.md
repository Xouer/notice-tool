# Data Model/数据模型: C端AI任务对话框通知关联

**Date**: 2026-11-07 | **Feature**: [spec.md](spec.md)

本功能不引入新的持久化实体与数据库迁移，复用现有任务结束事件、去重记录与通知历史。以下为逻辑模型与配置扩展。

## Source Identity/来源标识

- `source_agent` 取值约定（自由文本字段，新增约定值而非枚举变更）：`codebuddy`、`claude-code`、`codex-cli`。
- `trigger` 枚举保持 `hook | polling | mcp` 不变（宪法 III：无破坏性变更）。
- 脚本直调等未标明来源的事件保持现有默认来源，不与上述三个值混淆（FR-009）。

## Event Mapping/事件映射

统一映射到现有 `TaskEndEvent`（task_id、source_agent、result_status、finished_at、result_summary）：

| 目标字段 | CodeBuddy Stop（stdin JSON） | Codex notify（argv JSON） |
|----------|------------------------------|---------------------------|
| task_id | `session_id`；缺失时为 `unknown-session` | `thread-id`；缺失时为 `unknown-session` |
| event_key | 可选 `eventKey`；否则取 stop/event ID 或终态记录稳定身份的散列 | 可选 `eventKey`；否则取 turn/event ID 或 `turn_complete` 稳定身份的散列 |
| source_agent | `codebuddy` 或 `claude-code`（CLI `--source` 显式指定） | 固定 `codex-cli` |
| result_status | 可判定时从会话记录尾部推断，否则默认 `completed` | 默认 `completed`（`agent-turn-complete` 仅表示完成） |
| finished_at | 接收时刻（负载无时间字段时） | 接收时刻 |
| result_summary | 可选；缺失时默认文案 | `last-assistant-message`（截断至模板长度上限） |

- 所有映射字段均可选，缺失走默认值，不拒绝事件（FR-002）。
- `result_summary` 进入模板前必须经过现有敏感信息过滤（FR-010）。

## Config Extension/配置扩展

全部为可选新增，缺省行为与现状一致（向后兼容）：

- `notice hook` CLI 新增可选参数：
  - `--source <name>`：显式指定来源标识（`codebuddy`/`codex-cli` 等），缺省保持现有推断逻辑。
  - `--payload-argv`：从 argv 而非 stdin 读取事件 JSON（Codex notify 调用方式）。
- `config.json` 的 `polling.adapters` 新增可选适配器类型 `codex-cli`：
  - `sessionsDir`：可选，默认 `~/.codex/sessions`。
  - 启停与轮询间隔沿用 `polling.enabled` / `polling.intervalSeconds`，无新增配置面。

## Dedup/去重

- 008 起有稳定 `event_key` 的 Stop 按 `source_agent + task_id + event_key` 在本地保留期内判重；同一会话不同 Stop 不合并。
- 旧无键调用继续按 `source_agent + task_id` 和 `dedup.cooldownMinutes` 冷却去重，两类事件互不抑制。
- 无稳定事件身份的来源按新 Stop 降级受理并提示；不宣称可精确识别其后续重报。

## History/通知历史

- 复用现有历史表与 `notice history` 查询，记录 `source_agent` 与 `trigger`（FR-006）。
- 008 新增 `notice history events` 查看 `received/duplicated/dispatched` 事件状态；事件键仅展示不可逆短摘要。
