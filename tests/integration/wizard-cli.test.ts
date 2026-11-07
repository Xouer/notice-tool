import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runCli } from "../../src/cli/index.js";
import type { WizardIO } from "../../src/cli/wizard-io.js";
import { createFakeWizardIO, type FakeAnswer } from "../unit/helpers/fake-wizard-io.js";

/**
 * T010：CLI 分派矩阵与全渠道向导集成测试（US3，Red 先行）。
 * 逐条引用 contracts/wizard.md 行为矩阵与 spec 验收场景 3。
 */

const WEBHOOK = "https://open.feishu.example/open-apis/bot/v2/hook/0d1e2f3a4b5c6d7e8f9a0b1c";
const APP_ID = "cli_a1b2c3d4e5f6";
const APP_SECRET = "feishu-app-secret-9876543210";
const RECEIVE_ID = "oc_1234567890abcdef";

let dataDir: string;

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), "notice-wizard-cli-"));
});

afterEach(() => {
  rmSync(dataDir, { recursive: true, force: true });
});

function cli(argv: string[], wizardIO?: WizardIO) {
  let out = "";
  let errOut = "";
  return runCli(argv, {
    dataDir,
    out: (s) => {
      out += s;
    },
    err: (s) => {
      errOut += s;
    },
    wizardIO,
  }).then((code) => ({ code, out, errOut }));
}

async function listChannels() {
  const r = await cli(["channel", "list", "--json"]);
  return JSON.parse(r.out.trim()) as {
    channels: Array<{ name: string; type: string; enabled: boolean }>;
  };
}

/** 飞书应用凭证全流程应答（无预选）。 */
function feishuAppAnswers(name: string): FakeAnswer[] {
  return [
    { kind: "value", value: 0 },
    { kind: "value", value: 0 },
    { kind: "value", value: name },
    { kind: "value", value: APP_ID },
    { kind: "value", value: APP_SECRET },
    { kind: "value", value: 0 },
    { kind: "value", value: RECEIVE_ID },
    { kind: "value", value: 0 },
  ];
}

describe("wizard CLI dispatch matrix/分派矩阵（T010，US3）", () => {
  it("无参数 + 交互终端（注入 IO）→ 向导完成飞书配置", async () => {
    const io = createFakeWizardIO(feishuAppAnswers("向导飞书"));
    const r = await cli(["channel", "add"], io);
    expect(r.code).toBe(0);
    expect(r.out).toContain("渠道已添加");
    const listed = await listChannels();
    expect(listed.channels[0]?.type).toBe("feishu");
    expect(r.out).not.toContain(APP_SECRET);
  });

  it("非 TTY（未注入 IO）无参数 → 退出码 2 并提示需要交互式终端（FR-008）", async () => {
    const r = await cli(["channel", "add"]);
    expect(r.code).toBe(2);
    expect(r.errOut).toContain("交互");
  });

  it("--json 缺标志 → 退出码 2 且 stdout 保持纯 JSON（R8）", async () => {
    const r = await cli(["--json", "channel", "add", "feishu"]);
    expect(r.code).toBe(2);
    expect(r.out.trim()).toBe("");
    expect(r.errOut).toContain("标志");
  });

  it("--interactive + 交互终端 → 强制向导且 type 预选跳过第 1 步", async () => {
    const io = createFakeWizardIO(feishuAppAnswers("强制向导").slice(1));
    const r = await cli(["channel", "add", "feishu", "--interactive"], io);
    expect(r.code).toBe(0);
    // 类型菜单特征：同时含 feishu 与 qq 两个渠道选项；预选后不应出现
    expect(io.chooseCalls.some((c) => c.labels.includes("feishu") && c.labels.includes("qq"))).toBe(
      false,
    );
  });

  it("--interactive 非 TTY → 退出码 2", async () => {
    const r = await cli(["channel", "add", "feishu", "--interactive"]);
    expect(r.code).toBe(2);
  });

  it("凭据齐全标志路径不弹向导（FR-009 回归）", async () => {
    const io = createFakeWizardIO([]); // 空应答队列：一旦走向导即抛错
    const r = await cli(
      ["channel", "add", "feishu", "--name", "旧方式", "--webhook-url", WEBHOOK],
      io,
    );
    expect(r.code).toBe(0);
    expect(io.chooseCalls).toHaveLength(0);
  });

  it("取消零落盘（SC-003）：中途取消后渠道列表不变", async () => {
    const io = createFakeWizardIO([{ kind: "cancel" }]);
    const r = await cli(["channel", "add"], io);
    expect(r.code).toBe(0);
    expect(r.out).toContain("已取消");
    const listed = await listChannels();
    expect(listed.channels).toHaveLength(0);
  });
});

describe("wizard CLI all channels/全渠道向导（T010，US3）", () => {
  it("dingtalk 全流程：单方式渠道跳过方式步骤", async () => {
    const io = createFakeWizardIO([
      { kind: "value", value: "dd" },
      { kind: "value", value: WEBHOOK },
      { kind: "value", value: "" },
      { kind: "value", value: 0 },
    ]);
    const r = await cli(["channel", "add", "dingtalk"], io);
    expect(r.code).toBe(0);
    const listed = await listChannels();
    expect(listed.channels[0]).toMatchObject({ name: "dd", type: "dingtalk" });
  });

  it("wechat push 流程：方式菜单 + service 选择", async () => {
    const io = createFakeWizardIO([
      { kind: "value", value: 1 }, // push
      { kind: "value", value: "wx" },
      { kind: "value", value: 1 }, // pushplus
      { kind: "value", value: "push-key-123" },
      { kind: "value", value: 0 },
    ]);
    const r = await cli(["channel", "add", "wechat"], io);
    expect(r.code).toBe(0);
    const listed = await listChannels();
    expect(listed.channels[0]).toMatchObject({ type: "wechat" });
    expect(r.out).not.toContain("push-key-123");
  });

  it("qq official 流程", async () => {
    const io = createFakeWizardIO([
      { kind: "value", value: 0 }, // official
      { kind: "value", value: "qq-bot" },
      { kind: "value", value: "qq-app-id" },
      { kind: "value", value: "qq-app-secret" },
      { kind: "value", value: "https://api.qq.example/messages" },
      { kind: "value", value: 0 },
    ]);
    const r = await cli(["channel", "add", "qq"], io);
    expect(r.code).toBe(0);
    const listed = await listChannels();
    expect(listed.channels[0]).toMatchObject({ type: "qq" });
  });

  it("email 全流程：可选项留空与默认端口", async () => {
    const io = createFakeWizardIO([
      { kind: "value", value: "" }, // name 留空 → 默认名
      { kind: "value", value: "smtp.qq.com" },
      { kind: "value", value: "" }, // 端口默认 465
      { kind: "value", value: "" }, // username 可选
      { kind: "value", value: "auth-code-123" },
      { kind: "value", value: "" }, // from 可选
      { kind: "value", value: "a@b.c" },
      { kind: "value", value: 0 },
    ]);
    const r = await cli(["channel", "add", "email"], io);
    expect(r.code).toBe(0);
    const listed = await listChannels();
    expect(listed.channels[0]?.type).toBe("email");
    expect(listed.channels[0]?.name).toMatch(/^email-\d{8}-\d{6}$/);
  });
});

describe("wizard CLI duplicate names/重名处理（T010，US3，R7）", () => {
  it("重名 → 改名保存，不静默覆盖", async () => {
    await cli(["channel", "add", "dingtalk", "--name", "dd", "--webhook-url", WEBHOOK]);
    const io = createFakeWizardIO([
      { kind: "value", value: "dd" }, // 与既有重名
      { kind: "value", value: WEBHOOK },
      { kind: "value", value: "" },
      { kind: "value", value: 0 },
      { kind: "value", value: 0 }, // 冲突菜单：重新输入名称
      { kind: "value", value: "dd2" },
    ]);
    const r = await cli(["channel", "add", "dingtalk"], io);
    expect(r.code).toBe(0);
    const listed = await listChannels();
    expect(listed.channels.map((c) => c.name)).toEqual(["dd", "dd2"]);
  });

  it("重名 → 显式选择覆盖：旧渠道被替换且总数不变", async () => {
    await cli(["channel", "add", "dingtalk", "--name", "dd", "--webhook-url", WEBHOOK]);
    const io = createFakeWizardIO([
      { kind: "value", value: "dd" },
      { kind: "value", value: "https://other.example/hook" },
      { kind: "value", value: "" },
      { kind: "value", value: 0 },
      { kind: "value", value: 1 }, // 冲突菜单：覆盖
    ]);
    const r = await cli(["channel", "add", "dingtalk"], io);
    expect(r.code).toBe(0);
    const listed = await listChannels();
    expect(listed.channels).toHaveLength(1);
    expect(listed.channels[0]?.name).toBe("dd");
  });
});
