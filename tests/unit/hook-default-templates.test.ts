import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildHookTemplates,
  findHookTemplate,
  KNOWN_TEMPLATE_IDS,
} from "../../src/hooks/default-templates.js";

describe("hook default templates / 内置钩子模板（T004）", () => {
  const home = join("C:", "Users", "test");

  it("生成九种模板（3 平台 × 3 智能体）", () => {
    const templates = buildHookTemplates(home);
    expect(templates).toHaveLength(9);
    expect(KNOWN_TEMPLATE_IDS.size).toBe(9);
  });

  it("覆盖三种平台与三种智能体的组合 id", () => {
    const templates = buildHookTemplates(home);
    for (const id of [
      "windows-codebuddy",
      "windows-claude-code",
      "windows-codex-cli",
      "linux-codebuddy",
      "macos-codex-cli",
    ]) {
      expect(findHookTemplate(templates, id)?.id).toBe(id);
    }
  });

  it("CodeBuddy 为 JSON settings.json，命令正确", () => {
    const t = findHookTemplate(buildHookTemplates(home), "windows-codebuddy");
    expect(t?.kind).toBe("json");
    expect(t?.eventName).toBe("Stop");
    expect(t?.configPath).toBe(join(home, ".codebuddy", "settings.json"));
    expect(t?.command).toEqual(["notice", "hook", "--source", "codebuddy"]);
  });

  it("Codex 为 TOML config.toml，命令正确", () => {
    const t = findHookTemplate(buildHookTemplates(home), "windows-codex-cli");
    expect(t?.kind).toBe("toml");
    expect(t?.eventName).toBe("notify");
    expect(t?.configPath).toBe(join(home, ".codex", "config.toml"));
    expect(t?.command).toEqual(["notice", "hook", "--source", "codex-cli", "--payload-argv"]);
  });
});
