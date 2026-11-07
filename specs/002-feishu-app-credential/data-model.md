# Data Model: Feishu App Credential Channel/数据模型：飞书应用凭证消息通道（增量）

**Feature**: [spec.md](spec.md) | **Plan**: [plan.md](plan.md) | **Date**: 2026-11-07

本特性**不新增表、不修改既有表结构**。四实体（notification_channels / task_events / notification_records / notification_templates）与 001 [data-model](../001-agent-task-notify/data-model.md) 完全一致。增量仅在飞书渠道凭据的**内容结构**与**访问令牌的内存生命周期**两处。

## 1. 渠道凭据结构（notification_channels.credentials_blob 内的 JSON）

### 飞书 · 应用凭证模式（本特性新增）

```json
{
  "schemaVersion": 1,
  "mode": "app",
  "appId": "cli_a1b2c3d4e5f6",
  "appSecret": "<明文仅在内存，入库前整体 AES-256-GCM 加密>",
  "receiveIdType": "chat_id",
  "receiveId": "oc_1234567890abcdef"
}
```

| 字段 | 必填 | 校验规则（channel-config.ts feishu 分支） |
| --- | --- | --- |
| `mode` | 是（新配置） | 枚举 `app \| webhook`；**缺省视为 `webhook`**（旧数据零迁移，R6） |
| `appId` | mode=app 时 | 非空字符串 |
| `appSecret` | mode=app 时 | 非空字符串 |
| `receiveIdType` | mode=app 时 | 枚举 `chat_id \| open_id \| user_id \| email` |
| `receiveId` | mode=app 时 | 非空字符串 |
| `webhookUrl` | mode=webhook 时 | 沿用既有 http/https URL 校验，不变 |

### 飞书 · Webhook 模式（既有，不变）

```json
{ "schemaVersion": 1, "mode": "webhook", "webhookUrl": "https://open.feishu.cn/open-apis/bot/v2/hook/xxx" }
```

- 切换模式（spec FR-104）：以 add 重新提交或后续扩展 update 命令实现，两种凭据结构互斥存储于同一列。

### 掩码摘要（summarizeCredentials，list/test 输出）

| 模式 | 摘要 |
| --- | --- |
| app | `appId 掩码 → receiveId 掩码`（`appSecret` 永不出现） |
| webhook | 沿用既有 `maskSecret(webhookUrl)` |

## 2. 访问令牌/Access Token（内存态，不入库）

```text
TokenEntry {
  tenantAccessToken: string   // Bearer 头用
  expiresAt: number           // 毫秒 = 获取时刻 + expire*1000 - 5min 保险余量
}
```

- **缓存**: 进程内 `Map<appId, TokenEntry>`（模块级单例，随进程退出销毁）。
- **生命周期**: 获取 → 使用 → 过期（被动续取）→ 失效（消息接口凭证类错误时清空并重取一次）。
- **禁止**: 不写数据库、不写配置文件、不进日志与错误 message（spec FR-103/FR-106、research R2/R7）。

## 3. 实体关系与状态机（无变化）

- 通知记录、任务结束事件、去重冷却窗口、防轰炸令牌桶逻辑**原样复用**——凭证渠道只是 `ChannelAdapter.send()` 的另一种实现路径（spec FR-108 链路一致性）。
- `notification_records.last_error_code` 仍为既有五码枚举（research R4）。

## 4. Security & Data Protection/安全要点

- 新增敏感面仅两处：`appSecret`（加密列）与 `tenantAccessToken`（纯内存）。均不得出现在日志、错误信息、通知内容、导出数据（FR-106）。
- 假服务集成测试注入的假凭证/假令牌不含真实格式前缀，防止与生产数据混淆。
