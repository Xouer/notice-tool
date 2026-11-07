# Contract: CLI Commands & Configuration/契约：CLI 命令与配置

**Version/版本**: 1 (2026-11-07) | **Spec/规格**: [spec.md](../spec.md)

用户操作面（CLI）的命令契约与本地配置文件格式。命令语法演进遵循宪法原则 III：参数与子命令仅做可选新增，破坏性变更须升 MAJOR 并声明影响面。

## Command Overview/命令总览

| 命令 | 用途 | 对应规格 |
| --- | --- | --- |
| `notice init` | 初始化用户数据目录、数据库与默认模板 | US1 |
| `notice channel add <type>` | 交互式添加渠道（凭据输入即时加密入库） | FR-005 |
| `notice channel list` | 列出渠道（凭据一律掩码显示） | FR-004/FR-012 |
| `notice channel enable/disable <name>` | 启用/禁用渠道 | FR-004 |
| `notice channel remove <name>` | 删除渠道并物理清除其凭据 | FR-005 |
| `notice channel test <name> [--message <text>]` | 发送测试消息并显示结果 | FR-006 |
| `notice serve` | 常驻服务：钩子 HTTP 端点 + 巡查调度 | FR-001/FR-003 |
| `notice watch` | 前台运行巡查模式（不启动 HTTP） | FR-002 |
| `notice hook` | CLI stdin 钩子入口（负载见 [hook-receiver.md](hook-receiver.md)） | FR-001 |
| `notice mcp` | 以 stdio 启动 MCP 服务端，供外部 MCP 客户端拉起（工具契约见 [mcp-tools.md](mcp-tools.md)） | FR-010 |
| `notice history [--limit N] [--status failed]` | 查看通知历史 | FR-011 |
| `notice history resend <recordId>` | 手动重发失败记录 | FR-008 |
| `notice template list/set-default/edit <name>` | 模板管理 | FR-009 |

**Global Flags/全局参数**: `--config <path>`（指定配置文件）；`--json`（输出机器可读 JSON，便于脚本化）。

## Exit Codes/退出码

`0` 成功；`1` 一般失败（附人读消息）；`2` 输入校验失败；`3` 本地存储/服务异常。所有输出不包含明文凭据。

## Configuration File/配置文件（非敏感部分）

路径：用户数据目录下 `config.json`（如 `%APPDATA%/notice-tool/config.json`）。**仅存非敏感配置**；凭据一律存数据库密文列，不入此文件。

```json
{
  "schemaVersion": 1,
  "server": { "host": "127.0.0.1", "port": 47650 },
  "polling": { "enabled": true, "intervalSeconds": 10, "adapters": ["claude-code"] },
  "dedup": { "cooldownMinutes": 10 },
  "antiFlood": { "aggregateWindowSeconds": 30, "perChannelPerMinute": 20 },
  "retentionDays": 30
}
```

- 缺失字段取内置默认值（与上例一致）；未知字段忽略并告警（向前兼容）。
- `polling.adapters` 支持注册名与 `generic-file` 适配器参数块（路径 + 完成特征正则），具体结构在实现任务中按本契约扩展，同样遵循"新增可选"规则。

## Error Code Taxonomy/错误码分类（通知记录与渠道失败共用）

| 码 | 分类 | 用户提示方向 |
| --- | --- | --- |
| `AUTH_INVALID` | 凭据失效/被撤销 | 引导更新凭据（边界情况：凭据过期） |
| `NETWORK_UNREACHABLE` | 网络不可达 | 检查网络，稍后重试/手动重发 |
| `RATE_LIMITED_REMOTE` | 渠道侧限流 | 降低通知频率或调整渠道配置 |
| `CONTENT_REJECTED` | 内容被渠道拒绝 | 检查模板长度与格式 |
| `UNKNOWN` | 未分类 | 附脱敏摘要，鼓励反馈 |

错误信息一律脱敏：不含凭据、令牌、原始响应体与堆栈。

## Compatibility Rules/兼容性规则

- 子命令、全局参数、`config.json` 顶层键为稳定契约；仅做可选新增，删除或改义需 MAJOR 版本 + 迁移说明（含 `schemaVersion` 升级路径）。
- `--json` 输出结构新增字段保持可选。
