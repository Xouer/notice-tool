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
