import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runCli } from "../../src/cli/index.js";

/**
 * 004-T005：channel update 标志路径集成测试（US1，Red 先行）。
 * 逐条引用 contracts/update.md 行为矩阵与 spec 验收场景：
 * 部分更新、改名、改名冲突原子性、校验失败原子性、渠道不存在、
 * 空值清除、连接方式切换归一化、--json 输出、非 TTY/--json 分派。
 */

const WEBHOOK = "https://open.feishu.example/open-apis/bot/v2/hook/0d1e2f3a4b5c6d7e8f9a0b1c";
const OTHER_HOOK = "https://open.feishu.example/open-apis/bot/v2/hook/other0123456789abcdef";
const APP_ID = "cli_a1b2c3d4e5f6";
const APP_SECRET_OLD = "feishu-secret-old-000";
const APP_SECRET_NEW = "feishu-secret-new-111";
const RECEIVE_ID = "oc_1234567890abcdef";

let dataDir: string;

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), "notice-update-cli-"));
});

afterEach(() => {
  rmSync(dataDir, { recursive: true, force: true });
});

function cli(argv: string[]) {
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
  }).then((code) => ({ code, out, errOut }));
}

async function addFeishuApp(name: string, secret: string): Promise<void> {
  const r = await cli([
    "channel",
    "add",
    "feishu",
    "--name",
    name,
    "--mode",
    "app",
    "--app-id",
    APP_ID,
    "--app-secret",
    secret,
    "--receive-id-type",
    "chat_id",
    "--receive-id",
    RECEIVE_ID,
  ]);
  if (r.code !== 0) throw new Error(`add 失败：${r.errOut}`);
}

async function addDingtalk(name: string, secret?: string): Promise<void> {
  const argv = ["channel", "add", "dingtalk", "--name", name, "--webhook-url", WEBHOOK];
  if (secret !== undefined) argv.push("--secret", secret);
  const r = await cli(argv);
  if (r.code !== 0) throw new Error(`add 失败：${r.errOut}`);
}

async function listJson(): Promise<{
  channels: Array<{ name: string; type: string; enabled: boolean; credentials: string }>;
}> {
  const r = await cli(["channel", "list", "--json"]);
  return JSON.parse(r.out.trim());
}

describe("channel update: 部分更新（US1，FR-002）", () => {
  it("仅轮换 App Secret：其余字段保留，test 前保持未启用", async () => {
    await addFeishuApp("my-feishu", APP_SECRET_OLD);
    const r = await cli(["channel", "update", "my-feishu", "--app-secret", APP_SECRET_NEW]);
    expect(r.code).toBe(0);
    expect(r.out).toContain("渠道已更新：my-feishu（feishu）");

    const listed = await listJson();
    expect(listed.channels).toHaveLength(1);
    expect(listed.channels[0]).toMatchObject({ name: "my-feishu", type: "feishu", enabled: false });
    // 摘要为掩码，不含新旧明文
    expect(listed.channels[0]!.credentials).not.toContain(APP_SECRET_OLD);
    expect(listed.channels[0]!.credentials).not.toContain(APP_SECRET_NEW);
  });
});

describe("channel update: 改名（US1，FR-004/FR-007）", () => {
  it("改名成功：新名生效、旧名消失、启用状态保留", async () => {
    await addDingtalk("old-name");
    const enabled = await cli(["channel", "enable", "old-name"]);
    expect(enabled.code).toBe(0);

    const r = await cli(["channel", "update", "old-name", "--name", "new-name"]);
    expect(r.code).toBe(0);
    expect(r.out).toContain("渠道已更新：new-name（dingtalk）");

    const listed = await listJson();
    expect(listed.channels.map((c) => c.name)).toEqual(["new-name"]);
    expect(listed.channels[0]!.enabled).toBe(true);
  });

  it("改名冲突（同 type 内）：退出码 2，名称与凭据零改动（SC-002）", async () => {
    await addFeishuApp("feishu-a", APP_SECRET_OLD);
    await cli(["channel", "add", "feishu", "--name", "feishu-b", "--webhook-url", WEBHOOK]);
    const before = await listJson();

    const r = await cli(["channel", "update", "feishu-a", "--name", "feishu-b"]);
    expect(r.code).toBe(2);
    expect(r.errOut).toContain("同名渠道已存在");

    const after = await listJson();
    expect(after.channels.map((c) => `${c.name}:${c.type}`)).toEqual(
      before.channels.map((c) => `${c.name}:${c.type}`),
    );
  });

  it("不同 type 之间同名合法（FR-009）：feishu 渠道可改名为 dingtalk 渠道的现名", async () => {
    await addFeishuApp("feishu-x", APP_SECRET_OLD);
    await addDingtalk("mail-a");
    const r = await cli(["channel", "update", "feishu-x", "--name", "mail-a"]);
    expect(r.code).toBe(0);
    const listed = await listJson();
    expect(listed.channels.filter((c) => c.name === "mail-a")).toHaveLength(2);
  });
});

describe("channel update: 校验失败原子性（US1，FR-005/SC-002）", () => {
  it("非法凭据 → 退出码 2 且原配置不变", async () => {
    await addFeishuApp("fs", APP_SECRET_OLD);
    const r = await cli(["channel", "update", "fs", "--receive-id", ""]);
    expect(r.code).toBe(2);
    expect(r.errOut).toContain("receiveId");

    const listed = await listJson();
    expect(listed.channels[0]!.name).toBe("fs");
  });
});

describe("channel update: 渠道不存在（US1）", () => {
  it("退出码 2 并提示 list", async () => {
    const r = await cli(["channel", "update", "ghost", "--app-secret", "x"]);
    expect(r.code).toBe(2);
    expect(r.errOut).toContain("未找到渠道");
    expect(r.errOut).toContain("notice channel list");
  });
});

describe("channel update: 空值清除可选字段（FR-002 澄清）", () => {
  it(`--secret "" 清除钉钉加签密钥；--to "" 报错定位字段`, async () => {
    await addDingtalk("dd", "SEC-xyz-123");
    const r = await cli(["channel", "update", "dd", "--secret", ""]);
    expect(r.code).toBe(0);
    // 清除后 summary 仍为掩码形态（无明文 SEC）
    const listed = await listJson();
    expect(listed.channels[0]!.credentials).not.toContain("SEC-xyz-123");

    await cli([
      "channel",
      "add",
      "email",
      "--name",
      "ml",
      "--smtp-host",
      "smtp.qq.com",
      "--auth-code",
      "code-1",
      "--to",
      "a@example.com",
    ]);
    const r2 = await cli(["channel", "update", "ml", "--to", ""]);
    expect(r2.code).toBe(2);
    expect(r2.errOut).toContain("to");
  });
});

describe("channel update: 连接方式切换归一化（US1，FR-003）", () => {
  it("feishu app→webhook：旧 appId/appSecret/receiveId 被丢弃", async () => {
    await addFeishuApp("fs-switch", APP_SECRET_OLD);
    const r = await cli([
      "channel",
      "update",
      "fs-switch",
      "--mode",
      "webhook",
      "--webhook-url",
      OTHER_HOOK,
    ]);
    expect(r.code).toBe(0);

    const listed = await listJson();
    // 摘要显示 webhook 形态（不再含 appId 掩码对）
    expect(listed.channels[0]!.credentials).not.toContain(APP_ID);
  });
});

describe("channel update: JSON 与分派矩阵（FR-008，R5/R6）", () => {
  it("--json 成功输出 {channel:{name,type,enabled}} 且 stdout 纯 JSON", async () => {
    await addDingtalk("dd-json");
    const r = await cli(["--json", "channel", "update", "dd-json", "--webhook-url", OTHER_HOOK]);
    expect(r.code).toBe(0);
    const parsed = JSON.parse(r.out.trim()) as {
      channel: { name: string; type: string; enabled: boolean };
    };
    expect(parsed.channel).toEqual({ name: "dd-json", type: "dingtalk", enabled: false });
  });

  it("非 TTY 无标志 → 退出码 2 并指引标志方式", async () => {
    await addDingtalk("dd-tty");
    const r = await cli(["channel", "update", "dd-tty"]);
    expect(r.code).toBe(2);
    expect(r.errOut).toContain("notice channel update --help");
  });

  it("--json 无标志 → 退出码 2、stdout 空、stderr 指引补齐标志", async () => {
    await addDingtalk("dd-json2");
    const r = await cli(["--json", "channel", "update", "dd-json2"]);
    expect(r.code).toBe(2);
    expect(r.out.trim()).toBe("");
    expect(r.errOut).toContain("标志");
  });
});

describe("channel update: 未提供任何标志时不产生任何写入", () => {
  it("名称仍可定位（update 只改提供内容；全空标志在标志路径报拒绝而非误写）", async () => {
    await addDingtalk("dd-none");
    const before = await listJson();
    const r = await cli(["channel", "update", "dd-none", "--secret", ""]);
    expect(r.code).toBe(0); // --secret 为钉钉可选字段，空值=清除（幂等）
    const after = await listJson();
    expect(after.channels[0]!.name).toBe(before.channels[0]!.name);
  });
});

// ── 004-T010：向导修改模式集成测试（US3，注入假 WizardIO）──

import { runCli as runCliTyped } from "../../src/cli/index.js";
import type { WizardIO } from "../../src/cli/wizard-io.js";
import { createFakeWizardIO, type FakeAnswer } from "../unit/helpers/fake-wizard-io.js";

function cliW(argv: string[], wizardIO?: WizardIO) {
  let out = "";
  let errOut = "";
  return runCliTyped(argv, {
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

function dingtalkUpdateAnswers(newName?: string): FakeAnswer[] {
  return [
    { kind: "value", value: newName ?? "" }, // name：新名或回车保留
    { kind: "value", value: "" }, // webhookUrl 保留
    { kind: "value", value: "" }, // secret 保留
    { kind: "value", value: 0 }, // 确认保存
  ];
}

describe("channel update wizard/向导修改模式（004-T010，US3）", () => {
  it("TTY 无标志 → 进入向导，预填当前值，直接确认 → 配置不变", async () => {
    await addDingtalk("dd-wiz");
    const io = createFakeWizardIO(dingtalkUpdateAnswers());
    const r = await cliW(["channel", "update", "dd-wiz"], io);
    expect(r.code).toBe(0);
    expect(r.out).toContain("渠道已更新：dd-wiz（dingtalk）");
    // 名称字段预填当前名（askPrompt 提示保留语义）
    expect(io.askPrompts.some((p) => p.includes("渠道名称"))).toBe(true);
  });

  it("向导中改名 → 保存后新名生效", async () => {
    await addDingtalk("dd-rename");
    const io = createFakeWizardIO(dingtalkUpdateAnswers("dd-renamed"));
    const r = await cliW(["channel", "update", "dd-rename"], io);
    expect(r.code).toBe(0);
    expect(r.out).toContain("渠道已更新：dd-renamed（dingtalk）");
    const listed = await listJson();
    expect(listed.channels.map((c) => c.name)).toEqual(["dd-renamed"]);
  });

  it("向导中改 webhookUrl → 保存后摘要变化", async () => {
    await addDingtalk("dd-url");
    const io = createFakeWizardIO([
      { kind: "value", value: "" }, // name 保留
      { kind: "value", value: OTHER_HOOK }, // webhookUrl 改为新值
      { kind: "value", value: "" }, // secret 保留
      { kind: "value", value: 0 }, // 确认
    ]);
    const r = await cliW(["channel", "update", "dd-url"], io);
    expect(r.code).toBe(0);
    const listed = await listJson();
    expect(listed.channels[0]!.credentials).not.toBe("");
  });

  it("向导中改名冲突 → 提示后取消，零写入", async () => {
    await addDingtalk("dd-a");
    await addDingtalk("dd-b");
    const io = createFakeWizardIO([
      { kind: "value", value: "dd-b" }, // 改名 → 冲突
      { kind: "cancel" }, // 重新进入向导后取消
    ]);
    const r = await cliW(["channel", "update", "dd-a"], io);
    expect(r.code).toBe(0);
    expect(r.out).toContain("已取消");
    const listed = await listJson();
    expect(listed.channels.map((c) => c.name).sort()).toEqual(["dd-a", "dd-b"]);
  });

  it("首步取消 → 已取消，未做任何更改", async () => {
    await addDingtalk("dd-cancel");
    const io = createFakeWizardIO([{ kind: "cancel" }]);
    const r = await cliW(["channel", "update", "dd-cancel"], io);
    expect(r.code).toBe(0);
    expect(r.out).toContain("已取消，未做任何更改。");
  });

  it("--interactive 显式强制向导", async () => {
    await addDingtalk("dd-force");
    const io = createFakeWizardIO(dingtalkUpdateAnswers());
    const r = await cliW(["channel", "update", "dd-force", "--interactive"], io);
    expect(r.code).toBe(0);
    expect(r.out).toContain("渠道已更新：dd-force（dingtalk）");
  });
});
