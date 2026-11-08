# Contract/契约: Desktop Service Runtime/桌面服务运行时

**Date**: 2026-11-08 | **Feature**: [spec.md](../spec.md) | **Data Model**: [data-model.md](../data-model.md)

## Public API/公开接口

从 `src/cli/serve.ts` 提取 `ServiceRuntime`，CLI 与桌面 GUI 共用：

```ts
interface ServiceRuntime {
  start(): Promise<ServiceStartResult>;
  stop(): Promise<ServiceStopResult>;
  refresh(): Promise<ServiceSnapshot>;
}

type ServiceStartResult =
  { outcome: "started" } | { outcome: "external" } | { outcome: "failed"; reason: ServiceFailure };
```

- `start()` 幂等保护：`starting/running/stopping` 状态下重复调用直接返回当前快照，不并发启动。
- `stop()` 仅停止本运行时创建的 Fastify 服务、巡查调度器与清理定时器；`external` 状态不可停止。
- 停止顺序沿用现有 `serve`：清理定时器 → scheduler.stop → app.close；`store` 由运行时创建者关闭，避免 CLI 与 GUI 关闭语义分叉。

## State Semantics/状态语义

- `refresh()` 先探测 `http://127.0.0.1:{port}/health`；健康响应存在而本运行时未监听 → `external`。
- 端口被占用但健康探测失败 → `external`，附“状态未知（可能是旧版本或非 notice 服务）”提示，不尝试停止。
- 启动失败必须保留 `stopped` 或 `error` 状态与脱敏原因，不得停留在 `starting`。
- 所有状态变更通过回调广播，供 Electron 主进程转发 `service:status-changed`。

## Health Endpoint/健康端点

`src/hookserver/server.ts` 新增只读端点：

- `GET /health` → `200 { "status": "ok" }`。
- 无请求体、无鉴权（仅回环监听）、无敏感字段、不影响现有 POST 端点。
- 该端点为向后兼容的可选新增，满足宪法 III；旧版本无此端点时由调用方降级处理。

## Error Contract/错误契约

| 错误码               | 场景               | 用户可见提示要点                     |
| -------------------- | ------------------ | ------------------------------------ |
| PORT_IN_USE          | 回环端口被占用     | 可能已有外部服务，先停止外部进程     |
| CONFIG_INVALID       | 配置加载失败       | 指向配置文件并提示校验错误，不含凭据 |
| STORE_OPEN_FAILED    | 数据库打开失败     | 提示检查磁盘与权限，不泄露完整路径   |
| ADAPTER_START_FAILED | 巡查适配器启动失败 | 服务仍可运行，提示对应适配器失效     |

## Compatibility/兼容性

- `notice serve` 命令行为、退出码与输出保持不变，仅内部改为调用 `ServiceRuntime`。
- 无 schema 变更、无 CLI 参数变更、无现有 HTTP 端点变更。
