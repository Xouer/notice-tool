import { PassThrough } from "node:stream";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ReadlineWizardIO } from "../../src/cli/wizard-io.js";

/**
 * T007：真实 WizardIO 行为单元测试（US2，Red 先行）。
 * 逐条引用 research R1/R3；以可注入流桩（非真实终端）驱动。
 */

// 控制字符经 fromCharCode 构造（源码避免不可见字面量）
const BACKSPACE = String.fromCharCode(127);
const CTRL_C = String.fromCharCode(3);

function makeTtyStreams() {
  const input = new PassThrough();
  const output = new PassThrough();
  // 流桩模拟 TTY 能力（真实终端由 Node 提供）
  (input as unknown as { isTTY: boolean }).isTTY = true;
  (input as unknown as { setRawMode: (m: boolean) => void }).setRawMode = () => {};
  return { input, output };
}

function outputText(stream: PassThrough): string {
  return stream.read()?.toString("utf8") ?? "";
}

let input: PassThrough;
let output: PassThrough;
let io: ReadlineWizardIO;

beforeEach(() => {
  ({ input, output } = makeTtyStreams());
  io = new ReadlineWizardIO({ input, output });
});

afterEach(() => {
  input.destroy();
  output.destroy();
});

function send(s: string): void {
  input.write(s);
}

async function sendAndWait(s: string, ms = 30): Promise<void> {
  send(s);
  await new Promise((r) => setTimeout(r, ms));
}

describe("ReadlineWizardIO: ask/普通输入（T007，US2）", () => {
  it("回显输入并返回去首尾空白的值", async () => {
    const pending = io.ask("请输入渠道名称");
    await sendAndWait("  hello world  \n");
    const result = await pending;
    expect(result).toEqual({ kind: "value", value: "hello world" });
    expect(outputText(output)).toContain("hello world"); // 回显
  });

  it("多行粘贴仅取首行", async () => {
    const pending = io.ask("请输入");
    await sendAndWait("first\r\nsecond\n");
    const result = await pending;
    expect(result).toEqual({ kind: "value", value: "first" });
  });
});

describe("ReadlineWizardIO: askSecret/敏感输入掩码（T007，US2）", () => {
  it("逐字符回显 * 且明文零出现（FR-010/SC-005）", async () => {
    const pending = io.ask("请输入App Secret", { secret: true });
    await sendAndWait("s3cret!\r");
    const result = await pending;
    expect(result).toEqual({ kind: "value", value: "s3cret!" });
    const text = outputText(output);
    expect(text).toContain("*");
    expect(text).not.toContain("s3cret!");
  });

  it("退格删除已输入字符", async () => {
    const pending = io.ask("请输入App Secret", { secret: true });
    await sendAndWait(`ab${BACKSPACE}c\r`); // ab → 退格删 b → 输入 c
    const result = await pending;
    expect(result).toEqual({ kind: "value", value: "ac" });
  });

  it("Ctrl+C → 返回 cancel", async () => {
    const pending = io.ask("请输入App Secret", { secret: true });
    await sendAndWait(`ab${CTRL_C}`);
    const result = await pending;
    expect(result).toEqual({ kind: "cancel" });
  });
});

describe("ReadlineWizardIO: choose/编号菜单（T007，US2）", () => {
  const options = [
    { label: "app", hint: "应用凭证" },
    { label: "webhook", hint: "群机器人" },
  ];

  it("打印编号菜单并返回 0 基索引", async () => {
    const pending = io.choose("选择输入方式", options);
    await sendAndWait("2\n");
    const result = await pending;
    expect(result).toEqual({ kind: "value", value: 1 });
    const text = outputText(output);
    expect(text).toContain("1) app");
    expect(text).toContain("2) webhook");
    expect(text).toContain("0) 取消");
  });

  it("非法序号提示后原地重试", async () => {
    const pending = io.choose("选择输入方式", options);
    await sendAndWait("9\n");
    await sendAndWait("1\n");
    const result = await pending;
    expect(result).toEqual({ kind: "value", value: 0 });
    expect(outputText(output)).toContain("无效序号");
  });

  it("0 → cancel；b → back", async () => {
    const pending = io.choose("选择输入方式", options);
    await sendAndWait("0\n");
    expect(await pending).toEqual({ kind: "cancel" });

    const pending2 = io.choose("选择输入方式", options);
    await sendAndWait("b\n");
    expect(await pending2).toEqual({ kind: "back" });
  });
});

describe("ReadlineWizardIO: 构造约束（T007，US2）", () => {
  it("非 TTY 输入构造即抛出（FR-008）", () => {
    const plain = new PassThrough();
    expect(() => new ReadlineWizardIO({ input: plain, output: new PassThrough() })).toThrow(
      /交互/i,
    );
    plain.destroy();
  });

  it("TTY 输入构造成功且 interactive 为 true", () => {
    expect(io.interactive).toBe(true);
  });
});
