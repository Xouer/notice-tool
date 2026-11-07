import type { Command } from "commander";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { loadConfig, type NoticeConfig } from "../config/loader.js";
import { purgeExpiredHistory } from "../core/retention.js";
import { buildAdapters } from "../pollers/index.js";
import { PollingScheduler } from "../pollers/scheduler.js";
import { createIngest } from "./index.js";
import { CliFailure } from "./cli-failure.js";
import type { CliContext, OpenedStore } from "./index.js";

/**
 * 常驻服务入口（T044/T053，FR-001/FR-003）：
 * 钩子 HTTP 端点（仅回环地址）+ 巡查调度（polling.enabled 时）。
 */
export function registerServeCommand(
  parent: Command,
  makeContext: () => CliContext,
  openStore: (ctx: CliContext) => OpenedStore,
): void {
  parent
    .command("serve")
    .description("常驻服务：本地钩子 HTTP 端点 + 巡查调度")
    .action(async () => {
      const ctx = makeContext();
      const config = loadServeConfig(ctx);
      const store = openStore(ctx);
      // Fastify 重量级依赖仅在 serve 实际执行时加载（内存优化）
      const { createHookServer } = await import("../hookserver/server.js");
      const app = await createHookServer({
        ingest: (payload, trigger) => createIngest(store, ctx)(payload, trigger),
      });
      try {
        // 安全约束：HTTP 端点仅绑定回环地址（plan.md 约束 / FR-012），忽略配置中的 host
        await app.listen({ host: "127.0.0.1", port: config.server.port });
      } catch (cause) {
        store.close();
        throw new CliFailure(
          `服务启动失败：${cause instanceof Error ? cause.message : String(cause)}`,
          3,
        );
      }
      ctx.out(
        `notice serve 已启动：http://127.0.0.1:${config.server.port}/v1/hooks/task-completed\n`,
      );

      // 保留清理（T059）：每小时清理超 retentionDays 的通知历史
      const purgeTimer = setInterval(() => {
        try {
          purgeExpiredHistory(store.db, config.retentionDays);
        } catch (cause) {
          ctx.err(
            `[清理] 失败：${cause instanceof Error ? cause.message : String(cause)}\n`,
          );
        }
      }, 60 * 60 * 1000);
      purgeTimer.unref?.();

      // 巡查调度（US3 接入）：polling.enabled 时随 serve 启动
      let scheduler: PollingScheduler | undefined;
      if (config.polling.enabled) {
        try {
          const adapters = buildAdapters(config.polling.adapters);
          scheduler = new PollingScheduler({
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
            `巡查调度已启动（间隔 ${config.polling.intervalSeconds}s，适配器：${adapters.map((a) => a.name).join("、")}）\n`,
          );
        } catch (cause) {
          ctx.err(
            `巡查调度启动失败：${cause instanceof Error ? cause.message : String(cause)}\n`,
          );
        }
      }

      const shutdown = async (): Promise<void> => {
        clearInterval(purgeTimer);
        scheduler?.stop();
        await app.close();
        store.close();
        process.exit(0);
      };
      process.on("SIGINT", () => void shutdown());
      process.on("SIGTERM", () => void shutdown());
    });
}

function loadServeConfig(ctx: CliContext): NoticeConfig {
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
