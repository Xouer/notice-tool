# Contract/契约: Desktop IPC/桌面进程通信

**Date**: 2026-11-08 | **Feature**: [spec.md](../spec.md) | **Data Model**: [data-model.md](../data-model.md)

## Security Model/安全模型

- 渲染进程：`nodeIntegration: false`、`sandbox: true`、无 Node/文件/网络直访。
- Preload：仅通过 `contextBridge` 暴露命名空间 `noticeDesktop`，通道白名单固定。
- 主进程：唯一拥有数据库、DPAPI、渠道适配器与服务运行时的进程。
- 所有 IPC 响应与错误信息经过 `redactSensitive` 等价处理，不携带明文凭据或完整敏感路径。

## Service API/服务接口

```ts
noticeDesktop.service.getStatus(): Promise<ServiceSnapshot>;
noticeDesktop.service.start(): Promise<ServiceStartResult>;
noticeDesktop.service.stop(): Promise<ServiceStopResult>;
noticeDesktop.onServiceStatusChanged(callback: (snapshot: ServiceSnapshot) => void): Unsubscribe;
```

## Channel API/渠道接口

```ts
noticeDesktop.channels.list(): Promise<ChannelSummary[]>;
noticeDesktop.channels.create(draft: ChannelDraft): Promise<ChannelSummary>;
noticeDesktop.channels.update(id: string, patch: ChannelUpdatePatch): Promise<ChannelSummary>;
noticeDesktop.channels.test(id: string): Promise<ChannelTestResult>;
noticeDesktop.channels.getFieldSchema(type: ChannelType, mode: ChannelMode): Promise<ChannelFieldSchema[]>;
```

- `create/update` 失败返回字段级错误；主进程按现有 `validateChannelInput` 规则校验，失败不写库。
- `update` 的敏感字段采用 `keep | replace | clear` 三态；`clear` 仅允许可选字段。
- `test` 对同一 `channelId` 设置进行中锁；锁定期间重复调用返回当前 pending 结果，不重复发送。
- 测试成功沿用现有规则 `setEnabled(true)`；自动启用失败时返回 `autoEnabled: false` 并保留送达结果。

## Registration API/注册信息接口

```ts
noticeDesktop.registration.list(): Promise<AgentRegistrationInfo[]>;
noticeDesktop.registration.refresh(): Promise<AgentRegistrationInfo[]>;
```

- 只读；不提供写入、启用或停用钩子配置的 IPC。
- 读取失败转换为 `read-failed` 状态，不中断其他智能体条目展示。

## Error Envelope/错误封装

```ts
interface DesktopIpcError {
  code: string;
  message: string;
  field?: string;
}
```

- 字段错误必须携带 `field`，用于表单定位。
- 未知错误统一 `INTERNAL`，消息脱敏并保留可执行排查建议。

## UI Style Tokens/界面风格约定

- 左侧固定导航：首页、注册信息、通知渠道；右侧内容卡片化。
- 状态徽标颜色语义：运行/成功、停止/失败、进行中、外部/未知。
- 敏感输入控件默认掩码，摘要仅显示脱敏值。
- 空状态提供下一步主操作，不展示误导性正常状态。
