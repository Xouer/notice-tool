import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Command } from "commander";
import { loadConfig, type NoticeConfig } from "../config/loader.js";
import { buildAdapters } from "../pollers/index.js";
import { PollingScheduler } from "../pollers/scheduler.js";
import { createIngest, CliFailure } from "./index.js";
import type { CliContext, OpenedStore } from "./index.js";

/**
 * 前台巡查模式（T053，FR-002）：无钩子时按可配间隔巡查智能体任务状态。
 * 不可读/不支持的适配器配置打印明确提示而非静默失败（FR-002 场景 3）。
 */
export function registerWatchCommand(
  parent: Command,
  makeContext: () => CliContext,
  openStore: (ctx: CliContext) => OpenedStore,
): void {
  parent
    .command("watch")
    .description("前台巡查模式：按间隔巡查智能体任务状态并触发通知")
    .action(async () => {
      const ctx = makeContext();
      const config = loadWatchConfig(ctx);
      if (!config.polling.enabled) {
        ctx.out("巡查未启用（config.polling.enabled = false）。\n");
        return;
      }
      let adapters;
      try {
        adapters = buildAdapters(config.polling.adapters);
      } catch (cause) {
        throw new CliFailure(
          `巡查配置错误：${cause instanceof Error ? cause.message : String(cause)}`,
          2,
        );
      }
      const store = openStore(ctx);
      const scheduler = new PollingScheduler({
        adapters,
        ingest: createIngest(store, ctx),
        intervalMs: config.polling.intervalSeconds * 1000,
        cooldownMinutes: config.dedup.cooldownMinutes,
        onError: (error, adapterName) => {
          ctx.err(`[巡查:${adapterName}] ${error.message}\n`);
        },
        onNotify: (info) => {
          ctx.out(
            info.deduplicated
              ? `[巡查] ${info.taskId} 为重复事件，未重复通知。\n`
              : `[巡查] ${info.taskId} 触发通知（成功 ${info.notified} 渠道）。\n`,
          );
        },
      });
      scheduler.start();
      ctx.out(
        `notice watch 已启动（间隔 ${config.polling.intervalSeconds}s，适配器：${adapters.map((a) => a.name).join("、")}）。Ctrl+C 退出。\n`,
      );
      const shutdown = (): void => {
        scheduler.stop();
        store.close();
        process.exit(0);
      };
      process.on("SIGINT", shutdown);
      process.on("SIGTERM", shutdown);
    });
}

function loadWatchConfig(ctx: CliContext): NoticeConfig {
  const configPath = ctx.configPath ?? join(ctx.dataDir, "config.json");
  if (!existsSync(configPath)) {
    return loadConfig({});
  }
  try {
    return loadConfig(readFileSync(configPath, "utf8"), (message) => ctx.err(`${message}\n`));
  } catch (cause) {
    throw new CliFailure(
      `配置文件无效：${cause instanceof Error ? cause.message : String(cause)}`,
      3,
    );
  }
}
