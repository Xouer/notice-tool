import type { Command } from "commander";
import { TemplateError } from "../core/template.js";
import { CliFailure } from "./cli-failure.js";
import type { CliContext, OpenedStore } from "./index.js";

/**
 * CLI template 子命令（T040，contracts/cli.md FR-009）：
 * list / create / set-default / edit。
 */
export function registerTemplateCommands(
  parent: Command,
  makeContext: () => CliContext,
  openStore: (ctx: CliContext) => OpenedStore,
): void {
  const template = parent
    .command("template")
    .description("通知模板管理（list/create/set-default/edit）");

  template
    .command("list")
    .description("列出模板")
    .action(() => {
      const ctx = makeContext();
      const store = openStore(ctx);
      try {
        const templates = store.templates.list().map((t) => ({
          name: t.name,
          channelType: t.channelType,
          isDefault: t.isDefault,
          isBuiltin: t.isBuiltin,
          body: t.body,
        }));
        if (ctx.json) {
          ctx.out(`${JSON.stringify({ templates }, null, 2)}\n`);
        } else {
          for (const t of templates) {
            const scope = t.channelType === null ? "通用" : t.channelType;
            const flags = [
              t.isDefault ? "默认" : "",
              t.isBuiltin ? "内置" : "",
            ].filter(Boolean).join("/");
            ctx.out(`${t.name}\t${scope}\t${flags}\t${t.body.replace(/\n/g, " ⏎ ")}\n`);
          }
        }
      } finally {
        store.close();
      }
    });

  template
    .command("create")
    .description("创建模板（占位符白名单校验，保存即校验）")
    .requiredOption("--name <name>", "模板名称")
    .option("--channel-type <type>", "适用渠道类型（缺省为通用）")
    .requiredOption("--body <text>", "模板正文")
    .action((opts: { name: string; channelType?: string; body: string }) => {
      const ctx = makeContext();
      const store = openStore(ctx);
      try {
        const row = store.templates.create({
          name: opts.name,
          channelType: opts.channelType ?? null,
          body: opts.body,
        });
        ctx.out(
          ctx.json
            ? `${JSON.stringify({ created: row.name })}\n`
            : `模板已创建：${row.name}\n`,
        );
      } finally {
        store.close();
      }
    });

  template
    .command("set-default")
    .description("设为默认模板（同渠道互斥）")
    .argument("<name>", "模板名称")
    .action((name: string) => {
      const ctx = makeContext();
      const store = openStore(ctx);
      try {
        const row = store.templates.findByName(name);
        if (row === undefined) {
          throw new CliFailure(`未找到模板：${name}`, 2);
        }
        store.templates.setDefault(row.id);
        ctx.out(
          ctx.json
            ? `${JSON.stringify({ name, isDefault: true })}\n`
            : `已设为默认：${name}\n`,
        );
      } finally {
        store.close();
      }
    });

  template
    .command("edit")
    .description("编辑模板正文")
    .argument("<name>", "模板名称")
    .requiredOption("--body <text>", "新正文")
    .action((name: string, opts: { body: string }) => {
      const ctx = makeContext();
      const store = openStore(ctx);
      try {
        const row = store.templates.findByName(name);
        if (row === undefined) {
          throw new CliFailure(`未找到模板：${name}`, 2);
        }
        store.templates.updateBody(row.id, opts.body);
        ctx.out(
          ctx.json ? `${JSON.stringify({ name, edited: true })}\n` : `已更新：${name}\n`,
        );
      } catch (cause) {
        if (cause instanceof TemplateError) {
          throw new CliFailure(`模板校验失败：${cause.message}`, 2);
        }
        throw cause;
      } finally {
        store.close();
      }
    });
}
