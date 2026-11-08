# 飞书通知配置与全局钩子操作手册（notice-tool）

本文档面向 Windows + CodeBuddy 环境，说明如何把「AI 编程助手对话任务完成」事件接入飞书通知，并确保在**任意目录（含 git worktree）**下都能触发。

- 工具：`notice`（notice-tool）
- 触发方式：CodeBuddy `Stop` 钩子 → `notice hook` → 飞书渠道
- 配置目标：**全局** `~/.codebuddy/settings.json`（跨目录生效）

---

## 0. 当前环境现状（核查于 2026-11-08）

| 项 | 值 |
| --- | --- |
| 系统 | Windows |
| `notice` 命令 | 已全局安装，`C:\nodejsCacheFile\node_global\notice.ps1` |
| 数据目录 | `%APPDATA%\notice-tool`（即 `C:\Users\19666\AppData\Roaming\notice-tool`） |
| 数据文件 | `config.json`、`notice.db`、`secret.key` |
| 已配置渠道 | `feishu-me`（feishu，已启用）、`app3`（feishu，已启用） |
| 凭据摘要 | `cli_****1cb5 → on_7****1b91`（掩码显示，真实凭据加密落盘） |
| 全局钩子 | 已写入 `C:\Users\19666\.codebuddy\settings.json`，命令 `notice hook --source codebuddy --channels app3` |
| 项目级钩子 | `C:\Users\19666\Projects\NoticeTool\.codebuddy\settings.json` 已清空为 `{}` |

---

## 1. 工作原理（触发链路）

```
CodeBuddy 对话任务结束
        │  触发 Stop 钩子（读取全局 ~/.codebuddy/settings.json）
        ▼
notice hook --source codebuddy --channels app3
        │  从 stdin 读取事件 JSON → 映射为标准事件 → 去重
        ▼
读取渠道配置（数据目录 notice.db，凭据加密）
        │
        ▼
飞书目标会话收到完成通知
```

三个关键文件/目录的位置决定了它「是否随目录变化」：

| 依赖 | 位置 | 是否随工作目录变化 |
| --- | --- | --- |
| Stop 钩子 | `~/.codebuddy/settings.json`（全局） | 否（全局唯一） |
| `notice` 可执行文件 | 全局 npm 目录 | 否 |
| 渠道凭据 / 数据库 | `%APPDATA%\notice-tool` | 否 |

> 因此只要钩子写在**全局** `~/.codebuddy/settings.json`，在任何目录（含 worktree）都能触发；若写在**项目级** `.codebuddy/settings.json`，则换目录 / 新 worktree 会丢失钩子，详见第 6 节。

---

## 2. 前置准备

### 2.1 安装与初始化

```powershell
# 安装（若尚未全局安装）
npm install -g notice-tool

# 初始化数据目录（生成 config.json / 数据库 / 默认模板），幂等可重复执行
notice init
```

初始化后数据目录为 `%APPDATA%\notice-tool`。可用环境变量 `NOTICE_DATA_DIR` 覆盖（如隔离验证数据），一般无需改动。

### 2.2 校验安装

```powershell
notice --version
notice channel list      # 无渠道时提示「暂无渠道」
```

---

## 3. 飞书渠道配置

飞书支持两种连接方式，任选其一：

- **方式一：应用凭证（推荐）**——免群机器人，`tenant_access_token` 自动获取/缓存/续期。
- **方式二：群机器人 Webhook（旧方式）**——最简单，但依赖群机器人 URL。

### 3.1 方式一：应用凭证（推荐）

**第 1 步：在飞书开放平台准备应用（约 3 分钟）**

1. 打开[飞书开放平台开发者后台](https://open.feishu.cn/app)，创建**企业自建应用**，获得 `App ID`（`cli_` 开头）与 `App Secret`。
2. 在「权限管理」开通**以应用身份发消息**（`im:message` 相关）权限。
3. 若发往群：把应用机器人加入目标群，取得群会话 ID（`oc_` 开头）；若发往个人：确认自己在应用可用范围，准备 Open ID（`ou_` 开头）或 Union ID（`on_` 开头）。
4. 在「版本管理与发布」**创建版本并发布**——未发布版本时权限不生效（最常见失败原因）。

**第 2 步：添加渠道**

```powershell
# 发往群（chat_id）
notice channel add feishu --name my-feishu --mode app `
  --app-id cli_xxxxxxxx --app-secret "xxxxxxxx" `
  --receive-id-type chat_id --receive-id oc_xxxxxxxx

# 发往个人（open_id）
notice channel add feishu --name me --mode app `
  --app-id cli_xxxxxxxx --app-secret "xxxxxxxx" `
  --receive-id-type open_id --receive-id ou_xxxxxxxx
```

`--receive-id-type` 支持：`chat_id`（群）/ `open_id` / `user_id` / `union_id` / `email`。
若遇到 `open_id cross app` 错误（Open ID 取自其他应用），改用 `union_id` 类型 + `on_` 开头的 Union ID。

**第 3 步：测试并启用**

```powershell
notice channel test my-feishu
```

- 成功：目标会话收到「notice 测试消息」，渠道**自动启用**。
- 失败按错误码排查：
  - `AUTH_INVALID`（权限指引）→ 回开放平台开通 `im:message` 并发布版本；
  - `CONTENT_REJECTED`（不在会话）→ 把应用机器人加入群，或核对 `--receive-id` 与类型；
  - 凭证错误 → 核对 `App ID` / `App Secret`。

### 3.2 方式二：群机器人 Webhook

```powershell
notice channel add feishu --name legacy --webhook-url "https://open.feishu.cn/open-apis/bot/v2/hook/xxx"
notice channel test legacy
```

### 3.3 渠道管理命令

```powershell
notice channel list                # 列出渠道，凭据一律掩码
notice channel test <name>         # 测试发送，成功后自动启用
notice channel enable <name>       # 手动启用
notice channel disable <name>      # 禁用（保留凭据）
notice channel update <name> ...   # 部分更新凭据 / --name 改名
notice channel remove <name>       # 删除并物理清除凭据（历史记录保留）
```

> 同一类型支持多条（如同时发项目群与个人），按 `--name` 区分；通知会发送到**所有已启用渠道**（除非钩子用 `--channels` 指定，见 4.4）。

---

## 4. 全局钩子配置（CodeBuddy）

### 4.1 配置文件位置（关键）

CodeBuddy 有两处 `settings.json`，**位置不同、作用范围不同**：

| 文件 | 作用范围 | 是否随目录变化 |
| --- | --- | --- |
| `~/.codebuddy/settings.json`（全局） | 所有项目 / 所有目录 | 否（推荐） |
| `<项目>/.codebuddy/settings.json`（项目级） | 仅该项目目录 | 是（换目录 / worktree 会丢失） |

要让 worktree 也能触发，**必须把钩子放在全局文件**。下面两种方式二选一，勿混用。

### 4.2 方式 A：工具命令（推荐，可被工具识别）

```powershell
notice hook-config enable windows-codebuddy
```

- 自动把 `notice hook --source codebuddy` 写入全局 `~/.codebuddy/settings.json` 的 `hooks.Stop`。
- 可用 `notice hook-config list` / `notice hook-config status windows-codebuddy` / `notice hook-config validate windows-codebuddy` 查看状态。
- 该命令**不带 `--channels`**，发送目标由 `config.json` 的 `notify.channels` 决定（见 4.4）。

### 4.3 方式 B：手动编辑全局 settings.json

直接编辑 `C:\Users\19666\.codebuddy\settings.json`，在顶层加入 `hooks`：

```json
{
  "hooks": {
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "notice hook --source codebuddy --channels app3"
          }
        ]
      }
    ]
  }
}
```

> 当前环境即采用此方式（命令带 `--channels app3`）。注意：手动写入后，`notice hook-config list` 仍显示「不启动」，因为命令与工具内置模板不一致（多了 `--channels`），这**不影响实际触发**，只是工具自查不识别。

### 4.4 通知渠道选择（`--channels` vs `config.json`）

- **带 `--channels 渠道名`**：只发给指定渠道（如 `app3`），覆盖 `config.json`。
- **不带 `--channels`**：发给 `config.json` 的 `notify.channels` 列出的所有渠道；为空数组则发给**所有已启用渠道**。

`config.json` 位于 `%APPDATA%\notice-tool\config.json`，当前内容：

```json
{
  "notify": {
    "channels": ["feishu-me", "app3"]
  }
}
```

如需修改默认渠道，直接编辑该文件的 `notify.channels`（渠道名称或 id 均可）。

---

## 5. 验证

### 5.1 手动模拟一次通知（无需真实对话）

```powershell
'{"schemaVersion":1,"source":"demo","taskId":"session-demo-001","eventKey":"stop-demo-001","result":"success","resultSummary":"虚构单轮问答结束"}' | notice hook

notice history events --limit 10   # 查看事件历史
notice history --limit 10          # 查看通知（渠道发送）历史
```

预期：`notice history` 中出现 `sent` 记录，飞书会话收到消息。

### 5.2 真实任务验证

1. 在 CodeBuddy 中发起一次问答，等待回答结束（实际触发 `Stop`）。
2. 观察飞书会话是否收到通知。
3. 查询历史确认来源与触发方式：

```powershell
notice history events --limit 10
notice history --limit 10
```

预期：事件来源 `codebuddy`、触发方式 `hook`；渠道历史为 `sent`。

### 5.3 常用历史查询

```powershell
notice history --limit 10
notice history events --limit 10
notice history --status failed      # 只看失败
notice history --json               # 机器可读输出
```

---

## 6. 多目录 / Git Worktree 场景

### 6.1 结论

钩子写在**全局** `~/.codebuddy/settings.json` 后，`git worktree add` 新建的目录**能够触发**飞书通知（渠道、二进制、数据目录均为全局，不随目录变化）。

### 6.2 必须做的两件事

1. **确保钩子在全局**（第 4 节已做）：不要在项目级 `.codebuddy/settings.json` 里放钩子——该目录通常被 `.gitignore`（`.codebuddy/`），新 worktree 不会带上，钩子会丢失。

2. **把新目录加入信任列表**：全局 `~/.codebuddy/settings.json` 的 `trustedDirectories` 需包含新 worktree 路径，否则可能被当作不可信目录、不执行钩子：

```json
{
  "trustedDirectories": [
    "C:/Users/19666/Projects/NoticeTool",
    "C:/Users/19666/Projects/NoticeTool-worktree"
  ]
}
```

### 6.3 创建 worktree 的推荐顺序

```powershell
# 1) 创建 worktree
git worktree add ../NoticeTool-worktree -b feature-x

# 2) 编辑全局 ~/.codebuddy/settings.json，把新路径加入 trustedDirectories

# 3) 在新目录里正常发起对话任务，验证飞书是否收到通知
```

---

## 7. 常见问题排查

| 现象 | 排查 |
| --- | --- |
| 飞书收不到通知 | ① `notice channel list` 确认渠道「已启用」；② `notice channel test <name>` 看能否送达；③ `notice history` 看是否有 `failed` |
| 测试发送失败 `AUTH_INVALID` | 开通 `im:message` 权限并**发布版本** |
| 测试发送失败 `CONTENT_REJECTED` | 把应用机器人加入目标群 / 核对 `--receive-id` 与类型 |
| 换目录后不触发 | 钩子写在了项目级而非全局；或新目录未加入 `trustedDirectories` |
| 同一任务收到多条通知 | 检查 `hooks.Stop` 下是否混用了方式 A 与方式 B（出现两条命令） |
| `notice hook-config status` 显示「不启动」 | 手动写入的钩子带 `--channels`，与内置模板不一致，不影响实际触发 |
| 事件历史只有 `received` 无通知 | 无可用渠道；按提示配置渠道，勿误判为发送成功 |

---

## 8. 安全说明

- 渠道凭据（含 `App Secret`）加密存储于数据目录 `secret.key`（Windows 走 DPAPI），`channel list` 等输出一律掩码。
- 应用凭证方式为纯出站调用，无需公网回调地址。
- 日志、错误信息、导出数据中均脱敏，不暴露完整凭据、路径或原始对话内容。
