# Contract: Hook Receiver/契约：钩子接收接口

**Version/版本**: 1 (2026-11-07) | **Spec/规格**: [spec.md](../spec.md) | **Data Model/数据模型**: [data-model.md](../data-model.md)

本工具接收任务结束事件的两个入口（研究决策 R4），共享同一负载结构与校验管线。契约遵循宪法原则 III：破坏性变更须声明影响面并升 MAJOR 版本，新增字段一律可选。

## Entry 1: CLI stdin Mode/入口一：CLI 标准输入模式

面向以 shell 命令注册钩子的智能体（如 Claude Code hooks）。智能体在其钩子配置中执行：

```text
notice hook [--config <path>]
```

- 从**标准输入**读取 UTF-8 JSON 负载，校验、落库并触发通知后退出。
- 退出码：`0` 成功；`2` 负载校验失败（stderr 输出机器可读错误 JSON）；`3` 本地服务/存储异常。
- 适用于"任务结束钩子"场景的推荐注册形态（具体智能体的注册示例见 quickstart.md）。

## Entry 2: HTTP Endpoint/入口二：本地 HTTP 端点

常驻服务 `notice serve` 监听本地回环地址（默认 `127.0.0.1`，端口可配），暴露：

```text
POST /v1/hooks/task-completed
Content-Type: application/json
```

- 请求体为下述负载；响应见"Responses/响应"。
- 仅接受回环/本机来源连接（不对外网暴露）。

## Payload Schema/负载结构（两入口一致）

```json
{
  "schemaVersion": 1,
  "source": "claude-code",
  "taskId": "session-abc123",
  "finishedAt": "2026-11-07T10:30:00.000Z",
  "result": "success",
  "resultSummary": "修复了登录页样式问题（3 个文件）",
  "trigger": "hook"
}
```

| 字段 | 必填 | 类型 | 说明 |
| --- | --- | --- | --- |
| `schemaVersion` | 是 | 整数 | 负载结构版本，当前 `1` |
| `source` | 是 | 字符串（≤64） | 来源智能体标识 |
| `taskId` | 是 | 字符串（≤256） | 任务/会话标识 |
| `finishedAt` | 否 | ISO 8601 字符串 | 缺省取服务端接收时间 |
| `result` | 否 | 枚举 | `success` / `failure` / `interrupted` / `unknown`，缺省 `unknown` |
| `resultSummary` | 否 | 字符串（≤500） | 结束概要；**不得**含代码正文与密钥（接收侧亦做长度与敏感模式过滤） |
| `trigger` | 否 | 枚举 | `hook` / `polling` / `mcp`，CLI/HTTP 入口缺省 `hook` |

**Validation/校验**: JSON Schema 校验（Fastify 内建；CLI 入口复用同一 Schema 对象）。任何非法负载整体拒绝——不猜测、不部分接受。

## Responses/响应（HTTP 入口）

| 状态码 | 场景 | 响应体 |
| --- | --- | --- |
| `202` | 事件已受理（含判定为重复——重复亦返回 202 并在体中注明 `deduplicated: true`） | `{"eventId": "...", "deduplicated": false}` |
| `400` | 负载校验失败 | `{"error": "VALIDATION_FAILED", "details": [...]}` |
| `429` | 触发频率超限（FR-013 防滥用） | `{"error": "RATE_LIMITED", "retryAfterMs": 60000}` |
| `500` | 内部错误 | `{"error": "INTERNAL", "details": "脱敏后摘要"}` |

## Error Codes/错误码（机器可读）

`VALIDATION_FAILED` / `RATE_LIMITED` / `INTERNAL`。错误响应不包含凭据、原始负载回显或堆栈细节。

## Compatibility Rules/兼容性规则

- 字段仅做**可选新增**；枚举值只增不改义；`schemaVersion` 不匹配且无法向前解析时返回 `400` 并注明版本要求。
- 响应体新增字段同样保持可选，调用方不得依赖未声明字段。
