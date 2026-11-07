# Research & Decisions/调研与决策：交互式渠道配置向导

**Feature**: 003-interactive-credential-setup | **Date**: 2026-11-07

本特性为纯本地交互体验改造，无外部服务调研项；全部未知点集中在"如何用现有技术栈实现交互式分步输入"。逐项决策如下。

## R1: 交互式输入与选择列表的实现选型/Interactive IO Choice

**Decision/决策**: 使用 Node 内置 `node:readline` / `node:readline/promises` 实现提问与单行输入；选择列表统一采用"编号菜单 + 数字序号输入"（`1) feishu  2) dingtalk ...`）。

**Rationale/理由**: Node ≥ 22 内置 readline 已覆盖单行输入、`terminal` 能力检测与原始模式控制；编号菜单天然满足 FR-008 的"极简终端退化为数字输入"，且在 Windows Terminal/PowerShell/conhost 下行为一致。零新增依赖，符合宪法原则 I。

**Alternatives considered/备选**:
- `@inquirer/prompts` / `enquirer`：功能全（方向键列表、密码、分页），但引入新依赖树；方向键列表在极简终端反而需另做数字回退（FR-008），得不偿失。拒绝。
- `ink`（React TUI）：渲染模型重、测试复杂度高，与"本地常驻小工具"体量不匹配。拒绝。

## R2: 向导入口与命令形态/Wizard Entry Point

**Decision/决策**: 不新增独立命令；改造既有 `notice channel add`：
- `<type>` 位置参数放宽为可选 `[type]`；`--name` 由必填放宽为可选；
- 新增 `--interactive` 标志强制进入向导；
- 分派规则（见 [contracts/wizard.md](contracts/wizard.md)）：
  1. `--interactive` 显式给出 → 必须为交互终端（TTY），否则退出码 `2` 并提示；
  2. 非 `--interactive` 且（缺 `type` 或缺该渠道必填凭据标志）且 stdin 为 TTY 且未开 `--json` → 启动向导；
  3. 其余情况（脚本/`--json`/凭据齐全）→ 既有标志路径原样执行；非 TTY 且缺必填 → 退出码 `2`（与现状一致）。

**Rationale/理由**: FR-001 要求"未提供必填凭据标志时自动进入向导"；`channel add` 是用户既有心智入口，避免 `add`/`setup` 双入口造成两套等价语义（宪法原则 I）。`type` 已给出时向导跳过第一步（预选），符合"一步一步但不多问"。

**Alternatives considered/备选**:
- 新增 `notice setup` / `notice channel setup` 独立命令：语义清晰但产生两条等价路径，且 spec 未要求独立入口。拒绝（可在后续特性演进）。
- 保持 `<type>` 必填、仅凭据缺失时弹向导：用户连渠道类型都要先记参数，削弱核心价值。拒绝。

## R3: 敏感输入不回显明文/Secret Input Masking

**Decision/决策**: `promptSecret` 实现：stdin 处于 TTY 时进入原始模式（`setRawMode(true)`）逐字符读取，屏幕每字符仅回显一个 `*`，支持退格删除，回车结束；Ctrl+C 走统一取消路径。非 TTY（管道/测试）时掩码输入不可用，向导整体拒绝启动（与 R2 分派一致）。

**Rationale/理由**: FR-004/FR-010 与宪法原则 IV 要求敏感值不回显明文；raw 模式逐字符掩码是零依赖的标准做法（掩码位数会泄露长度，但防线主体是"摘要与日志一律脱敏"，输入侧掩码为体验层要求）。

**Alternatives considered/备选**:
- readline + 自定义 `output` 流拦截写入：实现更绕且各终端行为差异大。拒绝。
- 允许明文回显、仅靠日志脱敏：违反 FR-010"输入不回显明文"。拒绝。

## R4: 字段级校验与既有校验的关系/Validation Reuse

**Decision/决策**: 双层校验。向导每步做轻量即时校验（非空、URL 可解析、枚举命中、端口为整数），错误定位到当前字段并允许当场重试（FR-005）；最终入库前整包走既有 `validateChannelInput`（仓储层还会再校验一次），保证向导产物与标志产物通过完全相同的规则。飞书 ID 前缀（`cli_`/`oc_`/`ou_`）仅作为提示文案与示例，不作硬校验（`receiveIdType=email`/`user_id` 时前缀不适用）。

**Rationale/理由**: 即时校验提供"定位到具体字段"的向导体验；终验复用既有实现避免规则双写漂移（宪法原则 I/III）。

**Alternatives considered/备选**:
- 把 `channel-config.ts` 的模块私有 `requireString/requireEnum/...` 导出复用：会扩大该模块对外面，且字段提示（含义/示例/获取方法）本就需要新的字段目录结构。拒绝，改为字段目录内嵌轻校验。
- 向导内做外部实时验证（调飞书校验凭证）：引入网络依赖与限流问题，联通性验证由既有"测试发送"承担（spec Assumptions）。拒绝。

## R5: 可测试性接缝/Testability Seams

**Decision/决策**:
- 向导引擎 `runWizard(flow, io, seed)` 为纯状态机：输入为字段目录流 + `WizardIO`，输出为 `{ action: "save" | "cancel", draft }`；单元测试用脚本化假 IO（预设应答队列）断言步骤序列、重试、返回、取消、默认值。
- `WizardIO` 接口：`choose(prompt, options) → index | "back" | "cancel"`、`ask(prompt, opts) → value | "back" | "cancel"`、`askSecret(prompt) → 同上`、`print(line)`。
- `runCli` 的 `CliRunOptions` 增加可选 `wizardIO` 注入（与既有 `dataDir`/`stdin` 同模式的测试接缝），集成测试注入假 IO 走真实命令分派，断言触发条件与退出码。

**Rationale/理由**: 宪法原则 II 要求测试覆盖公开行为与边界/失败路径；交互代码最大风险是 IO 与逻辑耦合不可测，注入接缝以最小代价解决。

## R6: 取消、中断与零落盘/Cancel Semantics

**Decision/决策**: 任一步骤选择"取消"（编号菜单固定末项 `0) 取消`）或 Ctrl+C：向导退出，输出"已取消，未做任何更改"，退出码 `0`（用户主动放弃非失败）；内存草稿直接丢弃，全程只有确认后才调用 `repo.create`（单一写入点，天然零半成品，SC-003）。"返回上一步"（固定项 `b`）保留已输入值回到上一步。

**Rationale/理由**: 单一写入点使 FR-007/SC-003 无需额外事务；退出码 `0` 保持退出码语义简洁（契约不变原则：不新增退出码）。

## R7: 默认渠道名与重名冲突/Default Name & Duplicate Handling

**Decision/决策**: 渠道名为可选步骤，跳过时默认 `{type}-{YYYYMMDD-HHmmss}`（本地时间）；确认摘要中标注"(默认生成)"。确认前用既有 `repo.findByName` 检测重名：冲突时提供"重新输入名称 / 覆盖既有同名渠道（先 remove 后 create，需显式确认）/ 取消"三选，不静默覆盖。

**Rationale/理由**: spec 边界情况"重名渠道"要求显式处理；复用既有唯一性语义，不新增存储规则。

## R8: `--json` 模式下的行为/JSON Mode Behavior

**Decision/决策**: 全局 `--json` 开启时永不进入向导（JSON 是机器可读契约，交互提示会污染输出）：凭据齐全 → 既有路径；凭据缺失 → 退出码 `2`，错误信息指引"补齐标志或在交互终端下运行"。

**Rationale/理由**: 001 契约规定 `--json` 输出为纯 JSON；FR-008/FR-009 的兼容性要求。既有契约测试零改动即回归。

## 遗留 NEEDS CLARIFICATION/Remaining Unknowns

无。全部未知点已在 R1–R8 决策闭合。实现期唯一核对项：各渠道字段目录的提示文案（含义/示例/获取方法）在 tasks 阶段对照 README 与 002 quickstart.md 固化，属内容填充而非技术未知。
