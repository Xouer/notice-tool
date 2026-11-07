import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runCli } from "../../src/cli/index.js";

/**
 * T034：CLI template 子命令契约测试（Red 先行，contracts/cli.md）。
 * template list/set-default/edit 子命令、退出码 0/1/2/3 与 --json 输出。
 */
let dataDir: string;

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), "notice-tpl-"));
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

describe("CLI template commands / 模板子命令契约（T034）", () => {
  it("template list --json 输出内置默认模板（5 渠道 + 1 通用）", async () => {
    const { code, out } = await cli(["template", "list", "--json"]);
    expect(code).toBe(0);
    const parsed = JSON.parse(out.trim()) as {
      templates: Array<{ name: string; channelType: string | null; isDefault: boolean; isBuiltin: boolean }>;
    };
    expect(parsed.templates).toHaveLength(6);
    expect(parsed.templates.filter((t) => t.isDefault)).toHaveLength(6);
    expect(parsed.templates.some((t) => t.channelType === null)).toBe(true);
  });

  it("template set-default 生效", async () => {
    const created = await cli([
      "template",
      "create",
      "--name",
      "简报",
      "--channel-type",
      "feishu",
      "--body",
      "{{task_id}} 完成了",
    ]);
    expect(created.code).toBe(0);
    const set = await cli(["template", "set-default", "简报"]);
    expect(set.code).toBe(0);
    const listed = JSON.parse(
      (await cli(["template", "list", "--json"])).out.trim(),
    ) as { templates: Array<{ name: string; isDefault: boolean }> };
    const mine = listed.templates.find((t) => t.name === "简报");
    expect(mine?.isDefault).toBe(true);
    expect(listed.templates.find((t) => t.name === "default-feishu")?.isDefault).toBe(false);
  });

  it("template edit --body 更新正文（合法占位符）", async () => {
    await cli(["template", "create", "--name", "自定义", "--body", "{{task_id}}"]);
    const { code } = await cli([
      "template",
      "edit",
      "自定义",
      "--body",
      "{{task_id}}（{{source_agent}}）结束：{{result_status}}",
    ]);
    expect(code).toBe(0);
    const listed = JSON.parse(
      (await cli(["template", "list", "--json"])).out.trim(),
    ) as { templates: Array<{ name: string; body: string }> };
    expect(listed.templates.find((t) => t.name === "自定义")?.body).toContain("{{source_agent}}");
  });

  it("template edit 未知占位符 → 退出码 2", async () => {
    await cli(["template", "create", "--name", "自定义", "--body", "{{task_id}}"]);
    const { code } = await cli(["template", "edit", "自定义", "--body", "{{oops}}"]);
    expect(code).toBe(2);
  });

  it("template create 未知占位符 → 退出码 2", async () => {
    const { code } = await cli([
      "template",
      "create",
      "--name",
      "bad",
      "--body",
      "{{nope}}",
    ]);
    expect(code).toBe(2);
  });

  it("template set-default 未知模板 → 退出码 2", async () => {
    const { code } = await cli(["template", "set-default", "ghost"]);
    expect(code).toBe(2);
  });

  it("template edit 内置模板正文允许更新（default-feishu）", async () => {
    const { code } = await cli([
      "template",
      "edit",
      "default-feishu",
      "--body",
      "自定义默认正文 {{task_id}}",
    ]);
    expect(code).toBe(0);
  });
});
