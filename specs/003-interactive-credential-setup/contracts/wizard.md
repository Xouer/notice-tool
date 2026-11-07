# Contract: Interactive Channel Setup Wizard/契约：交互式渠道配置向导

**Version/版本**: 1 (2026-11-07) | **Spec/规格**: [spec.md](../spec.md)

本契约是对 001 [cli.md](../../001-agent-task-notify/contracts/cli.md) 与 002 [feishu-app-channel.md](../../002-feishu-app-credential/contracts/feishu-app-channel.md) 的**受控新增**（宪法原则 III）：既有标志路径、退出码 0/1/2/3、`--json` 结构均不变。

## CLI 变更/CLI Changes

### `notice channel add` 行为矩阵

| 场景 | stdin TTY | `--json` | 行为 | 退出码 |
| --- | --- | --- | --- | --- |
| 凭据齐全（既有用法） | 任意 | 任意 | 既有标志路径，行为零变化 | 0/2（同现状） |
| 缺 type 或缺必填凭据标志 | 是 | 否 | **启动交互向导**（FR-001） | 0（保存/取消） |
| 缺 type 或缺必填凭据标志 | 否 | 否 | 拒绝：回落标志路径，由校验定位缺失标志/给出用法与向导指引（002 契约字段定位保留） | 2 |
| 缺 type 或缺必填凭据标志 | 任意 | 是 | 拒绝：提示补齐标志（R8，不污染 JSON） | 2 |
| `--interactive` 显式 | 是 | 否 | 强制向导（已给 `type`/`--name` 作为预选/默认） | 0 |
| `--interactive` 显式 | 否 | 任意 | 拒绝：需要交互终端 | 2 |

- `<type>` 放宽为 `[type]`（可选位置参数）；`--name` 放宽为可选。**放宽是唯一行为变化点**：非 TTY 下缺省仍退出码 `2`，与现状一致（现状：commander 用法错误/校验失败 → 2）。
- 其余子命令（`list/enable/disable/remove/test`）零变更。

### 向导步骤流（FR-002 ~ FR-007）

```text
第 1 步 选择输入类型（渠道类型，5 项编号菜单，各附一句用途说明）   ← type 已预选则跳过
第 2 步 选择输入方式（该渠道的连接方式，附说明与"推荐"标记）      ← 单方式渠道（dingtalk/email）跳过
第 3 步 选择输入值（逐字段：名称 → 类型专属字段；每项显示含义、格式示例、获取方法；
        敏感项掩码输入；可选项留空回车走默认；lightCheck 失败原地重试）
第 4 步 确认摘要（凭据脱敏；默认值标注"(默认生成)"）
        1) 确认保存  2) 返回上一步修改  0) 取消
重名冲突 → 1) 重新输入名称  2) 覆盖既有渠道（显式确认后 remove+create）  0) 取消
```

- 每步固定导航项：`b` 返回上一步（第 1 步除外）、`0` 取消；Ctrl+C 同取消。
- 取消输出：`已取消，未做任何更改。`，退出码 `0`。
- 保存成功输出与既有 `add` 相同（`渠道已添加：...`；`--json` 下不进入向导故无 JSON 变更）。

## WizardIO 接口（实现契约，src/cli/wizard-io.ts）

```ts
export type StepResult =
  | { kind: "value"; value: string }
  | { kind: "back" }
  | { kind: "cancel" };

export interface WizardIO {
  /** 是否具备交互能力（真实终端为 stdin TTY；假实现恒 true）。 */
  readonly interactive: boolean;
  /** 编号选择：打印带说明的菜单，返回 0 基索引。 */
  choose(prompt: string, options: readonly { label: string; hint?: string }[]):
    Promise<{ kind: "value"; value: number } | { kind: "back" } | { kind: "cancel" }>;
  /** 单行输入；secret=true 时掩码不回显明文（FR-004/FR-010）。 */
  ask(prompt: string, opts?: { secret?: boolean }): Promise<StepResult>;
  /** 输出提示/摘要行。 */
  print(line: string): void;
}
```

- 真实实现：`node:readline/promises` 提问（`terminal: true` 回显）；`askSecret` 用 `setRawMode(true)` 逐字符回显 `*`（research R3）；非 TTY 构造即抛出（由分派先行拦截）。
- 测试实现：预设应答队列（`createFakeWizardIO(answers)`），供单元/集成测试。

## Wizard 引擎（实现契约，src/cli/wizard.ts）

```ts
export type WizardOutcome =
  | { action: "save"; type: ChannelType; name: string; credentials: Record<string, unknown> }
  | { action: "cancel" };

export function runWizard(io: WizardIO, seed?: { type?: ChannelType; values?: Record<string, string> }): Promise<WizardOutcome>;
```

- 引擎不接触数据库与终端；`save` 后由调用方（`channel.ts`）执行 `validateChannelInput` 终验 + 重名检测 + `repo.create`（data-model 唯一写入点）。
- 引擎可测试行为：步骤顺序、预选跳过、单方式跳过、逐字段校验重试、`b` 回退保留输入、`0`/Ctrl+C 取消、默认名生成、摘要脱敏（`appSecret`/`authCode`/`pushKey` 等以 `***` 形式出现，明文零出现——SC-005）。

## 字段目录速览/Field Catalog（提示文案在 tasks 阶段对照 README/002 quickstart 固化）

| type | mode | 字段（顺序） |
| --- | --- | --- |
| feishu | app | name(可选) → appId → appSecret(密) → receiveIdType(选择) → receiveId |
| feishu | webhook | name(可选) → webhookUrl |
| dingtalk | — | name(可选) → webhookUrl → secret(密，可选) |
| email | — | name(可选) → smtpHost → smtpPort(默认 465) → username(可选) → authCode(密) → from(可选) → to |
| wechat | webhook | name(可选) → webhookUrl |
| wechat | push | name(可选) → service(选择) → pushKey(密) |
| qq | official | name(可选) → appId → appSecret(密) → endpoint |
| qq | push | name(可选) → pushKey(密) |

## 脱敏与安全规则/Redaction & Security（FR-010，SC-005）

- `askSecret` 屏幕输出仅 `*`；摘要中敏感值经既有掩码语义（`***` 或 `maskSecret`）。
- 向导全过程不产生日志；错误提示复用 `redactSensitive`。
- 取消/中断：草稿仅存活于内存，随进程释放；`repo.create` 前零落盘（SC-003）。
