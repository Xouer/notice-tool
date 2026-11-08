# Quickstart: Fix Task Completion Notification Content/快速验证指南：修复任务完成通知内容

**Date/日期**: 2026-11-08 | **Spec/规格**: [spec.md](spec.md) | **Plan/计划**: [plan.md](plan.md)

本指南定义实现完成后可立即运行的端到端验证场景，证明通知内容缺陷已修复。契约细节见 [contracts/notification-content.md](contracts/notification-content.md)，渲染语义见 [data-model.md](data-model.md)。

## Prerequisites/前置条件

- Node.js ≥ 22 LTS 与包管理器。
- 一个可用的**飞书群机器人 Webhook 地址**（演示渠道；其他渠道同理）。

## Setup/安装与初始化

```text
npm install
npm run build
notice init                       # 初始化数据目录、数据库与默认模板
notice channel add feishu         # 交互式输入 Webhook 地址
notice channel test feishu
```

**Expected/预期结果**: 测试消息送达，验证渠道可用。

## Scenario A: Title & Summary & Time/场景 A：标题、时间、概要（核心缺陷）

```text
echo '{"schemaVersion":1,"source":"codebuddy","taskId":"0c489af57ca84e9599e46cf2da32a945","title":"修复登录页样式问题","result":"success","finishedAt":"2026-11-08T04:15:47.269Z"}' | notice hook
```

**Expected/预期结果**（飞书收到）：

```text
【任务完成通知】
标题：修复登录页样式问题
任务 0c489af57ca84e9599e46cf2da32a945（来源 codebuddy）已结束
结果：success
结束时间：2026-11-08 12:15:47
概要：任务成功完成
```

1. 首行出现可读标题（US1 / FR-001）。
2. 结束时间已从 `04:15:47`（UTC）换算为本地 `12:15:47`（UTC+8），且为人类可读格式（US2 / FR-004）。
3. 未提供概要时，"概要："不再为空，而是显示"任务成功完成"（US3 / FR-006）。

## Scenario B: Title Fallback/场景 B：标题兜底

```text
echo '{"schemaVersion":1,"source":"codebuddy","taskId":"0c489af57ca84e9599e46cf2da32a945","result":"failure"}' | notice hook
```

**Expected/预期结果**: 标题显示 `codebuddy · 0c489a`（来源 + 任务标识前 6 位），概要显示"任务失败"——即便来源未提供 `title` 与 `resultSummary` 也能识别任务并读到结论（US1/FR-002、US3/FR-006）。

## Scenario C: Fixed Format Across Channels/场景 C：跨渠道固定格式

```text
notice channel add email          # 配置一个邮箱渠道并启用
echo '{"schemaVersion":1,"source":"claude-code","taskId":"task-002","title":"重构去重模块"}' | notice hook
```

**Expected/预期结果**: 飞书与邮箱收到的通知结构一致（标题 → 任务标识 → 结果 → 时间 → 概要），仅渠道适配差异（US4 / FR-007）。

## Scenario D: Backward Compatibility/场景 D：向后兼容

```text
echo '{"schemaVersion":1,"source":"codebuddy","taskId":"task-003"}' | notice hook
notice template list              # 确认默认模板含 {{title}} 占位符
```

**Expected/预期结果**: 旧负载（无 `title`）仍被接受并生成合法通知（走兜底标题与兜底概要）；升级后的默认模板包含 `{{title}}` 且结构固定；用户自定义模板不受覆盖（FR-008 / research R5）。

## Automated Tests/自动化验证

```text
npm test
```

**Expected/预期结果**: 单测（标题兜底、本地时间格式化、概要兜底、模板白名单）、契约测试（负载含/不含 title、默认格式）、集成测试（端到端断言最终通知文本）全部通过（宪法原则 II）。
