import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { claudeCodeConfigAdapter } from "../../src/hooks/claude-code-config.js";
import { buildHookTemplates, findHookTemplate } from "../../src/hooks/default-templates.js";

const def = findHookTemplate(
  buildHookTemplates(join("C:", "Users", "test")),
  "windows-claude-code",
)!;

describe("claude code config adapter / Claude Code JSON 适配（T014）", () => {
  it("生成默认 Stop 钩子命令指向 claude-code", () => {
    const r = claudeCodeConfigAdapter.merge(undefined, def);
    expect(r.content).toContain("notice hook --source claude-code");
  });

  it("合并到既有 settings.json 且保留原内容", () => {
    const existing = JSON.stringify({ permissions: { allow: ["Bash"] } });
    const r = claudeCodeConfigAdapter.merge(existing, def);
    const doc = JSON.parse(r.content) as {
      permissions: { allow: string[] };
      hooks: { Stop: Array<{ hooks: Array<{ command: string }> }> };
    };
    expect(doc.permissions.allow).toEqual(["Bash"]);
    expect(doc.hooks.Stop[0]?.hooks[0]?.command).toBe("notice hook --source claude-code");
  });

  it("remove 移除本工具钩子且不误删无关字段", () => {
    const existing = JSON.stringify({
      permissions: { allow: ["Bash"] },
      hooks: { Stop: [{ hooks: [{ command: "notice hook --source claude-code" }] }] },
    });
    const r = claudeCodeConfigAdapter.remove(existing, def);
    const doc = JSON.parse(r.content!) as Record<string, unknown>;
    expect(doc.permissions).toEqual({ allow: ["Bash"] });
    expect(doc.hooks).toBeUndefined();
  });
});
