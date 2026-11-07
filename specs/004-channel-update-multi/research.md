# Research: Channel Config Update & Multi-Config/调研：渠道配置修改与同类型多条配置

**Feature**: 004-channel-update-multi | **Date**: 2026-11-07 | **Spec/规格**: [spec.md](spec.md)

本特性为既有代码库的能力增强，所有技术未知点均围绕"复用既有机制"展开；零新增依赖（用户约束沿用 003）。

## R1: 部分更新（partial update）语义

**Decision/决策**: `notice channel update` 标志路径采用"读取既有解密凭据 → 覆盖命令行提供的字段 → `validateChannelInput(type, name, merged)` 归一化整体校验 → `updateCredentials` 重新加密写入"。不实现字段级差异补丁语言。

**Rationale/理由**: 既有 `validateChannelInput`（`src/channels/channel-config.ts`）是**归一化校验器**——它按 type×mode 从原始对象重建规范凭据集（逐字段 require/optional，只挑已知键），并统一附加 `schemaVersion: 1`。这意味着：
- 未提供字段自动保留（合并自既有凭据）→ FR-002；
- 切换连接方式（如飞书 `--mode webhook --webhook-url X`）时，旧方式的 appId/appSecret 等残留字段被归一化自动丢弃，输出即为纯净的新方式凭据集 → FR-003，无需专门清理逻辑；
- 校验失败在写入前抛出 `ChannelConfigError`，原密文未动 → FR-005/SC-002。

**补充（2026-11-07 澄清）**: 可选字段清除采用"标志传空值"（如 `--secret ""`）——归一化校验器 `optionalString` 对空字符串返回 `undefined`，清除语义天然成立；必填字段空值由 `requireString` 报错。无需专门的清除语法。

**Alternatives considered/备选**: (a) 字段级 diff/patch 语义——需定义每字段"清除"语法（如 `--field =`），复杂度高且无场景支撑（YAGNI，宪法 I）；(b) 强制全量替换（缺标志即报错）——违背 FR-002 的核心痛点（凭据轮换只需换一个值）；(c) 直接改 `validateChannelInput` 支持部分输入——破坏 add 路径共享契约，风险大。

## R2: 改名（rename）与唯一性

**Decision/决策**: 仓储层新增 `rename(id, newName)`：写入前查询同 type 内同名冲突，冲突抛 `ChannelConfigError("同名渠道已存在…")`；CLI 层在执行任何写入**之前**完成改名预检（`findByName`），保证改名冲突时凭据与名称均未被修改（原子性）。不改动 `(type, name)` 唯一索引。

**Rationale/理由**: 名称唯一约束本就属仓储层职责（`create` 的 UNIQUE 错误处理已在仓储层），rename 在同层收口保持对称；预检 + 顺序写入（先凭据后改名）在单用户本地 SQLite 下足够满足 SC-002，无需事务包装（避免为不存在的并发场景引入复杂度）。注意：不同 type 之间名称可重复（FR-009），rename 预检必须限定 `type` 范围。

**Alternatives considered/备选**: (a) drizzle 事务包住凭据+改名写入——更严格但引入事务 API 依赖与回滚测试成本，单用户本地工具收益趋零；(b) 通用 `update(id, {name?, credentials?})` 方法——比两个小方法更宽的接口面，违背最小接口原则。

## R3: 向导修改模式（update 模式）

**Decision/决策**: 复用 003 向导引擎（`src/cli/wizard.ts`）与 `WizardIO` 接口，新增 `seed` 能力：`mode: "update"` 时——第 1 步类型选择跳过（锁定为渠道现有 type）；第 2 步连接方式预选现有 mode（可改）；第 3 步各字段以当前值预填（回车保留，输入新值替换；敏感字段显示"已设置"占位）；第 4 步摘要同现状。引擎产物仍为 `WizardOutcome`（save: type/name/credentials），调用方据此走 update 写入而非 create。

**Rationale/理由**: 引擎已是纯状态机 + 注入 IO（003 设计），预填只是给 `values` 与 type/mode 赋初值，改动集中在 seed 处理与"敏感字段回车=保留"语义（现状已支持空输入保留已填值）；`WizardIO` 假实现可直接脚本化测试修改流程。产物复用保证向导与标志路径经同一 `validateChannelInput` 终验（与 003 的等价性原则一致）。

**Alternatives considered/备选**: (a) 独立 `update-wizard.ts`——步骤逻辑与字段目录高度重复，双倍维护成本；(b) 修改向导只允许改凭据不允许改名——FR-004 要求改名能力，且向导内改名体验更顺。

## R4: 同类型多条配置的现状与差距

**Decision/决策**: 数据层零改动。差距全部在"行为确认 + 报错指引 + 测试固化"：以契约测试证明同 type 多条渠道在 add/list/test/enable/disable/remove/update 各操作中互相独立、分发时逐条发送（FR-009/FR-010/FR-011）；`add` 重名报错文案保持既有"同名渠道已存在（同 type 内唯一）"并补充指引（提示改名或用 update）。

**Rationale/理由**: `notification_channels` 唯一索引本就是 `(type, name)`——同 type 不同 name 的多条记录天然合法；分发管线按启用渠道列表逐条发送（`event-pipeline`），与类型无关。用户感知的"不能多条"实际源于重名报错的措辞误导，属文案/文档问题而非能力缺失。

**Alternatives considered/备选**: (a) 引入"配置组/路由条件"概念（按消息内容路由到不同渠道）——超出本次用户诉求（已在 spec Assumptions 声明待 clarify），不做。

## R5: update 的分派矩阵与退出码

**Decision/决策**: `notice channel update <name>` 行为矩阵对齐 add（contracts/update.md）：

| 场景 | stdin TTY | `--json` | 行为 | 退出码 |
| --- | --- | --- | --- | --- |
| 提供了凭据标志或 `--name` | 任意 | 任意 | 标志路径（合并→校验→写入） | 0/2 |
| 未提供任何修改标志 | 是 | 否 | 启动向导修改模式 | 0（保存/取消） |
| 未提供任何修改标志 | 否 | 否 | 拒绝：指引标志方式 | 2 |
| 未提供任何修改标志 | 任意 | 是 | 拒绝：提示补齐标志 | 2 |
| `<name>` 不存在 | 任意 | 任意 | 报"未找到渠道" | 2 |

**Rationale/理由**: 与 003 契约的 add 分派矩阵同构，用户只需学习一套心智模型；退出码 0/1/2/3 全局契约不变（`contracts/cli.md`，宪法 III）。

**Alternatives considered/备选**: (a) update 永远走标志路径、向导仅限 add——FR-008 明确要求交互终端进向导；(b) `update` 无标志时输出当前配置并退出——与"修改"意图不符且多一个易混淆分支。

## R6: `--json` 输出结构

**Decision/决策**: update 成功输出与 add 同构：`{"channel":{"name","type","enabled"}}`（改名后为新 name）；校验失败/重名冲突走既有 `ChannelConfigError` → 退出码 2 + stderr 文案，stdout 保持纯 JSON 不受污染。取消向导（非 JSON 场景才有向导）不输出 JSON。

**Rationale/理由**: 与 001 `contracts/cli.md` 的既有 JSON 风格一致，消费方零适配；`--json` 拒绝向导沿用 add 现状（003 契约）。

**Alternatives considered/备选**: 增加 `"updatedFields"` 字段——需要维护字段级 diff，信息价值低且可能泄露字段名细节；不做。
