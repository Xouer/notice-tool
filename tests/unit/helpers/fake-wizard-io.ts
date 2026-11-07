import type { StepResult, WizardIO } from "../../../src/cli/wizard-io.js";

/**
 * T001：假 WizardIO 测试基建（脚本化应答队列）。
 * - answers 按序消费：choose/ask/askSecret 各取一条应答
 * - 记录 print 输出行、choose 调用与 secret 标志（供脱敏与流程断言）
 * - 队列耗尽即抛错，防止测试静默通过
 */

export type FakeAnswer =
  | { kind: "value"; value: string | number }
  | { kind: "back" }
  | { kind: "cancel" };

export interface FakeWizardIO extends WizardIO {
  readonly printed: string[];
  readonly chooseCalls: { prompt: string; labels: string[]; hints: (string | undefined)[] }[];
  readonly secretPrompts: string[];
  readonly askPrompts: string[];
}

export function createFakeWizardIO(answers: FakeAnswer[]): FakeWizardIO {
  const queue = [...answers];
  const io: FakeWizardIO = {
    interactive: true,
    printed: [],
    chooseCalls: [],
    secretPrompts: [],
    askPrompts: [],
    async choose(prompt, options) {
      io.chooseCalls.push({
        prompt,
        labels: options.map((o) => o.label),
        hints: options.map((o) => o.hint),
      });
      const answer = next();
      if (answer.kind === "value") {
        const index = answer.value;
        if (typeof index !== "number" || index < 0 || index >= options.length) {
          throw new Error(`假 WizardIO：choose 应答 ${String(index)} 超出选项范围`);
        }
        return { kind: "value", value: index };
      }
      return { kind: answer.kind };
    },
    async ask(prompt, opts) {
      if (opts?.secret === true) io.secretPrompts.push(prompt);
      else io.askPrompts.push(prompt);
      const answer = next();
      if (answer.kind === "value") {
        if (typeof answer.value !== "string") {
          throw new Error("假 WizardIO：ask 应答必须为字符串");
        }
        const result: StepResult = { kind: "value", value: answer.value };
        return result;
      }
      return { kind: answer.kind };
    },
    print(line) {
      io.printed.push(line);
    },
  };
  return io;

  function next(): FakeAnswer {
    const answer = queue.shift();
    if (answer === undefined) {
      throw new Error("假 WizardIO：应答队列已耗尽（流程与预设不符）");
    }
    return answer;
  }
}
