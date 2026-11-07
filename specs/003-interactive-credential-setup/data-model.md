# Data Model: Interactive Channel Setup Wizard/数据模型：交互式渠道配置向导

**Feature**: 003-interactive-credential-setup | **Date**: 2026-11-07 | **Spec**: [spec.md](spec.md)

本特性**无存储结构变更**：向导是既有"通知渠道配置"实体的另一种创建入口（FR-009）。以下仅定义向导运行期的内存结构与其到既有实体的映射。

## Entities/实体

### 1. Wizard Session（向导会话，仅内存，不落盘）

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `step` | `"type" \| "mode" \| "fields" \| "confirm" \| "duplicate"` | 当前状态机位置 |
| `type` | `ChannelType \| undefined` | 已选/预选渠道类型（`feishu\|dingtalk\|email\|wechat\|qq`，复用 `src/storage/schema.ts` 枚举） |
| `mode` | `string \| undefined` | 已选连接方式（feishu: `app\|webhook`；wechat: `webhook\|push`；qq: `official\|push`；dingtalk/email 无此步） |
| `values` | `Record<string, string>` | 已收集字段值（键为字段目录字段名，含用户输入与默认值） |
| `fieldIndex` | `number` | `fields` 阶段游标（支持"上一步"） |
| `defaults` | `string[]` | 使用了默认值的字段名（确认摘要标注来源） |

生命周期：向导启动时创建 → 确认时转为 `ValidatedChannel` 写入 → 取消/中断即丢弃。**敏感值以明文仅存在于本结构内存中，不写日志、不序列化落盘**（FR-010）。

### 2. Field Catalog Entry（字段目录项，静态定义，驱动 `fields` 阶段）

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `key` | `string` | 凭据字段名（与 `validateChannelInput` 的键一致，如 `appId`、`appSecret`、`webhookUrl`） |
| `label` | `string` | 人读字段名（如"App ID"） |
| `hint` | `string` | 含义 + 格式示例/前缀 + 获取方法提示（FR-004） |
| `secret` | `boolean` | 是否敏感输入（true → `askSecret`，不回显明文） |
| `required` | `boolean` | 必填性（可选项跳过走默认/留空） |
| `kind` | `"text" \| "choice"` | 输入形态；`choice`（如 `receiveIdType`、`service`）转编号选择 |
| `choices` | `readonly string[]` | `kind=choice` 时的候选（与校验枚举一致） |
| `lightCheck` | `(v: string) => string \| undefined` | 轻量即时校验（FR-005）：返回错误文案或 undefined |

字段目录按 `(type, mode)` 组织，与既有 `validateChannelInput` 各分支的字段集一一对应（唯一事实来源仍为该校验函数，目录仅负责提示与收集顺序，终验兜底，见 research R4）。

### 3. 向导产物 → 既有实体映射/Mapping to Existing Entity

```text
Wizard Session(draft) ──确认──▶ { type, name, credentials }
                                   │
                                   ├─ name: values.name ?? `${type}-${YYYYMMDD-HHmmss}`
                                   ├─ credentials: 复用 validateChannelInput(type, name, values)
                                   │               （附 schemaVersion: 1，整体加密入 credentials_blob）
                                   └─ 写入: ChannelRepository.create（唯一写入点）
```

无新增字段、无新增表、无迁移；`notification_channels` 的唯一索引（type 内 name 唯一）与加密管线原样生效。

## State Transitions/状态转换

```text
(start)
   │ type 已预选？──否──▶ [type] ──选类型──▶ ┐
   │                    是──────────────────┤
   ▼                                        ▼
(mode) ── 单方式渠道自动跳过 ──▶ (fields: 逐字段，lightCheck 失败原地重试)
   │                                        │
   │        任一步骤选 b(上一步) ────────────┘（保留已输入值回退一格）
   ▼
(confirm: 脱敏摘要) ──确认──▶ (duplicate: findByName 冲突？)
   │                            ├─ 否 ──▶ save（repo.create → 退出码 0）
   │                            ├─ 改名/覆盖（显式确认）──▶ save
   │                            └─ 取消 ──▶ cancel
   └─ 取消（或 Ctrl+C，任意步骤）──▶ cancel（退出码 0，零落盘）
```

## Validation Rules Summary/校验规则摘要（继承 + 新增）

| 规则 | 来源 | 层 |
| --- | --- | --- |
| type 枚举、name 非空/≤64/唯一、URL http(s)、各模式字段完整性 | 既有 `validateChannelInput`（不变） | 终验 + 仓储 |
| 单步非空/URL/枚举/整数端口 | 新增字段目录 `lightCheck` | 向导即时 |
| 敏感输入不回显、会话不落盘、取消即弃 | 新增（FR-004/FR-007/FR-010） | WizardIO + 引擎 |

## Security Notes/安全要点（宪法原则 IV）

- **数据类型**：无新增；会话临时持有既有凭据明文（仅内存）。
- **访问主体**：仅本机用户本人。
- **授权模型**：无新增权限。
- **脱敏与销毁**：确认摘要用既有 `summarizeCredentials` 语义脱敏；取消/中断时草稿随对象释放；全程不经 `ctx.out/err` 输出明文（错误信息复用 `redactSensitive` 管线）。
