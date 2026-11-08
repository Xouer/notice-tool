import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runCli } from "../../src/cli/index.js";

describe("CLI hook-config commands / hook-config 子命令契约（T010）", () => {
  let dataDir: string;
  let homeDir: string;

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), "notice-hc-data-"));
    homeDir = mkdtempSync(join(tmpdir(), "notice-hc-home-"));
  });

  afterEach(() => {
    rmSync(dataDir, { recursive: true, force: true });
    rmSync(homeDir, { recursive: true, force: true });
  });

  function cli(argv: string[]) {
    let out = "";
    let errOut = "";
    return runCli(argv, {
      dataDir,
      homeDir,
      out: (s) => {
        out += s;
      },
      err: (s) => {
        errOut += s;
      },
    }).then((code) => ({ code, out, errOut }));
  }

  it("list --json 返回九种模板且默认不启动", async () => {
    const { code, out } = await cli(["hook-config", "list", "--json"]);
    expect(code).toBe(0);
    const parsed = JSON.parse(out.trim()) as {
      templates: Array<{ id: string; enabled: boolean }>;
    };
    expect(parsed.templates).toHaveLength(9);
    expect(parsed.templates.every((t) => t.enabled === false)).toBe(true);
  });

  it("list --platform windows 仅返回 3 条", async () => {
    const { out } = await cli(["hook-config", "list", "--platform", "windows", "--json"]);
    const parsed = JSON.parse(out.trim()) as { templates: Array<{ platform: string }> };
    expect(parsed.templates).toHaveLength(3);
    expect(parsed.templates.every((t) => t.platform === "windows")).toBe(true);
  });

  it("show 返回模板详情", async () => {
    const { code, out } = await cli(["hook-config", "show", "windows-codebuddy", "--json"]);
    expect(code).toBe(0);
    const parsed = JSON.parse(out.trim()) as {
      template: { agent: string; command: string[] };
    };
    expect(parsed.template.agent).toBe("codebuddy");
    expect(parsed.template.command).toEqual(["notice", "hook", "--source", "codebuddy"]);
  });

  it("enable 写入目标配置并置为已启动", async () => {
    const { code, out } = await cli(["hook-config", "enable", "windows-codebuddy", "--json"]);
    expect(code).toBe(0);
    expect(JSON.parse(out.trim())).toMatchObject({
      templateId: "windows-codebuddy",
      enabled: true,
    });
    const settingsPath = join(homeDir, ".codebuddy", "settings.json");
    expect(existsSync(settingsPath)).toBe(true);
    expect(readFileSync(settingsPath, "utf8")).toContain("notice hook --source codebuddy");
  });

  it("enable 重复执行幂等", async () => {
    await cli(["hook-config", "enable", "windows-codebuddy", "--json"]);
    const second = await cli(["hook-config", "enable", "windows-codebuddy", "--json"]);
    expect(second.code).toBe(0);
    expect(JSON.parse(second.out.trim())).toMatchObject({ alreadyPresent: true });
  });

  it("enable 冲突未确认 → 退出码 2", async () => {
    const settingsPath = join(homeDir, ".codebuddy", "settings.json");
    await cli(["hook-config", "enable", "windows-codebuddy", "--json"]);
    // 预置一个用户自定义钩子（覆盖 ours）
    mkdirSync(join(homeDir, ".codebuddy"), { recursive: true });
    writeFileSync(
      settingsPath,
      JSON.stringify({
        hooks: { Stop: [{ hooks: [{ type: "command", command: "echo custom" }] }] },
      }),
      "utf8",
    );
    const { code, errOut } = await cli(["hook-config", "enable", "windows-codebuddy", "--json"]);
    expect(code).toBe(2);
    expect(errOut).toContain("--confirm");
  });

  it("disable 移除本工具配置", async () => {
    await cli(["hook-config", "enable", "windows-codebuddy", "--json"]);
    const { code, out } = await cli(["hook-config", "disable", "windows-codebuddy", "--json"]);
    expect(code).toBe(0);
    expect(JSON.parse(out.trim())).toMatchObject({ enabled: false });
    const settingsPath = join(homeDir, ".codebuddy", "settings.json");
    expect(readFileSync(settingsPath, "utf8")).not.toContain("notice hook --source codebuddy");
  });

  it("validate 报告 invalid → valid", async () => {
    const before = await cli(["hook-config", "validate", "windows-codex-cli", "--json"]);
    expect(before.code).toBe(0);
    expect(JSON.parse(before.out.trim())).toMatchObject({ status: "invalid" });
    await cli(["hook-config", "enable", "windows-codex-cli", "--json"]);
    const after = await cli(["hook-config", "validate", "windows-codex-cli", "--json"]);
    expect(JSON.parse(after.out.trim())).toMatchObject({ status: "valid" });
  });

  it("status 输出四类诊断字段", async () => {
    await cli(["hook-config", "enable", "windows-codebuddy", "--json"]);
    const { code, out } = await cli(["hook-config", "status", "windows-codebuddy", "--json"]);
    expect(code).toBe(0);
    const parsed = JSON.parse(out.trim()) as {
      enabled: boolean;
      hookValid: string;
      platformMatches: boolean;
      recentEvent: { found: boolean };
      recentNotification: { found: boolean };
    };
    expect(parsed.enabled).toBe(true);
    expect(parsed.hookValid).toBe("valid");
    expect(parsed.platformMatches).toBe(true);
    expect(parsed.recentEvent.found).toBe(false);
    expect(parsed.recentNotification.found).toBe(false);
  });

  it("show 输出平台匹配与安装状态", async () => {
    const { out } = await cli(["hook-config", "show", "windows-codebuddy", "--json"]);
    const parsed = JSON.parse(out.trim()) as { template: { platformMatches: boolean } };
    expect(parsed.template.platformMatches).toBe(true);
  });

  it("未知模板 → 退出码 2", async () => {
    const { code } = await cli(["hook-config", "show", "ghost", "--json"]);
    expect(code).toBe(2);
  });
});
