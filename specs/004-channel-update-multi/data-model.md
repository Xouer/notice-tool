# Data Model: Channel Config Update & Multi-Config/数据模型：渠道配置修改与同类型多条配置

**Feature**: 004-channel-update-multi | **Date**: 2026-11-07 | **Spec/规格**: [spec.md](spec.md)

本文档为 001 [data-model.md](../../001-agent-task-notify/data-model.md) 的**受控增量**（宪法原则 III）：实体、表结构、唯一约束零变更，仅新增仓储操作并固化"同类型多条配置"的不变量。

## Entity: Notification Channel/实体：通知渠道（无变更）

表 `notification_channels`，唯一索引 `uq_channels_type_name (type, name)` —— 该约束即"同类型多条配置"的数据基础：

- 同一 `type` 下 `name` 唯一 → 同 type 可存在任意多条不同 name 的配置（FR-009）；
- 不同 `type` 之间 `name` 可重复。

## State Machine/状态机（无变更）

`draft（enabled=false，add/update 默认不动启用位）→ enabled（test 成功自动置 true）⇄ disabled（disable/enable）`。

update 操作**不改变** `enabled`：修改已启用渠道的凭据后保持启用（是否送达由下次真实发送/`test` 验证）；修改未启用渠道保持未启用（FR-007、spec 边界情况）。

## Repository Operations/仓储操作（ChannelRepository 增量）

| 操作 | 签名 | 语义 | 校验与失败 |
| --- | --- | --- | --- |
| `updateCredentials`（既有） | `(id, credentials: unknown) → ChannelRow` | 解密现状 →（调用方已完成合并）→ `validateChannelInput(row.type, row.name, credentials)` 归一化 → 重新加密写入 `credentials_blob` + `updatedAt` | 渠道不存在/校验失败抛 `ChannelConfigError`，**原密文零改动**（SC-002 原子性） |
| `rename`（新增） | `(id, newName: string) → ChannelRow` | 同 type 内重名预检（排除自身 id）→ 更新 `name` + `updatedAt` | 重名抛 `ChannelConfigError("同名渠道已存在（同 type 内唯一）…")`；名称非空/≤64 字符由 `validateChannelInput` 同源规则校验 |

调用顺序契约（CLI 层）：**改名预检 → `updateCredentials` → `rename`**。预检在任何写入前完成，因此改名冲突时凭据亦未被修改（research R2）。

## Credential Merge/凭据合并（CLI 层，内存中完成）

```text
merged = { ...解密(既有 credentials_blob), ...命令行提供的凭据字段 }
validated = validateChannelInput(row.type, row.name, merged)   // 归一化：重建规范凭据集
// 切换连接方式（如 feishu --mode webhook）时旧方式残留字段被归一化自动丢弃（research R1）
```

- 合并仅在内存中进行，明文凭据不落日志/不落盘（SC-004）。
- 空值清除（2026-11-07 澄清）：可选字段传空字符串 → `optionalString` 归一化为 `undefined`（清除）；必填字段空值 → `requireString` 报错。
- 明文生命周期：解密 → 合并 → 校验 → 加密写入，全程瞬时。

## Wizard Update Session/向导修改会话（仅驻内存）

复用 003 向导会话结构，update 模式 seed 增量：

| Seed 项 | add 模式 | update 模式 |
| --- | --- | --- |
| type | 可选（未给则第 1 步选择） | **锁定**为渠道现有 type（第 1 步跳过） |
| mode | 未预选（多方式渠道进入第 2 步选择） | **预选**现有 mode（用户可改，改后按新方式字段集走） |
| values | 空 / `--name` 预填 | 各字段预填当前解密值；敏感字段提示"已设置（回车保留）" |
| 产物 | `WizardOutcome(save)` → `repo.create` | `WizardOutcome(save)` → 改名预检 + `updateCredentials` +（名称变化时）`rename` |

会话取消/中断零落盘（与 003 一致，SC-003 同源约束）。

## Invariants/不变量（测试固化，FR-009/FR-010/FR-011）

1. 同 type 两条渠道 A/B：`setEnabled(A)`/`remove(A)`/`test(A)`/`update(A)` 不影响 B 的任何属性。
2. 分发一次事件：每条 `enabled` 渠道各产生一条 `notification_records`（channel_id 各自独立），某条发送失败不影响其余。
3. 改名仅更新 `name`/`updated_at`；`id`、`type`、`enabled`、`credentials_blob`、历史记录 `channel_id` 外键全部不变。

## Security Notes/安全要点（宪法原则 IV）

- **数据类型与信任边界**: 渠道凭据（Webhook 地址、App Secret、SMTP 授权码、推送密钥）为敏感数据；信任边界为本地进程与本地 SQLite 文件。
- **访问主体与授权模型**: 仅本机用户；凭据密文解密密钥经 `SecretStore`（Windows DPAPI CurrentUser 边界）托管，与 001 现状一致，无新增访问面。
- **最小权限**: update 不引入新权限；解密仅在合并/写入瞬间发生。
- **失效与撤销**: 渠道删除即物理清除密文（既有 `remove` 语义不变）；修改轮换旧凭据随新密文覆盖而失效。
- **脱敏**: `list` 摘要、错误信息、`--json` 输出沿用 `summarizeCredentials`/`redactSensitive`；向导摘要敏感值 `***`；测试一律使用虚构凭据，真实凭据不进入任何日志与测试固件。
