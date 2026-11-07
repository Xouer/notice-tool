import { describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMcpServer } from "../../src/mcp/server.js";
import { ingestTaskEndEvent } from "../../src/core/event-pipeline.js";
import { sendNotificationImmediate } from "../../src/mcp/tools/send-notification.js";
import type { ChannelAdapter } from "../../src/channels/adapter.js";
import { BlobCipher } from "../../src/storage/crypto.js";
import { InMemorySecretStore } from "../../src/storage/secret-store.js";
import { openMemoryDatabase } from "../../src/storage/db.js";
import { ChannelRepository } from "../../src/storage/channel-repository.js";
import { TemplateRepository } from "../../src/storage/template-repository.js";
import { seedDefaultTemplates } from "../../src/storage/seed.js";
import { taskEvents } from "../../src/storage/schema.js";

/**
 * T054：MCP 工具契约测试（Red 先行，contracts/mcp-tools.md）。
 * 工具白名单仅 send_notification / report_task_end；入参 Schema；输出结构；
 * 错误码 VALIDATION_FAILED / RATE_LIMITED / INTERNAL；trigger 强制 mcp。
 */
function makeDeps() {
  const db = openMemoryDatabase();
  seedDefaultTemplates(db);
  const channels = new ChannelRepository(db, new BlobCipher(new InMemorySecretStore().getMainKey()));
  const templates = new TemplateRepository(db);
  const sendLog: string[] = [];
  const getAdapter = (type: "feishu" | "dingtalk"): ChannelAdapter => ({
    type,
    send: async () => {
      sendLog.push(type);
      return { ok: true };
    },
  });
  for (const type of ["feishu", "dingtalk"] as const) {
    const row = channels.create({
      type,
      name: `渠道-${type}`,
      credentials: { webhookUrl: `https://x.example/${type}` },
    });
    channels.setEnabled(row.id, true);
  }
  return { db, channels, templates, getAdapter, sendLog, config: { cooldownMinutes: 10 } };
}

function makeServer(deps: ReturnType<typeof makeDeps>) {
  return createMcpServer({
    ingestTaskEnd: async (payload) => {
      const result = await ingestTaskEndEvent(deps, payload, { trigger: "mcp" });
      return { eventId: result.eventId, deduplicated: result.deduplicated };
    },
    sendNotification: (params) => sendNotificationImmediate(deps, params),
  });
}

async function connect(server: ReturnType<typeof makeServer>) {
  const client = new Client({ name: "test-client", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return client;
}

function textOf(result: { content: Array<{ type: string; text?: string }> }): string {
  return result.content[0]?.text ?? "";
}

describe("MCP tools / MCP 工具契约（T054）", () => {
  it("工具白名单仅 send_notification 与 report_task_end", async () => {
    const client = await connect(makeServer(makeDeps()));
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(["report_task_end", "send_notification"]);
  });

  it("send_notification 入参 Schema（message 必填 ≤2000、title ≤100、channels 数组）", async () => {
    const client = await connect(makeServer(makeDeps()));
    const { tools } = await client.listTools();
    const tool = tools.find((t) => t.name === "send_notification");
    const schema = tool?.inputSchema as {
      required: string[];
      properties: Record<string, { type: string; maxLength?: number; items?: unknown }>;
    };
    expect(schema.required).toContain("message");
    expect(schema.required).toContain("schemaVersion");
    expect(schema.properties.message.maxLength).toBe(2000);
    expect(schema.properties.title.maxLength).toBe(100);
    expect(schema.properties.channels.type).toBe("array");
  });

  it("report_task_end 入参 Schema 与 hook 负载一致", async () => {
    const client = await connect(makeServer(makeDeps()));
    const { tools } = await client.listTools();
    const tool = tools.find((t) => t.name === "report_task_end");
    const schema = tool?.inputSchema as {
      required: string[];
      properties: Record<string, { type: string; maxLength?: number; enum?: string[] }>;
    };
    expect(schema.required).toEqual(
      expect.arrayContaining(["schemaVersion", "source", "taskId"]),
    );
    expect(schema.properties.source.maxLength).toBe(64);
    expect(schema.properties.taskId.maxLength).toBe(256);
    expect(schema.properties.resultSummary.maxLength).toBe(500);
    expect(schema.properties.result.enum).toContain("success");
  });

  it("send_notification 缺省发送全部已启用渠道，输出 delivered/failed", async () => {
    const deps = makeDeps();
    const client = await connect(makeServer(deps));
    const result = await client.callTool({
      name: "send_notification",
      arguments: { schemaVersion: 1, title: "构建完成", message: "产物 12.4 MB" },
    });
    expect(result.isError).toBeFalsy();
    const body = JSON.parse(textOf(result)) as { delivered: string[]; failed: unknown[] };
    expect(body.delivered).toHaveLength(2);
    expect(body.failed).toEqual([]);
    expect(deps.sendLog).toHaveLength(2);
  });

  it("send_notification channels 过滤：仅发送指定类型", async () => {
    const deps = makeDeps();
    const client = await connect(makeServer(deps));
    const result = await client.callTool({
      name: "send_notification",
      arguments: { schemaVersion: 1, message: "hello", channels: ["feishu"] },
    });
    const body = JSON.parse(textOf(result)) as { delivered: string[] };
    expect(body.delivered).toHaveLength(1);
    expect(deps.sendLog).toEqual(["feishu"]);
  });

  it("send_notification 超长 message → VALIDATION_FAILED 且不落库", async () => {
    const deps = makeDeps();
    const client = await connect(makeServer(deps));
    const result = await client.callTool({
      name: "send_notification",
      arguments: { schemaVersion: 1, message: "x".repeat(2001) },
    });
    expect(result.isError).toBe(true);
    const body = JSON.parse(textOf(result)) as { error: string };
    expect(body.error).toBe("VALIDATION_FAILED");
    expect(deps.db.select().from(taskEvents).all()).toHaveLength(0); // 不落库
  });

  it("report_task_end 走与钩子一致流程且 trigger 强制 mcp", async () => {
    const deps = makeDeps();
    const client = await connect(makeServer(deps));
    const result = await client.callTool({
      name: "report_task_end",
      arguments: {
        schemaVersion: 1,
        source: "external-agent",
        taskId: "task-101",
        result: "success",
        trigger: "hook", // 调用方传入值被覆盖
      },
    });
    expect(result.isError).toBeFalsy();
    const body = JSON.parse(textOf(result)) as { eventId: string; deduplicated: boolean };
    expect(body.eventId).toBeTruthy();
    expect(body.deduplicated).toBe(false);
    const event = deps.db.select().from(taskEvents).get();
    expect(event?.triggerType).toBe("mcp");
    expect(event?.sourceAgent).toBe("external-agent");
  });

  it("report_task_end 同 (source, taskId) 去重", async () => {
    const deps = makeDeps();
    const client = await connect(makeServer(deps));
    const args = { schemaVersion: 1, source: "demo", taskId: "dup-1" };
    await client.callTool({ name: "report_task_end", arguments: args });
    const second = await client.callTool({ name: "report_task_end", arguments: args });
    const body = JSON.parse(textOf(second)) as { deduplicated: boolean };
    expect(body.deduplicated).toBe(true);
  });

  it("report_task_end 非法负载 → VALIDATION_FAILED 不落库", async () => {
    const deps = makeDeps();
    const client = await connect(makeServer(deps));
    const result = await client.callTool({
      name: "report_task_end",
      arguments: { schemaVersion: 1, taskId: "no-source" },
    });
    expect(result.isError).toBe(true);
    const body = JSON.parse(textOf(result)) as { error: string; details: string[] };
    expect(body.error).toBe("VALIDATION_FAILED");
    expect(Array.isArray(body.details)).toBe(true);
    expect(deps.db.select().from(taskEvents).all()).toHaveLength(0); // 不落库
  });
});
