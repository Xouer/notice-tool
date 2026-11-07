# Contract: Channel Update Command/契约：渠道修改命令

**Version/版本**: 1 (2026-11-07) | **Spec/规格**: [spec.md](../spec.md)

本契约是对 001 [cli.md](../../001-agent-task-notify/contracts/cli.md)、002 [feishu-app-channel.md](../../002-feishu-app-credential/contracts/feishu-app-channel.md) 与 003 [wizard.md](../../003-interactive-credential-setup/contracts/wizard.md) 的**受控新增**（宪法原则 III）：既有子命令、退出码 0/1/2/3、`--json` 结构均不变。

## CLI 新增/CLI Addition

### `notice channel update <name>`（FR-001）

标志集合与 `channel add` 完全一致（含 `--mode/--webhook-url/--app-id/--app-secret/--receive-id-type/--receive-id/--smtp-host/--smtp-port/--username/--auth-code/--from/--to/--push-key/--service/--secret/--endpoint/--interactive`），另加：

- `--name <newname>`：改名（FR-004）。注意与 add 的 `--name`（设置名称）语义对应：update 中含义为"新名称"。
- 渠道类型**不可修改**（无 `--type`）；换类型请删除后重新添加（spec Assumptions）。

### 行为矩阵（research R5）

| 场景 | stdin TTY | `--json` | 行为 | 退出码 |
| --- | --- | --- | --- | --- |
| 提供了任一凭据标志或 `--name` | 任意 | 任意 | 标志路径：合并 → 归一化校验 → 写入 | 0/2 |
| 未提供任何修改标志 | 是 | 否 | **启动向导修改模式**（FR-008，见下节） | 0（保存/取消） |
| 未提供任何修改标志 | 否 | 否 | 拒绝：`请在非交互环境使用命令行标志修改（notice channel update --help），或在交互终端运行。` | 2 |
| 未提供任何修改标志 | 任意 | 是 | 拒绝：`--json 模式不支持交互式向导：请补齐命令行标志（notice channel update --help），或去掉 --json 在交互终端运行。` | 2 |
| `<name>` 不存在 | 任意 | 任意 | `未找到渠道：<name>（使用 \`notice channel list\` 查看）` | 2 |

### 标志路径合并规则（FR-002/FR-003，research R1）

```text
1. 按 <name> 定位渠道行（失败 → 退出码 2）
2. credentials = 解密(row.credentials_blob)
3. merged   = { ...credentials, ...命令行提供的凭据字段 }   // 未提供字段保留原值
4. 新名称   = opts.name ?? row.name；改名时先做同 type 内重名预检（冲突 → 退出码 2，零写入）
5. validated = validateChannelInput(row.type, 新名称, merged)   // 归一化重建，丢弃换方式后的残留字段
6. repo.updateCredentials(row.id, merged) → (新名称 ≠ 旧名称) repo.rename(row.id, 新名称)
7. 输出（见下节）
```

- 校验失败（第 5 步抛 `ChannelConfigError`）：stderr 定位到具体字段（沿用 002 契约错误文案），**原凭据与名称零改动**（SC-002）。
- **空值清除**（2026-11-07 澄清，FR-002）：可选字段传空字符串（如 `--secret ""`）→ 合并时置空，归一化校验器 `optionalString` 对空值返回 `undefined` 即清除；必填字段传空值 → `requireString` 报错定位字段，零写入。向导路径：可选字段提供"清除该字段"选项，必填字段不提供。
- 退出码语义：校验失败/重名冲突/渠道不存在 → 2；成功 → 0；未预期 → 1；本地存储异常 → 3。

### 输出（FR-006，SC-004）

| 模式 | 成功输出 |
| --- | --- |
| 人读 | `渠道已更新：<name>（<type>）`（改名时显示新名称） |
| `--json` | `{"channel":{"name":"<新名>","type":"<type>","enabled":<bool>}}`（stdout 纯 JSON；掩码摘要不含明文） |

## 向导修改模式（FR-008，US3）

触发：交互终端 + 未提供任何修改标志（或 `--interactive` 显式指定）。步骤流复用 003 契约（`contracts/wizard.md`），update 模式差异：

```text
第 0 步 定位渠道（<name> 不存在 → 退出码 2）
第 1 步 渠道类型：跳过（锁定为现有 type，不提供切换）
第 2 步 连接方式：预选现有 mode（可改为同类型的其他方式；改后按新方式字段集逐项输入）
第 3 步 逐项输入：各字段预填当前值（回车保留；输入新值替换）；
        敏感字段显示"已设置（回车保留）"，新输入不回显明文；
        未设置的敏感字段提示获取方法（同 add）
第 4 步 确认摘要：敏感值掩码（***），渠道名称显示当前值（可在此步改名）
        1) 确认保存  2) 返回上一步修改  0) 取消
保存 → 改名预检（名称有变化时；冲突 → 提示重试/取消）→ updateCredentials → rename
```

- 每步导航（`b` 返回、`0`/Ctrl+C 取消、取消输出 `已取消，未做任何更改。`）与 add 向导一致。
- 取消/校验失败重试均零落盘。

## 同类型多条配置行为（US2，FR-009~FR-012）

数据层零改动（`(type, name)` 唯一索引），本契约固化以下行为为验收口径：

1. **添加**: 同 type 不同 name → 成功（如 `notice channel add feishu --name feishu-b ...`）；同 type 同名 → `同名渠道已存在（同 type 内唯一）：<name>（<type>）`（退出码 2，文案补充指引"请换一个名称，或使用 \`notice channel update <name>\` 修改既有渠道"）。
2. **独立性**: `list/enable/disable/test/remove/update` 均按 `<name>` 精确定位，仅影响目标渠道（含同 type 其余渠道零影响）。
3. **分发**: 一次事件分发到每条 `enabled` 渠道各一次；某条失败不阻断其余（既有 event-pipeline 行为，测试固化）。
4. **改名范围**: 仅同 type 内查重——`feishu-a` 改名为既有 `email-a` 的名称是**合法**的（不同 type 名称可重复）。

## 安全规则/Security（宪法原则 IV）

- 明文凭据生命周期：解密 → 合并 → 校验 → 加密写入，全程内存瞬时；不写日志、不进错误信息（`redactSensitive` 兜底）。
- `list`/`--json` 输出沿用 `summarizeCredentials` 掩码摘要；update 不新增任何明文输出面。
- 向导 `askSecret` 不回显明文（沿用 003 R3 raw 模式掩码）。
- 测试使用虚构凭据（`cli_xxx`/`SECxxx` 等占位值），真实凭据不进入测试固件。
