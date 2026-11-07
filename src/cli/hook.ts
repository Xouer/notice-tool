import type { Command } from "commander";
import type { Readable } from "node:stream";
import { EventValidationError } from "../core/event-pipeline.js";
import { createIngest } from "./index.js";
import { CliFailure } from "./cli-failure.js";
import type { CliContext, OpenedStore } from "./index.js";

/**
 * CLI stdin 钩子入口（T043，contracts/hook-receiver.md 入口一）：
 * 从标准输入读取 UTF-8 JSON 负载，复用统一管线后退出。
 * 退出码：0 成功；2 负载校验失败（stderr 机器可读错误 JSON）；3 本地服务/存储异常。
 */
export function registerHookCommand(
  parent: Command,
  makeContext: () => CliContext,
  openStore: (ctx: CliContext) => OpenedStore,
): void {
  parent
    .command("hook")
    .description("从 stdin 读取任务结束事件 JSON 并触发通知（供智能体钩子注册）")
    .action(async () => {
      const ctx = makeContext();
      const raw = (await readStdin(ctx.stdin)).replace(/^\uFEFF/, "").trim();
      let payload: unknown;
      try {
        payload = JSON.parse(raw);
      } catch {
        ctx.err(`${JSON.stringify({ error: "VALIDATION_FAILED", details: ["stdin 不是合法 JSON"] })}\n`);
        throw new CliFailure("", 2);
      }
      const store = openStore(ctx);
      try {
        const result = await createIngest(store, ctx)(payload, "hook");
        const summary = {
          eventId: result.eventId,
          deduplicated: result.deduplicated,
          notified: result.records.length,
          message: result.message,
        };
        if (ctx.json) {
          ctx.out(`${JSON.stringify(summary)}\n`);
        } else if (result.deduplicated) {
          ctx.out(`事件为重复（冷却窗口内），已记录未重复通知：${result.eventId}\n`);
        } else if (result.records.length === 0) {
          ctx.out(`事件已受理：${result.eventId}\n${result.message ?? ""}\n`);
        } else {
          const sent = result.records.filter((r) => r.status === "sent").length;
          const failed = result.records.length - sent;
          ctx.out(
            `事件已受理：${result.eventId}（成功 ${sent} 渠道${failed > 0 ? `，失败 ${failed} 渠道` : ""}）\n`,
          );
        }
      } finally {
        store.close();
      }
    });
}

async function readStdin(injected?: Readable): Promise<string> {
  const stream = injected ?? process.stdin;
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

// EventValidationError 由根入口统一映射退出码 2（机器可读 JSON）
export { EventValidationError };
