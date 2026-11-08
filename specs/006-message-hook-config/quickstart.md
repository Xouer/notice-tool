# Quickstart/快速开始: Cross-Platform Message Hook Configuration/跨平台消息钩子配置

**Feature/功能**: Cross-Platform Message Hook Configuration/跨平台消息钩子配置

**Date/日期**: 2026-11-08

## Prerequisites/前置条件

- 已安装 Node.js >=22 并完成项目依赖安装。
- 至少配置一个可用通知渠道，并可接收测试消息。
- 目标智能体已安装且配置文件可写。
- 使用独立数据目录进行验证，避免影响真实配置。

## Setup/准备

1. 在临时目录中初始化 NoticeTool 数据目录。
2. 添加并启用一个通知渠道（沿用现有 `notice channel add` 流程）。
3. 运行 `notice hook-config list --json`，确认九种内置模板全部显示为“不启动”。

## Validation Scenarios/验证场景

### 1. View Templates/查看模板

```bash
notice hook-config list --platform windows --json
notice hook-config show windows-codebuddy --json
```

**Expected Outcome/预期结果**:

- 列表包含 CodeBuddy、Claude Code、Codex CLI 三条 Windows 模板。
- 所有模板状态为 `false`。
- 查看操作不修改任何目标配置文件。

### 2. Enable a Template/启用模板

```bash
notice hook-config enable windows-codebuddy --confirm --json
```

**Expected Outcome/预期结果**:

- 命令返回 `enabled: true`。
- 目标配置文件中新增 `notice hook --source codebuddy`。
- 其他模板与通知渠道状态不变。

### 3. Trigger End-to-End Notification/触发端到端通知

```bash
notice hook --source codebuddy
```

随后输入一条模拟的 CodeBuddy Stop 负载（JSON）。可在负载中提供可选 `eventKey`；同一对话的第二次 Stop 应使用不同 `eventKey`。

**Expected Outcome/预期结果**:

- 单轮问答与多步骤任务的模拟 Stop 均触发一次任务通知。
- `notice history events` 记录事件与触发方式；同一稳定 `eventKey` 重复上报显示 `duplicated` 且不新增渠道记录。
- 不同 `eventKey` 各自通知，即使 `taskId` 相同。

### 4. Disable a Template/停用模板

```bash
notice hook-config disable windows-codebuddy --json
```

**Expected Outcome/预期结果**:

- 命令返回 `enabled: false`。
- 目标配置中不再包含 NoticeTool 写入的钩子。
- 其他用户自定义配置保持不变。

## Cleanup/清理

- 删除临时数据目录。
- 若使用了真实智能体配置，执行 `notice hook-config disable` 后再清理文件。
