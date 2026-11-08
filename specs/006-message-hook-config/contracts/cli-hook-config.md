# CLI Contract/CLI 契约: Hook Configuration Commands/钩子配置命令

**Feature/功能**: Cross-Platform Message Hook Configuration/跨平台消息钩子配置

**Date/日期**: 2026-11-08

## Command Overview/命令总览

```text
notice hook-config list [--platform <linux|macos|windows>] [--agent <codebuddy|claude-code|codex-cli>] [--json]
notice hook-config show <template-id> [--json]
notice hook-config enable <template-id> [--confirm] [--json]
notice hook-config disable <template-id> [--json]
notice hook-config validate <template-id> [--json]
notice hook-config status <template-id> [--json]
```

## Exit Codes/退出码

| 退出码 | 含义 |
|--------|------|
| 0 | 操作成功 |
| 1 | 操作执行失败（如目标配置不可写、验证失败） |
| 2 | 输入校验失败（参数非法、模板不存在、缺少确认） |
| 3 | 本地存储或配置读取失败 |

## Output Contract/输出契约

- `list` 输出九种模板的系统、智能体、事件、状态与摘要；支持按平台或智能体过滤。
- `show` 输出单一模板的完整默认配置、目标位置摘要、当前状态与最近验证结果；不包含渠道凭据。
- `enable` 在确认后写入目标配置；成功输出 `enabled`，失败输出原因分类且不改变原配置。
- `disable` 仅移除本工具写入的钩子配置；成功输出 `disabled`。
- `validate` 输出当前配置可用性与失败分类；不修改任何文件。平台不匹配时返回 `invalid` 并说明原因（FR-013）。
- `status` 输出四类可观测诊断（FR-015）：`enabled`（是否已启动）、`hookValid`（钩子是否有效）、`platformMatches`/`installed`（平台与安装适用性）、`recentEvent`（最近事件，用于判断"事件未到达"）、`recentNotification`（最近通知状态，用于判断"通知失败"）。
- 列表与详情含 `platformMatches`（模板平台是否匹配当前系统）与 `installed`（目标智能体安装痕迹）两个适用性字段（FR-013），以及 `versionMismatch`（实例版本是否落后于内置版本，FR-014）。
- `--json` 输出纯 JSON 到 stdout；人机模式输出可读文本。

## Error Semantics/错误语义

- 冲突、无权限、目标缺失、内容无效、重复操作分别返回独立分类。
- 错误信息不包含完整敏感路径、渠道凭据或用户消息正文。
- 任何失败均保证原子性：目标配置保持操作前状态。
