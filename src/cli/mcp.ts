import type { Command } from "commander";
import { getAdapter } from "../channels/index.js";
import { createIngest } from "./index.js";
import type { SendNotificationParams } from "../mcp/tools/send-notification.js";
import type { CliContext, OpenedStore } from "./index.js";

/**
 * MCP stdio 启动入口（T058，FR-010）：供外部 MCP 客户端拉起。
 * 协议帧走 stdout；启动信息写 stderr。
 * MCP SDK 重量级依赖仅在命令实际执行时加载（内存优化）。
 */
export function registerMcpCommand(
  parent: Command,
  makeContext: () => CliContext,
  openStore: (ctx: CliContext) => OpenedStore,
): void {
  parent
    .command("mcp")
    .description("以 stdio 启动 MCP 服务端（供外部 MCP 客户端接入）")
    .action(async () => {
      const ctx = makeContext();
      const [{ StdioServerTransport }, { createMcpServer }, { sendNotificationImmediate }] =
        await Promise.all([
          import("@modelcontextprotocol/sdk/server/stdio.js"),
          import("../mcp/server.js"),
          import("../mcp/tools/send-notification.js"),
        ]);
      const store = openStore(ctx);
      const server = createMcpServer({
        ingestTaskEnd: async (payload) => {
          const result = await createIngest(store, ctx)(payload, "mcp");
          return { eventId: result.eventId, deduplicated: result.deduplicated };
        },
        sendNotification: (params) =>
          sendNotificationImmediate(
            { db: store.db, channels: store.repo, templates: store.templates, getAdapter },
            params as SendNotificationParams,
          ),
      });
      const transport = new StdioServerTransport();
      await server.connect(transport);
      ctx.err("notice MCP 服务已就绪（stdio）\n");
      // 进程由 stdio 传输保持存活；stdin 关闭后 SDK 传输结束，进程自然退出
    });
}
