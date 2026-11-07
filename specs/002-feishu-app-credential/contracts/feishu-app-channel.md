# Contract: Feishu App Credential Channel/契约：飞书应用凭证通道

**Version/版本**: 1 (2026-11-07) | **Spec/规格**: [spec.md](../spec.md)

本契约是对 001 [cli.md](../../001-agent-task-notify/contracts/cli.md) 的**可选新增**，遵循宪法原则 III：仅新增可选参数与字段，破坏性变更须升 MAJOR。既有五码错误体系、退出码、`--json` 结构均不变。

## CLI 变更/CLI Changes

### `notice channel add feishu` 新增标志

| 标志 | 说明 |
| --- | --- |
| `--mode <app\|webhook>` | 飞书连接方式；**缺省 `webhook`**（既有行为零回归） |
| `--app-id <id>` | 自建应用 App ID（mode=app 必填） |
| `--app-secret <secret>` | 自建应用 App Secret（mode=app 必填；输入即时加密入库，不回显） |
| `--receive-id-type <type>` | 接收目标类型：`chat_id\|open_id\|user_id\|email`（mode=app 必填） |
| `--receive-id <id>` | 接收目标标识，如群会话 ID `oc_xxx`（mode=app 必填） |

示例：

```bash
# 新方式：应用凭证（免群机器人）
notice channel add feishu --name my-feishu --mode app \
  --app-id cli_a1b2c3d4e5f6 --app-secret "xxxx" \
  --receive-id-type chat_id --receive-id oc_1234567890abcdef

# 旧方式：群机器人 Webhook（完全不变）
notice channel add feishu --name legacy --webhook-url https://open.feishu.cn/open-apis/bot/v2/hook/xxx
```

- `--app-id/--app-secret` 与 QQ 渠道共用同名标志（按 `type` 分派校验，互不干扰）。
- 校验失败（缺字段/非法枚举）退出码 `2`，错误信息定位到具体标志（FR-107）。
- `list` 输出：app 模式摘要为 `appId 掩码 → receiveId 掩码`；`appSecret` 任何输出不可见（FR-106）。

### 其余命令零变更

`enable/disable/remove/test/history/template` 原样工作；`channel test` 对 app 模式渠道触发"取令牌 → 发送"链路，成功后自动启用（沿用既有行为）。

## Credentials JSON（credentials_blob 密文内）

结构见 [data-model.md](../data-model.md)；`schemaVersion` 保持 1，`mode` 缺省按 `webhook` 解释（向前兼容）。

## 飞书开放平台调用约定/Open Platform Call Conventions

```text
1) 换取令牌（无 Authorization 头）
   POST https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal
   body: { app_id, app_secret }
   成功: code=0 → 缓存 { tenant_access_token, expire 秒 }

2) 发送消息（Bearer 令牌）
   POST https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type={receiveIdType}
   Authorization: Bearer {tenant_access_token}
   body: { receive_id, msg_type: "text", content: JSON.stringify({ text }) }   ← content 为字符串化 JSON
   成功: code=0
```

- 令牌缓存：进程内，按 `expire` 自动过期续取（research R2）；发送遇凭证类错误清缓存重试一次。
- 具体业务错误码映射表在实现任务中按开放平台文档核对后固化（research R1 实现期核对项）。

## 错误分类映射（五码体系不变，细化在 message）

| 场景 | errorCode | message 指引（静态文案，脱敏） |
| --- | --- | --- |
| 凭证无效/失效 | `AUTH_INVALID` | 检查开放平台应用凭据 |
| 缺权限/应用未发布版本 | `AUTH_INVALID` | 开通 `im:message` 权限并发布应用版本 |
| 机器人不在会话/目标不存在 | `CONTENT_REJECTED` | 将应用机器人加入目标会话或检查接收目标 |
| 网络故障 | `NETWORK_UNREACHABLE` | 复用既有文案 |
| 接口限流 | `RATE_LIMITED_REMOTE` | 稍后重试 |

所有 message 不包含 `appSecret`、令牌、原始响应体（FR-106，错误信息一律脱敏）。

## Compatibility Rules/兼容性规则

- 新增标志、凭据新增字段均为可选新增；旧 Webhook 配置与既有测试行为零回归（SC-104）。
- `--json` 输出新增字段（如 `mode`）保持可选；解析方须忽略未知字段。
- 若未来飞书废弃 `content` 字符串化约定或令牌接口响应结构变化，仅影响适配器内部实现，不影响本契约。
