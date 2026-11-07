# Contract: MCP Tools/契约：MCP 工具

**Version/版本**: 1 (2026-11-07) | **Spec/规格**: [spec.md](../spec.md) | **Transport/传输**: stdio（v1，研究决策 R3/R9）

本工具作为 MCP 服务端暴露的**全部**能力（白名单，满足安全审查的授权模型）。外部 MCP 客户端接入后在工具列表中可发现以下工具。契约演进遵循宪法原则 III：破坏性变更升 MAJOR 并声明影响面；入参新增字段一律可选。

## Tool: send_notification/工具：发送通知

供外部工具直接发送一条即时通知（不关联任务结束事件）。

**Input Schema/输入结构**:

```json
{
  "schemaVersion": 1,
  "title": "构建完成",
  "message": "前端构建已结束，产物 12.4 MB",
  "channels": ["feishu", "email"]
}
```

| 字段 | 必填 | 类型 | 说明 |
| --- | --- | --- | --- |
| `schemaVersion` | 是 | 整数 | 当前 `1` |
| `message` | 是 | 字符串（≤2000） | 通知正文 |
| `title` | 否 | 字符串（≤100） | 标题（支持的渠道展示，不支持时并入正文） |
| `channels` | 否 | 渠道类型数组 | 缺省发送至全部已启用渠道 |

**Output/输出**: `{"delivered": [...], "failed": [{"channel": "...", "errorCode": "..."}]}`——逐渠道结果，供调用方感知失败。

**Behavior/行为**: 复用与本地钩子一致的通知管线（模板按通用默认、限流与重试同策略）；失败分类码与通知记录一致（见 [cli.md](cli.md) 错误码节）。

## Tool: report_task_end/工具：上报任务结束事件

供外部工具转发其自身钩子触发的任务结束消息，走与本地钩子完全一致的流程（FR-010）。

**Input Schema/输入结构**: 与 [hook-receiver.md](hook-receiver.md) 负载结构**完全一致**（`schemaVersion`/`source`/`taskId`/`finishedAt`/`result`/`resultSummary`），`trigger` 固定为 `mcp`（调用方传入值被覆盖）。

**Output/输出**: `{"eventId": "...", "deduplicated": false}`；去重语义与本地钩子一致（同一 `(source, taskId)` 在冷却窗口内仅触发一轮通知）。

**Behavior/行为**: 校验失败返回 MCP 工具执行错误（错误码与 hook-receiver 一致：`VALIDATION_FAILED` / `RATE_LIMITED` / `INTERNAL`），不落库。

## Security Rules/安全规则

- 不提供读取凭据、读取历史明细、修改渠道配置的工具（最小暴露）。
- 输入长度与频率受校验与限流约束（FR-013）；超限返回 `RATE_LIMITED`。
- 工具输出不含凭据、不含原始负载回显。

## Compatibility Rules/兼容性规则

- 工具名称、必填字段、枚举值为稳定契约；`channels` 数组中的渠道类型仅增不减。
- 新工具的加入不视为破坏性变更。
