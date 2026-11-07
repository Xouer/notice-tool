/**
 * T002：WizardIO 契约类型（contracts/wizard.md）。
 * 本文件在 T002 阶段仅包含类型定义；真实终端实现属 T009（US2）。
 * 引擎（src/cli/wizard.ts）仅依赖此接口，不接触真实终端与数据库。
 */

/** 单步应答：值 / 返回上一步 / 取消。 */
export type StepResult =
  | { kind: "value"; value: string }
  | { kind: "back" }
  | { kind: "cancel" };

/** 编号选择应答：0 基索引 / 返回上一步 / 取消。 */
export type ChooseResult =
  | { kind: "value"; value: number }
  | { kind: "back" }
  | { kind: "cancel" };

export interface ChooseOption {
  label: string;
  hint?: string;
}

export interface AskOptions {
  /** 敏感输入：实现必须掩码，不得回显明文（FR-004/FR-010）。 */
  secret?: boolean;
}

export interface WizardIO {
  /** 是否具备交互能力（真实终端实现为 stdin TTY；假实现恒 true）。 */
  readonly interactive: boolean;
  /** 编号选择：打印带说明的菜单，返回 0 基索引。 */
  choose(prompt: string, options: readonly ChooseOption[]): Promise<ChooseResult>;
  /** 单行输入；secret=true 时掩码不回显明文。 */
  ask(prompt: string, opts?: AskOptions): Promise<StepResult>;
  /** 输出提示/摘要行。 */
  print(line: string): void;
}

// ── T009：真实终端实现（US2）──
// 控制字符经 fromCharCode 构造，源码避免不可见字面量。
const CTRL_C_CODE = 3;
const BACKSPACE_CODE = 127;
const ENTER_CODE = 13;
const NEWLINE_CODE = 10;

import { createInterface } from "node:readline/promises";
import type { Readable, Writable } from "node:stream";

export class ReadlineWizardIO implements WizardIO {
  readonly interactive: boolean;
  private readonly input: Readable;
  private readonly output: Writable;

  constructor(opts: { input?: Readable; output?: Writable } = {}) {
    this.input = opts.input ?? (process.stdin as unknown as Readable);
    this.output = opts.output ?? (process.stdout as unknown as Writable);
    this.interactive = (this.input as unknown as { isTTY?: boolean }).isTTY === true;
    if (!this.interactive) {
      // FR-008：非交互终端不启动向导，由分派层拦截并给出指引
      throw new Error("交互式向导需要 TTY 终端：当前 stdin 不是交互式终端");
    }
  }

  async choose(prompt: string, options: readonly ChooseOption[]): Promise<ChooseResult> {
    this.print(prompt);
    options.forEach((o, idx) => {
      this.print(`  ${idx + 1}) ${o.label}${o.hint !== undefined ? ` — ${o.hint}` : ""}`);
    });
    this.print("  0) 取消   b) 返回上一步");
    for (;;) {
      const r = await this.ask("请输入序号：");
      if (r.kind !== "value") return r;
      const v = r.value;
      if (v === "0") return { kind: "cancel" };
      if (v === "b") return { kind: "back" };
      const n = Number(v);
      if (Number.isInteger(n) && n >= 1 && n <= options.length) {
        return { kind: "value", value: n - 1 };
      }
      this.print(`✗ 无效序号：${v}（请输入 1-${options.length}，0 取消，b 返回）`);
    }
  }

  async ask(prompt: string, opts?: AskOptions): Promise<StepResult> {
    if (opts?.secret === true) return this.askSecret(prompt);
    const rl = createInterface({
      input: this.input,
      output: this.output as Writable & { isTTY?: boolean },
      terminal: true, // 回显输入（掩码输入走 askSecret，不经此处）
    });
    const result = await new Promise<StepResult>((resolve) => {
      rl.on("SIGINT", () => resolve({ kind: "cancel" }));
      // 提示行后换行：输入与粘贴独占下一行（真机 UX，FR-004）
      rl.question(`${prompt}\n`).then(
        (answer) => resolve({ kind: "value", value: answer.trim() }),
        () => resolve({ kind: "cancel" }),
      );
    });
    rl.close();
    return result;
  }

  /**
   * 敏感输入：raw 模式逐字符读取，屏幕仅回显 "*"（research R3）；
   * 回车结束、退格删除、Ctrl+C 取消；明文零回显（FR-010/SC-005）。
   */
  private askSecret(prompt: string): Promise<StepResult> {
    return new Promise((resolve) => {
      const rawCapable = this.input as unknown as {
        setRawMode?: (m: boolean) => void;
        isRaw?: boolean;
      };
      const wasRaw = rawCapable.isRaw === true;
      rawCapable.setRawMode?.(true);
      // 真实 TTY 下 stdin 需显式进入流动模式，否则 data 事件不触发、
      // promise 永不 resolve，进程以 "unsettled top-level await" 警告退出
      this.input.resume();
      this.output.write(`${prompt}\n`);
      let value = "";
      const onData = (chunk: Buffer | string): void => {
        const text = typeof chunk === "string" ? chunk : chunk.toString("utf8");
        for (const ch of text) {
          const code = ch.charCodeAt(0);
          if (code === ENTER_CODE || code === NEWLINE_CODE) {
            this.finishSecret(rawCapable, wasRaw, onData);
            resolve({ kind: "value", value: value.trim() });
            return;
          }
          if (code === CTRL_C_CODE) {
            this.finishSecret(rawCapable, wasRaw, onData);
            resolve({ kind: "cancel" });
            return;
          }
          if (code === BACKSPACE_CODE || code === 8) {
            if (value.length > 0) {
              value = value.slice(0, -1);
              this.output.write("\b \b");
            }
            continue;
          }
          if (code < 32) continue; // 忽略其他控制字符
          value += ch;
          this.output.write("*");
        }
      };
      this.input.on("data", onData);
    });
  }

  private finishSecret(
    rawCapable: { setRawMode?: (m: boolean) => void },
    wasRaw: boolean,
    onData: (chunk: Buffer | string) => void,
  ): void {
    this.input.removeListener("data", onData);
    rawCapable.setRawMode?.(wasRaw);
    this.output.write("\n");
  }

  print(line: string): void {
    this.output.write(`${line}\n`);
  }
}

/** 工厂：stdin 为 TTY 时返回真实 IO，否则返回 undefined（分派层据此拒绝向导）。 */
export function createInteractiveWizardIO(): WizardIO | undefined {
  if ((process.stdin as unknown as { isTTY?: boolean }).isTTY !== true) return undefined;
  return new ReadlineWizardIO();
}

