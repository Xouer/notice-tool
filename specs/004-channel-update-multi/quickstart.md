# Quickstart: Channel Config Update & Multi-Config/快速开始：渠道配置修改与同类型多条配置

**Feature**: 004-channel-update-multi | **Date**: 2026-11-07 | **Contract/契约**: [contracts/update.md](contracts/update.md)

端到端验证指南：证明"修改配置"与"同类型多条配置"两条主线可用。所有凭据均为占位值，请替换为你的真实凭据后再执行 `test`。

## Prerequisites/前置条件

```powershell
# 构建并可用 CLI（仓库根目录）
npm install
npm run build
node dist/cli/index.js --help   # 或 npm link 后直接使用 notice
```

## Scenario 1: 凭据轮换——单字段修改（US1，SC-001）

```powershell
# 1) 添加一条飞书应用凭证渠道（未启用）
notice channel add feishu --name my-feishu --mode app `
  --app-id cli_xxxxxxxx --app-secret "OLD_SECRET" `
  --receive-id-type chat_id --receive-id oc_xxxxxxxx

# 2) 仅轮换 App Secret（其余字段不动）
notice channel update my-feishu --app-secret "NEW_SECRET"
# 期望输出：渠道已更新：my-feishu（feishu）    退出码 0

# 3) 验证：list 摘要掩码显示、状态未变；test 成功后自动启用
notice channel list
notice channel test my-feishu
```

**Expected/期望**: 步骤 2 一条命令完成轮换；`list` 中 `my-feishu` 仍为 `未启用`（test 前）；`test` 成功输出 `测试发送成功：my-feishu（已自动启用）`。

## Scenario 2: 改名（US1，FR-004）

```powershell
notice channel update my-feishu --name feishu-project
# 期望输出：渠道已更新：feishu-project（feishu）
notice channel list   # old-name 消失，启用状态保留
```

**改名冲突（原子性验证，SC-002）**:

```powershell
notice channel add email --name mail-a --smtp-host smtp.qq.com --auth-code "code1" --to a@example.com
notice channel update feishu-project --name mail-a
# 期望：错误"同名渠道已存在（同 type 内唯一）：mail-a（email）"，退出码 2；
#       且 feishu-project 的名称与凭据均保持原样（list 验证）
```

**校验失败（原子性验证，FR-005）**:

```powershell
notice channel update feishu-project --receive-id ""   # 或提供非法 URL 等
# 期望：stderr 指出具体字段错误，退出码 2；list 显示摘要与修改前一致
```

## Scenario 3: 同类型多条配置（US2，SC-003）

```powershell
# 同一 email 类型添加两条不同名称的配置
notice channel add email --name mail-a --smtp-host smtp.qq.com --auth-code "code1" --to a@example.com
notice channel add email --name mail-b --smtp-host smtp.163.com --auth-code "code2" --to b@example.com
notice channel list          # 两条独立记录，各自的掩码摘要不同
notice channel test mail-a   # 成功 → mail-a 启用
notice channel test mail-b   # 成功 → mail-b 启用

# 独立禁用/启用互不影响（FR-010）
notice channel disable mail-a
notice channel test mail-b   # 仍成功

# 独立修改互不影响（FR-010）
notice channel update mail-b --to b2@example.com   # 仅 mail-b 变化，mail-a 不受影响

# 同名报错指引（FR-012）
notice channel add email --name mail-a --smtp-host smtp.qq.com --auth-code "x" --to x@example.com
# 期望：同名渠道已存在（同 type 内唯一）：mail-a（email）……提示改名或 update，退出码 2
```

## Scenario 4: 交互式向导修改（US3，FR-008）

在交互终端（PowerShell/Windows Terminal）运行：

```powershell
notice channel update mail-b      # 不带任何标志 → 进入向导
```

**Expected/期望**: 类型步骤跳过（锁定 email）；逐项预填当前值（`SMTP 授权码：已设置（回车保留）`）；确认摘要敏感值显示 `***`；选择取消则输出 `已取消，未做任何更改。` 且配置不变。

**非交互/JSON 拒绝（退出码 2）**:

```powershell
$null | notice channel update mail-b        # 非 TTY → 拒绝并指引标志方式
notice --json channel update mail-b         # --json → 拒绝向导，stdout 纯 JSON 提示走 stderr
```

## Scenario 5: JSON 输出（FR-006）

```powershell
notice --json channel update mail-b --to b3@example.com
# 期望 stdout：{"channel":{"name":"mail-b","type":"email","enabled":true}}
```

## Scenario 6: 分发独立性（US2，FR-011）

1. 确保 `mail-a`、`mail-b` 均已启用；
2. 通过 `notice hook`（或 `notice serve`/MCP）注入一条任务完成事件；
3. **Expected/期望**: `notice history` 显示两条通知记录（channel_id 分别对应 mail-a/mail-b）；将 mail-a 的 SMTP 主机改为无效值使其发送失败后再次分发，mail-b 仍成功、记录状态各自独立。

## 回归门禁/Regression Gate

```powershell
npm test        # 既有全部测试（含 003 向导、001 CLI 契约）必须全绿
npm run lint
```

> 详细字段含义与凭据获取方法见 003 [quickstart.md](../../003-interactive-credential-setup/quickstart.md) 与 README；命令行为细则见 [contracts/update.md](contracts/update.md)。
