import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runCli } from "../../src/cli/index.js";
import { openFileDatabase } from "../../src/storage/db.js";
import { taskEvents } from "../../src/storage/schema.js";

describe("hook config flow / 钩子配置端到端（T022）", () => {
  let dataDir: string;
  let homeDir: string;

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), "notice-hcf-data-"));
    homeDir = mkdtempSync(join(tmpdir(), "notice-hcf-home-"));
  });

  afterEach(() => {
    rmSync(dataDir, { recursive: true, force: true });
    rmSync(homeDir, { recursive: true, force: true });
  });

  function cli(argv: string[], stdin?: string) {
    return runCli(argv, {
      dataDir,
      homeDir,
      stdin: stdin !== undefined ? Readable.from([Buffer.from(stdin)]) : undefined,
      out: () => {},
      err: () => {},
    });
  }

  it("启用 → 智能体钩子命令写入 settings.json → 触发事件 → 去重 → 停用", async () => {
    // 1) 启用模板
    const enable = await cli(["hook-config", "enable", "windows-codebuddy", "--json"]);
    expect(enable).toBe(0);

    const settingsPath = join(homeDir, ".codebuddy", "settings.json");
    const settings = JSON.parse(readFileSync(settingsPath, "utf8")) as {
      hooks: { Stop: Array<{ hooks: Array<{ command: string }> }> };
    };
    const command = settings.hooks.Stop[0]?.hooks[0]?.command;
    expect(command).toBe("notice hook --source codebuddy");

    // 2) 模拟智能体 Stop 钩子调用 notice（携带稳定事件身份）
    const payload = JSON.stringify({
      session_id: "cb-session-0001",
      event_id: "cb-stop-0001",
      result: "success",
      resultSummary: "fixture：任务完成",
    });
    const first = await cli(["hook", "--source", "codebuddy"], payload);
    expect(first).toBe(0);

    const db = openFileDatabase(join(dataDir, "notice.db"));
    try {
      const events = db.select().from(taskEvents).all();
      expect(events).toHaveLength(1);
      expect(events[0]?.sourceAgent).toBe("codebuddy");
      expect(events[0]?.triggerType).toBe("hook");
    } finally {
      db.$client.close();
    }

    // 3) 重复上报同一稳定 Stop → 去重
    const dup = await cli(["hook", "--source", "codebuddy"], payload);
    expect(dup).toBe(0);
    const db2 = openFileDatabase(join(dataDir, "notice.db"));
    try {
      const events = db2.select().from(taskEvents).all();
      expect(events).toHaveLength(2);
      expect(events[1]?.notifyStatus).toBe("duplicated");
    } finally {
      db2.$client.close();
    }

    // 4) 停用 → 移除本工具写入的钩子
    const disable = await cli(["hook-config", "disable", "windows-codebuddy", "--json"]);
    expect(disable).toBe(0);
    expect(readFileSync(settingsPath, "utf8")).not.toContain("notice hook --source codebuddy");
  });

  it("Codex 启用写入 config.toml 的 notify 命令", async () => {
    const code = await cli(["hook-config", "enable", "linux-codex-cli", "--json"]);
    expect(code).toBe(0);
    const toml = readFileSync(join(homeDir, ".codex", "config.toml"), "utf8");
    expect(toml).toContain(
      'notify = ["notice", "hook", "--source", "codex-cli", "--payload-argv"]',
    );
  });
});
