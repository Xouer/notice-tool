# Quickstart: Interactive Channel Setup Wizard/快速开始：交互式渠道配置向导验证指南

**Feature**: 003-interactive-credential-setup | **Date**: 2026-11-07

验证向导特性端到端可用。实现细节见 [plan.md](plan.md) 与 [contracts/wizard.md](contracts/wizard.md)；数据结构见 [data-model.md](data-model.md)。

## 前置条件/Prerequisites

- Node.js ≥ 22、依赖已安装（`npm ci`）。
- 验证用独立数据目录（避免污染真实数据）：PowerShell 设置 `NOTICE_DATA_DIR` 指向临时目录，验证结束后删除该临时目录。

## 自动化验证/Automated Verification

```bash
npm test          # 全量 vitest：含 wizard 单测/集成用例与既有回归（SC-004 门禁）
npm run lint
npm run build
```

预期：全部通过；既有 `channel add` 标志路径契约测试零改动通过。

## 手动端到端验证（飞书应用凭证，对应 SC-001/SC-002）/Manual E2E

1. **触发向导**：确保终端为交互式，运行 `notice channel add`（无任何参数）。
   预期：第 1 步列出 5 类渠道及用途说明。
2. **选择输入类型**：输入飞书对应序号。预期：第 2 步列出"应用凭证（推荐）/群机器人 Webhook"及说明。
3. **选择输入方式**：选择"应用凭证"。预期：第 3 步开始逐项提示渠道名称（可空，默认生成）、App ID、App Secret（输入时**仅显示星号掩码**）、接收目标类型（编号选择）、接收目标 ID；每项有含义/示例/获取方法提示。
4. **即时校验**：在 App ID 步骤直接回车提交空值。预期：提示"不能为空"并要求重输，流程不中断。
5. **返回上一步**：在接收目标 ID 步骤输入 `b`。预期：回到接收目标类型选择，且 App Secret 无需重输。
6. **确认摘要**：走完字段后检查摘要——App Secret 等敏感值以 `***` 展示，明文零出现。
7. **确认保存**：选择确认。预期：输出与既有 add 一致的"渠道已添加"；`channel list` 中出现该渠道且凭据掩码。
8. **等价性验证**：`notice channel test <名称>` 成功送达即自动启用（与标志方式配置的渠道行为一致）。

## 边界与取消验证/Edge Cases

- **取消零落盘（SC-003）**：向导中途输入 `0` 取消 → 输出"已取消，未做任何更改"；`channel list` 记录数不变。
- **重名冲突**：用已存在名称走完向导 → 提示冲突，选择"重新输入名称"后可保存；不静默覆盖。
- **非交互拒绝（FR-008）**：以管道喂入 stdin（非 TTY）运行 `channel add` → 退出码 2，提示需要交互终端并指引标志方式。
- **`--json` 不弹向导（R8）**：`notice --json channel add feishu`（缺凭据）→ 退出码 2，无交互提示输出。
- **既有路径回归（FR-009）**：完整标志命令（见 README 飞书示例）行为与输出和 002 特性验收一致。
