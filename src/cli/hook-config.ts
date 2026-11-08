import type { Command } from "commander";
import { HookConfigManager, type TemplateView } from "../hooks/index.js";
import type { CliContext, OpenedStore } from "./index.js";

/**
 * CLI hook-config 子命令（006，contracts/cli-hook-config.md）：
 * list / show / enable / disable / validate；退出码 0/1/2/3。
 * 只读操作不修改目标配置与状态；启用/停用经 manager 原子写入后持久化。
 */

export function registerHookConfigCommands(
  parent: Command,
  makeContext: () => CliContext,
  openStore: (ctx: CliContext) => OpenedStore,
): void {
  const hookConfig = parent
    .command("hook-config")
    .description("管理智能体钩子配置模板（list/show/enable/disable/validate）");

  hookConfig
    .command("list")
    .description("列出跨平台/智能体钩子模板及启停状态")
    .option("--platform <platform>", "按平台过滤：linux|macos|windows")
    .option("--agent <agent>", "按智能体过滤：codebuddy|claude-code|codex-cli")
    .action((opts: { platform?: string; agent?: string }) => {
      const ctx = makeContext();
      const store = openStore(ctx);
      try {
        const manager = makeManager(ctx, store);
        const views = manager.list({
          platform: opts.platform,
          agent: opts.agent,
        });
        const rows = views.map(viewToRow);
        if (ctx.json) {
          ctx.out(`${JSON.stringify({ templates: rows }, null, 2)}\n`);
        } else {
          for (const row of rows) {
            ctx.out(
              `${row.id}\t${row.platform}\t${row.agent}\t${row.eventName}\t${
                row.enabled ? "已启动" : "不启动"
              }\t${row.lastValidationStatus}\n`,
            );
          }
        }
      } finally {
        store.close();
      }
    });

  hookConfig
    .command("show")
    .description("查看单个钩子模板的默认配置与状态")
    .argument("<template-id>", "模板标识，如 windows-codebuddy")
    .action((id: string) => {
      const ctx = makeContext();
      const store = openStore(ctx);
      try {
        const manager = makeManager(ctx, store);
        const view = manager.show(id);
        const row = viewToRow(view);
        if (ctx.json) {
          ctx.out(`${JSON.stringify({ template: row }, null, 2)}\n`);
        } else {
          ctx.out(
            `${row.id}\t${row.platform}/${row.agent}\t${row.eventName}\t${
              row.enabled ? "已启动" : "不启动"
            }\t${row.lastValidationStatus}\n目标配置：${row.configPath}\n命令：${row.command.join(" ")}\n`,
          );
        }
      } finally {
        store.close();
      }
    });

  hookConfig
    .command("enable")
    .description("启用钩子模板（写入目标智能体配置）")
    .argument("<template-id>", "模板标识，如 windows-codebuddy")
    .option("--confirm", "确认合并/覆盖既有配置（存在冲突时必需）")
    .action((id: string, opts: { confirm?: boolean }) => {
      const ctx = makeContext();
      const store = openStore(ctx);
      try {
        const manager = makeManager(ctx, store);
        const result = manager.enable(id, { confirm: opts.confirm === true });
        if (ctx.json) {
          ctx.out(`${JSON.stringify(result)}\n`);
        } else {
          ctx.out(
            result.alreadyPresent
              ? `已启用（钩子已存在，无需改动）：${result.templateId}\n`
              : `已启用：${result.templateId}\n`,
          );
        }
      } finally {
        store.close();
      }
    });

  hookConfig
    .command("disable")
    .description("停用钩子模板（仅移除本工具写入的配置）")
    .argument("<template-id>", "模板标识，如 windows-codebuddy")
    .action((id: string) => {
      const ctx = makeContext();
      const store = openStore(ctx);
      try {
        const manager = makeManager(ctx, store);
        const result = manager.disable(id);
        if (ctx.json) {
          ctx.out(`${JSON.stringify(result)}\n`);
        } else {
          ctx.out(
            result.removed
              ? `已停用并移除配置：${result.templateId}\n`
              : `已停用（未发现需移除的配置）：${result.templateId}\n`,
          );
        }
      } finally {
        store.close();
      }
    });

  hookConfig
    .command("validate")
    .description("校验目标智能体配置是否已包含本工具钩子")
    .argument("<template-id>", "模板标识，如 windows-codebuddy")
    .action((id: string) => {
      const ctx = makeContext();
      const store = openStore(ctx);
      try {
        const manager = makeManager(ctx, store);
        const result = manager.validate(id);
        if (ctx.json) {
          ctx.out(`${JSON.stringify(result)}\n`);
        } else {
          ctx.out(`${result.status}${result.message !== null ? `：${result.message}` : ""}\n`);
        }
      } finally {
        store.close();
      }
    });
}

function makeManager(ctx: CliContext, store: OpenedStore): HookConfigManager {
  return new HookConfigManager({
    homeDir: ctx.homeDir,
    repository: store.hookTemplates,
  });
}

interface HookTemplateRow {
  id: string;
  platform: string;
  agent: string;
  eventName: string;
  version: string;
  kind: string;
  configPath: string;
  command: string[];
  enabled: boolean;
  lastValidationStatus: string;
  lastValidationMessage: string | null;
}

function viewToRow(view: TemplateView): HookTemplateRow {
  return {
    id: view.id,
    platform: view.platform,
    agent: view.agent,
    eventName: view.eventName,
    version: view.version,
    kind: view.kind,
    configPath: view.configPath,
    command: view.command,
    enabled: view.enabled,
    lastValidationStatus: view.lastValidationStatus,
    lastValidationMessage: view.lastValidationMessage,
  };
}
