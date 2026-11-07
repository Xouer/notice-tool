# Quickstart: Agent Task Completion Notification/快速验证指南：智能体任务完成通知

**Date/日期**: 2026-11-07 | **Spec/规格**: [spec.md](spec.md) | **Plan/计划**: [plan.md](plan.md)

本指南定义可在实现完成后立即运行的端到端验证场景，证明特性可用。契约细节见 [contracts/](contracts/)，数据结构见 [data-model.md](data-model.md)。

## Prerequisites/前置条件

- Node.js ≥ 22 LTS 与包管理器（npm/pnpm 均可）。
- 一个可用的**飞书群机器人 Webhook 地址**（演示渠道；其他渠道同理，见 [contracts/cli.md](contracts/cli.md)）。
- （仅场景 D 需要）任一支持 MCP 的客户端（IDE、智能体或 MCP 调试器）。

## Setup/安装与初始化

```text
npm install
npm run build
npm link            # 获得 notice 全局命令（可选，也可以 node dist/cli.js 代替）

notice init         # 初始化数据目录、数据库与默认模板
notice channel add feishu    # 交互式输入 Webhook 地址（即时加密入库）
notice channel test feishu
```

**Expected/预期结果**: `notice channel test feishu` 显示发送成功，且**飞书群收到测试消息**——验证 US1（渠道配置与测试发送）。

## Scenario A: Hook stdin End-to-End/场景 A：钩子端到端（US2 核心）

```text
notice serve &      # 常驻服务（也可跳过，CLI stdin 可独立完成）
echo '{"schemaVersion":1,"source":"demo","taskId":"task-001","result":"success","resultSummary":"演示任务结束"}' | notice hook
notice history --limit 5
```

**Expected/预期结果**:
1. 飞书群收到一条按默认模板渲染的"任务完成"通知（含任务标识、结束时间、结果状态）。
2. `notice history` 显示一条 `sent` 状态的通知记录，关联事件 `task-001`（FR-011）。
3. **再次发送同一 `taskId`**（10 分钟内）：不再收到通知，事件被标记为重复（FR-007 去重，验证 SC-003）。

## Scenario B: HTTP Hook Endpoint/场景 B：HTTP 钩子端点

```text
notice serve                 # 默认监听 127.0.0.1:47650
curl -X POST http://127.0.0.1:47650/v1/hooks/task-completed \
  -H "Content-Type: application/json" \
  -d '{"schemaVersion":1,"source":"demo","taskId":"task-002","result":"failure"}'
```

**Expected/预期结果**: 返回 `202` 与 `{"eventId":"...","deduplicated":false}`；飞书收到通知且结果状态为 `failure`（验证边界情况"如实反映结果状态"）。发送非法负载（缺 `source`）应返回 `400 VALIDATION_FAILED`。

## Scenario C: Failure & Retry Visibility/场景 C：失败与重试可见性

```text
notice channel add feishu    # 故意输入一个无效 Webhook
echo '{"schemaVersion":1,"source":"demo","taskId":"task-003"}' | notice hook
notice history --status failed
notice history resend <recordId>   # 修正渠道凭据后手动重发
```

**Expected/预期结果**: 失败记录含明确错误分类（如 `AUTH_INVALID`）且不含任何凭据明文（FR-008/FR-012）；修正凭据并重发后状态转为 `sent`。

## Scenario D: MCP Capability/场景 D：MCP 能力（US4）

在任一 MCP 客户端中将本工具注册为 stdio 服务（命令 `notice mcp`），然后：

1. 列出工具 → 应发现且仅发现 `send_notification` 与 `report_task_end`（白名单，见 [contracts/mcp-tools.md](contracts/mcp-tools.md)）。
2. 调用 `report_task_end`（传 `source=demo, taskId=task-101`）→ 飞书收到通知，返回 `eventId`。
3. 调用 `send_notification`（传 `message="构建完成"`）→ 飞书收到即时通知，返回逐渠道投递结果。

**Expected/预期结果**: 覆盖 SC-006（外部工具可发现并调用，通知送达）。

## Scenario E: Polling Without Hooks/场景 E：无钩子巡查（US3）

```text
# 在 config.json 的 polling.adapters 中注册 generic-file 适配器：
#   指向一个演示状态文件，完成特征正则如 "status=completed"
notice watch
# 向该状态文件追加一行 "status=completed"
```

**Expected/预期结果**: 下一巡查周期（默认 10 秒）内飞书收到通知；对不可读的适配器配置，`notice watch` 打印明确的不支持提示而非静默失败（FR-002 场景 3）。

## Automated Tests/自动化验证

```text
npm test
```

**Expected/预期结果**: 单测、契约测试、集成测试全部通过（宪法原则 II：任务实现须以测试先行，本命令为合入门槛之一）。
