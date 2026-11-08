# Data Model/数据模型: Cross-Platform Message Hook Configuration/跨平台消息钩子配置

**Feature/功能**: Cross-Platform Message Hook Configuration/跨平台消息钩子配置

**Date/日期**: 2026-11-08

## Entities/实体

### HookTemplateDefinition/钩子模板定义

内置的静态模板，随代码发布，不落库。

| 字段 | 类型 | 说明 |
|------|------|------|
| id | string | 模板唯一标识，如 `windows-codebuddy` |
| platform | enum | `linux` / `macos` / `windows` |
| agent | enum | `codebuddy` / `claude-code` / `codex-cli` |
| version | string | 模板内容版本 |
| eventName | string | 目标事件，如 `Stop` 或等价通知事件 |
| configTarget | object | 目标配置文件位置与写入范围 |
| defaultContent | JSON object | 生成目标配置片段的默认内容 |

### HookTemplateInstance/钩子模板实例

用户采用模板后产生的持久化状态，保存于 SQLite。

| 字段 | 类型 | 说明 |
|------|------|------|
| id | integer | 实例唯一标识 |
| templateId | string | 关联 `HookTemplateDefinition.id` |
| platform | enum | 同模板平台 |
| agent | enum | 同模板智能体 |
| enabled | boolean | `true` 表示已启动，`false` 表示不启动 |
| customContent | JSON object | 用户确认后的自定义内容；未自定义时为空 |
| lastValidationResult | object | 最近一次验证结果，含状态、原因分类与时间 |
| createdAt / updatedAt | timestamp | 创建与更新时间 |

**Relationships/关系**: 一个模板定义在同一数据目录下最多对应一个实例；实例状态与通知渠道、通知历史相互独立。

**State Transitions/状态迁移**:

- `不启动` → `已启动`：用户确认启用，目标配置写入并通过验证。
- `已启动` → `不启动`：用户确认停用，目标配置中对应钩子移除。
- 重复启用或停用均为幂等操作，不产生重复配置。

### HookConfigResult/钩子配置结果

一次启用、停用或验证操作的输出。

| 字段 | 类型 | 说明 |
|------|------|------|
| templateId | string | 操作目标模板 |
| operation | enum | `enable` / `disable` / `validate` |
| status | enum | `success` / `failure` |
| failureCategory | enum | 无权限、目标缺失、内容无效、冲突、未知 |
| message | string | 用户可读结果；不含敏感路径明文 |
| timestamp | timestamp | 操作时间 |

### TaskCompletionEvent/任务结束事件

复用既有实体；008 起新增可选 `event_key` 表示一次稳定 Stop 事件身份。有键事件按 `source_agent + task_id + event_key` 判重，同会话不同 Stop 不合并；旧无键调用保留冷却去重。

## Validation Rules/校验规则

- 模板定义必须覆盖 3 个平台 × 3 个智能体，共 9 条记录。
- `enabled` 只能由用户操作改变；浏览、查看与升级不得隐式修改。
- 启用前必须校验目标配置文件存在性与可写性；冲突或无法识别的内容必须要求用户确认。
- 停用只移除本工具写入的钩子配置，不删除用户其他配置。
- `lastValidationResult` 失败时，`enabled` 不得显示为可用。
