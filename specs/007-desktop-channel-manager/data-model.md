# Data Model/数据模型: Desktop Channel Manager/桌面渠道管理工具

**Date**: 2026-11-08 | **Feature**: [spec.md](spec.md)

本功能不修改数据库 schema、不新增持久化表、不迁移既有数据。桌面端引入的是进程内逻辑模型与 IPC 传输对象，全部复用现有 `notification_channels`、`task_events`、`notification_records` 与 `config.json`。

## Persistence Reuse/持久化复用

- **notification_channels**：渠道类型、名称、启用状态与密文凭据不变；GUI 的列表与表单读写同一张表。
- **notification_records**：注册信息页的“最近接入信号”按 `task_events.source_agent` 关联最近通知结果，只读查询。
- **config.json**：服务端口、巡查与保留策略沿用现有配置；GUI 不写入该文件。
- **secret.key**：继续由 Windows DPAPI 保护，GUI 主进程读取，渲染进程不可见。

## Service Status/服务状态

`ServiceState` 为有限状态机，不持久化：

| 状态     | 含义                         | 可执行操作            |
| -------- | ---------------------------- | --------------------- |
| stopped  | 应用内服务未运行             | start                 |
| starting | 正在启动                     | 禁用按钮              |
| running  | 应用内服务运行中             | stop                  |
| stopping | 正在停止                     | 禁用按钮              |
| external | 外部 `notice serve` 占用端口 | 刷新；不可由 GUI 停止 |
| error    | 启动/停止失败                | 重试、查看原因        |

- 状态变化必须广播给渲染进程，窗口恢复时以实际状态为准。
- `external` 满足“外部服务运行”边界情况；GUI 尝试启动时返回端口占用错误并提示用户在外部进程停止。

## Channel DTOs/渠道传输对象

渲染进程永远不接收明文凭据。

- **ChannelSummary**：`id`、`type`、`name`、`mode`（可推导）、`enabled`、`credentialsSummary`（掩码）、`updatedAt`。
- **ChannelDraft**：新增表单数据，包含类型、名称、连接方式与凭据字段；仅在保存时发送给主进程。
- **ChannelUpdatePatch**：
  - `name?`：可选新名称；
  - `mode?`：可选新连接方式；
  - `credentialFields`：每个字段独立声明 `keep | replace | clear`，`replace` 携带新值；
  - 必填字段禁止 `clear`，主进程校验后整体合并。
- **ChannelTestResult**：`channelId`、`state`（pending/succeeded/failed/timed-out）、`errorCode?`、`message`（脱敏）、`autoEnabled`、`startedAt/finishedAt`。

## Registration Information/注册信息

`AgentRegistrationInfo` 为只读视图：

- `agentId`：`codebuddy | claude-code | codex-cli`；
- `registrationState`：`not-registered | registered-valid | registered-invalid | read-failed`；
- `scope`：`global | project | unknown`；
- `lastSignalAt/lastSignalResult`：来自该来源最近一次任务结束事件的通知结果；
- `readError`：仅 `read-failed` 时出现，内容脱敏。

注册状态只描述配置是否存在且形态有效，不表示智能体进程或通知服务运行状态。

## IPC Event Model/IPC 事件模型

- `service:status-changed`：主进程 → 渲染进程，负载为 `ServiceState` 与脱敏错误说明。
- `channels:test-progress`：主进程 → 渲染进程，负载为测试中间态，防止重复提交。
- 其余交互均为请求/响应，不建立渲染进程主动访问文件或数据库的通道。

## Invariants/不变量

- 渠道 `(type, name)` 唯一约束、默认未启用、测试成功自动启用语义与 CLI 完全一致。
- 明文凭据只允许存在于主进程内存中的瞬时表单负载与解密发送瞬间，不得进入日志、渲染进程持久状态或错误消息。
- GUI 浏览页面不写数据库；只有保存、修改、测试和启停操作可改变状态。
