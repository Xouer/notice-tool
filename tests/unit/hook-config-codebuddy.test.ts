import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { codebuddyConfigAdapter } from "../../src/hooks/codebuddy-config.js";
import { buildHookTemplates, findHookTemplate } from "../../src/hooks/default-templates.js";
import { HookConfigError } from "../../src/hooks/types.js";

const def = findHookTemplate(buildHookTemplates(join("C:", "Users", "test")), "windows-codebuddy")!;

describe("codebuddy config adapter / CodeBuddy JSON 适配（T013）", () => {
  it("文件不存在时生成默认 Stop 钩子", () => {
    const r = codebuddyConfigAdapter.merge(undefined, def);
    expect(r.conflict).toBe(false);
    expect(r.alreadyPresent).toBe(false);
    const doc = JSON.parse(r.content) as {
      hooks: { Stop: Array<{ hooks: Array<{ command: string }> }> };
    };
    expect(doc.hooks.Stop[0]?.hooks[0]?.command).toBe("notice hook --source codebuddy");
  });

  it("已有其他钩子 → 冲突且保留原内容并追加", () => {
    const existing = JSON.stringify({
      hooks: { Stop: [{ hooks: [{ type: "command", command: "echo hi" }] }] },
    });
    const r = codebuddyConfigAdapter.merge(existing, def);
    expect(r.conflict).toBe(true);
    expect(r.alreadyPresent).toBe(false);
    const doc = JSON.parse(r.content) as {
      hooks: { Stop: Array<{ hooks: Array<{ command: string }> }> };
    };
    const commands = doc.hooks.Stop.flatMap((e) => e.hooks.map((h) => h.command));
    expect(commands).toContain("echo hi");
    expect(commands).toContain("notice hook --source codebuddy");
  });

  it("已包含本工具钩子 → 幂等（alreadyPresent）", () => {
    const existing = JSON.stringify({
      hooks: {
        Stop: [{ hooks: [{ type: "command", command: "notice hook --source codebuddy" }] }],
      },
    });
    const r = codebuddyConfigAdapter.merge(existing, def);
    expect(r.alreadyPresent).toBe(true);
    expect(r.conflict).toBe(false);
    expect(JSON.parse(r.content)).toEqual(JSON.parse(existing));
  });

  it("remove 仅移除本工具钩子", () => {
    const existing = JSON.stringify({
      hooks: {
        Stop: [
          { hooks: [{ type: "command", command: "echo hi" }] },
          { hooks: [{ type: "command", command: "notice hook --source codebuddy" }] },
        ],
      },
    });
    const r = codebuddyConfigAdapter.remove(existing, def);
    expect(r.removed).toBe(true);
    const doc = JSON.parse(r.content!) as {
      hooks: { Stop: Array<{ hooks: Array<{ command: string }> }> };
    };
    expect(doc.hooks.Stop.flatMap((e) => e.hooks.map((h) => h.command))).toEqual(["echo hi"]);
  });

  it("contains 校验是否存在本工具钩子", () => {
    const withOurs = JSON.stringify({
      hooks: { Stop: [{ hooks: [{ command: "notice hook --source codebuddy" }] }] },
    });
    expect(codebuddyConfigAdapter.contains(withOurs, def)).toBe(true);
    expect(codebuddyConfigAdapter.contains('{"hooks":{}}', def)).toBe(false);
  });

  it("非法 JSON → 抛出 invalid_content", () => {
    expect(() => codebuddyConfigAdapter.merge("{not json", def)).toThrow(HookConfigError);
  });
});
