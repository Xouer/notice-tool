# notice-tool
Agent Task Completion Notification/本地常驻的智能体任务完成通知工具

本地 AI 编程智能体的对话任务结束后，第一时间把完成通知送达你的飞书、钉钉、邮箱、微信、QQ。支持钩子触发、状态巡查与 MCP 接入。

## 通知渠道配置

```bash
notice channel add <type> --name <name> [凭据标志...]
notice channel test <name>   # 测试发送，成功后自动启用
notice channel list          # 凭据一律掩码显示
```

### 交互式向导（推荐）

直接运行 `notice channel add`（不带参数），工具会分步引导完成配置：**选择渠道类型 → 选择连接方式 → 逐项输入凭据**（每项附含义、格式示例与获取方法提示，敏感值输入不回显明文）→ 确认摘要后保存。也可用 `notice channel add feishu --interactive` 强制进入向导（已给类型时跳过第一步）。

> 脚本/CI 等非交互环境请使用下方命令行标志方式；`--json` 模式不会弹出向导。端到端验证步骤见 [specs/003-interactive-credential-setup/quickstart.md](specs/003-interactive-credential-setup/quickstart.md)。

### 飞书：两种连接方式

**方式一：应用凭证（推荐，免群机器人）**——只需自建应用的 `App ID` / `App Secret` 与消息接收目标：

```bash
notice channel add feishu --name my-feishu --mode app \
  --app-id cli_xxxxxxxx --app-secret "xxxxxxxx" \
  --receive-id-type chat_id --receive-id oc_xxxxxxxx
```

准备步骤：

1. 在[飞书开放平台](https://open.feishu.cn/app)创建**企业自建应用**，获得 `App ID`（`cli_` 开头）与 `App Secret`。
2. 应用"权限管理"中开通**消息发送**（`im:message`）相关权限。
3. 发往群：把应用机器人加入目标群并取得群会话 ID（`oc_` 开头）；发往个人：使用 `open_id` 类型与你的 `ou_` 开头 Open ID；若遇 `open_id cross app` 错误（Open ID 取自其他应用），改用 `union_id` 类型与 `on_` 开头的 Union ID（同一开发者下跨应用通用）。
4. **创建版本并发布**——未发布版本时权限不生效（常见失败原因）。

访问令牌（`tenant_access_token`）由工具自动获取、缓存与续期，无需人工维护。

**方式二：群机器人 Webhook（旧方式，仍可用）**：

```bash
notice channel add feishu --name legacy --webhook-url "https://open.feishu.cn/open-apis/bot/v2/hook/xxx"
```

### 其他渠道

钉钉（Webhook + 可选加签）、邮箱（SMTP 授权码）、微信（企业微信群机器人 / Server酱·PushPlus）、QQ（官方机器人 / PushPlus）。凭据标志见 `notice channel add --help`。

## 端到端验证指南

飞书应用凭证方式从创建应用到测试送达的完整步骤见 [specs/002-feishu-app-credential/quickstart.md](specs/002-feishu-app-credential/quickstart.md)。

## 安全说明

- 渠道凭据（含 `App Secret`）加密存储于本地，日志、错误信息与导出数据中一律脱敏。
- 应用凭证方式为纯出站调用，无需公网回调地址。
