import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { codexConfigAdapter } from "../../src/hooks/codex-config.js";
import { buildHookTemplates, findHookTemplate } from "../../src/hooks/default-templates.js";

const def = findHookTemplate(buildHookTemplates(join("C:", "Users", "test")), "windows-codex-cli")!;

const NOTIFY = 'notify = ["notice", "hook", "--source", "codex-cli", "--payload-argv"]';

describe("codex config adapter / Codex TOML 适配（T015）", () => {
  it("文件不存在时生成 notify 行", () => {
    const r = codexConfigAdapter.merge(undefined, def);
    expect(r.content).toBe(`${NOTIFY}\n`);
    expect(r.conflict).toBe(false);
    expect(r.alreadyPresent).toBe(false);
  });

  it("无 notify 时追加", () => {
    const existing = 'model = "gpt-5"\n';
    const r = codexConfigAdapter.merge(existing, def);
    expect(r.content).toBe(`${existing}${NOTIFY}\n`);
    expect(r.conflict).toBe(false);
  });

  it("已有其他 notify → 冲突", () => {
    const r = codexConfigAdapter.merge('notify = ["other", "cmd"]\n', def);
    expect(r.conflict).toBe(true);
    expect(r.alreadyPresent).toBe(false);
    expect(r.content).toBe(`${NOTIFY}\n`);
  });

  it("已有本工具 notify → 幂等", () => {
    const existing = `${NOTIFY}\n`;
    const r = codexConfigAdapter.merge(existing, def);
    expect(r.alreadyPresent).toBe(true);
    expect(r.content).toBe(existing);
  });

  it("remove 移除本工具 notify 行", () => {
    const existing = `model = "gpt-5"\n${NOTIFY}\n`;
    const r = codexConfigAdapter.remove(existing, def);
    expect(r.removed).toBe(true);
    expect(r.content).toBe('model = "gpt-5"\n');
  });

  it("remove 不误删其他 notify", () => {
    const r = codexConfigAdapter.remove('notify = ["other", "cmd"]\n', def);
    expect(r.removed).toBe(false);
    expect(r.content).toBeUndefined();
  });

  it("contains 校验", () => {
    expect(codexConfigAdapter.contains(`${NOTIFY}\n`, def)).toBe(true);
    expect(codexConfigAdapter.contains('notify = ["other"]\n', def)).toBe(false);
  });
});
