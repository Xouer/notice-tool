import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runCli } from "../../src/cli/index.js";

/**
 * T017：CLI channel 子命令契约测试（Red 先行，contracts/cli.md）。
 * - 子命令集合 add/list/enable/disable/remove/test
 * - 退出码 0/1/2/3
 * - --json 输出结构
 * - list 输出一律掩码凭据
 */
const WEBHOOK =
  "https://open.feishu.example/open-apis/bot/v2/hook/0d1e2f3a4b5c6d7e8f9a0b1c";

let dataDir: string;

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), "notice-cli-test-"));
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

describe("CLI channel subcommands / 渠道子命令契约（T017）", () => {
  it("channel --help 列出全部六个子命令", async () => {
    const { code, out } = await cli(["channel", "--help"]);
    expect(code).toBe(0);
    for (const sub of ["add", "list", "enable", "disable", "remove", "test"]) {
      expect(out).toContain(sub);
    }
  });

  it("channel list --json 空列表返回 { channels: [] }，退出码 0", async () => {
    const { code, out } = await cli(["channel", "list", "--json"]);
    expect(code).toBe(0);
    expect(JSON.parse(out.trim())).toEqual({ channels: [] });
  });

  it("add 渠道成功退出码 0；list 可见且凭据掩码", async () => {
    const added = await cli([
      "channel",
      "add",
      "feishu",
      "--name",
      "群机器人",
      "--webhook-url",
      WEBHOOK,
    ]);
    expect(added.code).toBe(0);

    const listed = await cli(["channel", "list", "--json"]);
    expect(listed.code).toBe(0);
    const parsed = JSON.parse(listed.out.trim()) as {
      channels: Array<{ name: string; type: string; enabled: boolean; credentials: string }>;
    };
    expect(parsed.channels).toHaveLength(1);
    const ch = parsed.channels[0];
    expect(ch.name).toBe("群机器人");
    expect(ch.type).toBe("feishu");
    expect(ch.enabled).toBe(false);
    expect(ch.credentials).not.toContain("0d1e2f3a4b5c6d7e8f9a0b1c");
    expect(listed.out).not.toContain(WEBHOOK);
  });

  it("add 非法类型 → 退出码 2", async () => {
    const { code } = await cli([
      "channel",
      "add",
      "slack",
      "--name",
      "x",
      "--webhook-url",
      WEBHOOK,
    ]);
    expect(code).toBe(2);
  });

  it("add 缺必填凭据（--webhook-url）→ 退出码 2", async () => {
    const { code } = await cli(["channel", "add", "feishu", "--name", "x"]);
    expect(code).toBe(2);
  });

  it("add 缺 --name → 退出码 2", async () => {
    const { code } = await cli(["channel", "add", "feishu", "--webhook-url", WEBHOOK]);
    expect(code).toBe(2);
  });

  it("enable/disable/remove 未知渠道 → 退出码 2", async () => {
    expect((await cli(["channel", "enable", "ghost"])).code).toBe(2);
    expect((await cli(["channel", "disable", "ghost"])).code).toBe(2);
    expect((await cli(["channel", "remove", "ghost"])).code).toBe(2);
  });

  it("enable/disable 往返生效（list enabled 字段变化）", async () => {
    await cli(["channel", "add", "feishu", "--name", "群机器人", "--webhook-url", WEBHOOK]);
    expect((await cli(["channel", "enable", "群机器人"])).code).toBe(0);
    const enabled = JSON.parse(
      (await cli(["channel", "list", "--json"])).out.trim(),
    ) as { channels: Array<{ enabled: boolean }> };
    expect(enabled.channels[0]?.enabled).toBe(true);
    expect((await cli(["channel", "disable", "群机器人"])).code).toBe(0);
    const disabled = JSON.parse(
      (await cli(["channel", "list", "--json"])).out.trim(),
    ) as { channels: Array<{ enabled: boolean }> };
    expect(disabled.channels[0]?.enabled).toBe(false);
  });

  it("remove 后列表为空，退出码 0", async () => {
    await cli(["channel", "add", "feishu", "--name", "临时", "--webhook-url", WEBHOOK]);
    expect((await cli(["channel", "remove", "临时"])).code).toBe(0);
    const listed = JSON.parse(
      (await cli(["channel", "list", "--json"])).out.trim(),
    ) as { channels: unknown[] };
    expect(listed.channels).toHaveLength(0);
  });

  it("全局 --config 可指定配置文件路径", async () => {
    const { code } = await cli(["--config", join(dataDir, "custom.json"), "channel", "list", "--json"]);
    expect(code).toBe(0);
  });
});

describe("feishu app-mode CLI flags / 飞书应用凭证 CLI 标志（002-T003）", () => {
  const APP_ID = "cli_a1b2c3d4e5f6";
  const APP_SECRET = "feishu-app-secret-9876543210";
  const RECEIVE_ID = "oc_1234567890abcdef";

  function addArgs(name: string, extra: string[] = []): string[] {
    return [
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
      APP_SECRET,
      "--receive-id-type",
      "chat_id",
      "--receive-id",
      RECEIVE_ID,
      ...extra,
    ];
  }

  it("add feishu --mode app 成功退出码 0；list 掩码且不含 appSecret 原文", async () => {
    const added = await cli(addArgs("应用凭证"));
    expect(added.code).toBe(0);

    const listed = await cli(["channel", "list", "--json"]);
    expect(listed.code).toBe(0);
    const parsed = JSON.parse(listed.out.trim()) as {
      channels: Array<{ name: string; type: string; credentials: string }>;
    };
    expect(parsed.channels).toHaveLength(1);
    expect(parsed.channels[0]?.credentials).not.toContain(APP_SECRET);
    expect(listed.out).not.toContain(APP_SECRET);
    expect(listed.out).not.toContain(RECEIVE_ID);
  });

  it("缺 --receive-id-type / --receive-id → 退出码 2 且提示对应标志名", async () => {
    const missingType = await cli([
      "channel", "add", "feishu", "--name", "x", "--mode", "app",
      "--app-id", APP_ID, "--app-secret", APP_SECRET, "--receive-id", RECEIVE_ID,
    ]);
    expect(missingType.code).toBe(2);
    expect(`${missingType.out}${missingType.errOut}`).toContain("receiveIdType");

    const missingId = await cli([
      "channel", "add", "feishu", "--name", "x", "--mode", "app",
      "--app-id", APP_ID, "--app-secret", APP_SECRET, "--receive-id-type", "chat_id",
    ]);
    expect(missingId.code).toBe(2);
    expect(`${missingId.out}${missingId.errOut}`).toContain("receiveId");
  });

  it("非法 --receive-id-type → 退出码 2", async () => {
    const { code } = await cli([
      "channel", "add", "feishu", "--name", "x", "--mode", "app",
      "--app-id", APP_ID, "--app-secret", APP_SECRET,
      "--receive-id-type", "wechat_id", "--receive-id", RECEIVE_ID,
    ]);
    expect(code).toBe(2);
  });

  it("缺 --mode 时 feishu 仍按 webhook 校验（既有行为零回归）", async () => {
    const { code } = await cli(["channel", "add", "feishu", "--name", "旧方式", "--webhook-url", WEBHOOK]);
    expect(code).toBe(0);
  });

  it("--app-id/--app-secret 对 QQ 渠道既有用法无回归", async () => {
    const { code } = await cli([
      "channel", "add", "qq", "--name", "qq-bot", "--mode", "official",
      "--app-id", "qq-app-id", "--app-secret", "qq-app-secret",
      "--endpoint", "https://api.qq.example/channels/1/messages",
    ]);
    expect(code).toBe(0);
  });

  it("--mode 非法值 → 退出码 2", async () => {
    const { code } = await cli(addArgs("x", ["--mode", "bot"]));
    expect(code).toBe(2);
  });
});
