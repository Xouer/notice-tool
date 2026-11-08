import { describe, expect, it } from "vitest";
import { ingestTaskEndEvent } from "../../src/core/event-pipeline.js";
import type { ChannelAdapter, SendOutcome, SendPayload } from "../../src/channels/adapter.js";
import { BlobCipher } from "../../src/storage/crypto.js";
import { InMemorySecretStore } from "../../src/storage/secret-store.js";
import { openMemoryDatabase } from "../../src/storage/db.js";
import { ChannelRepository } from "../../src/storage/channel-repository.js";
import { TemplateRepository } from "../../src/storage/template-repository.js";
import { seedDefaultTemplates } from "../../src/storage/seed.js";
import { notificationTemplates, type ChannelType } from "../../src/storage/schema.js";

/**
 * 009 通知内容契约测试（T007/T018，Red 先行）：
 * 标题敏感过滤、固定格式跨渠道一致性（contracts/notification-content.md）。
 */
class FakeAdapter implements ChannelAdapter {
  readonly sends: SendPayload[] = [];
  constructor(readonly type: ChannelType) {}

  async send(payload: SendPayload): Promise<SendOutcome> {
    this.sends.push(payload);
    return { ok: true };
  }
}

async function render(payload: unknown): Promise<string> {
  const db = openMemoryDatabase();
  seedDefaultTemplates(db);
  const channels = new ChannelRepository(
    db,
    new BlobCipher(new InMemorySecretStore().getMainKey()),
  );
  const templates = new TemplateRepository(db);
  const row = channels.create({
    type: "feishu",
    name: "渠道-feishu",
    credentials: { webhookUrl: "https://x.example/feishu" },
  });
  channels.setEnabled(row.id, true);
  const adapter = new FakeAdapter("feishu");
  await ingestTaskEndEvent(
    {
      db,
      channels,
      templates,
      getAdapter: () => adapter,
      config: { cooldownMinutes: 10 },
      dispatchOptions: { maxAttempts: 1, retryDelayMs: 1 },
    },
    payload,
  );
  return adapter.sends[0]?.message ?? "";
}

describe("notification content contract / 通知内容契约（T007/T018）", () => {
  it("标题含敏感信息时渲染前脱敏，不泄露明文", async () => {
    const secret = "sk-proj-abc123def456ghi789";
    const message = await render({
      schemaVersion: 1,
      source: "demo",
      taskId: "task-sec-title",
      title: `使用密钥 ${secret} 完成任务`,
      result: "success",
    });
    expect(message).not.toContain(secret);
    expect(message).toContain("[REDACTED]");
    expect(message).toContain("标题：使用密钥 [REDACTED] 完成任务");
  });

  it("五渠道默认模板 + 通用默认模板正文一致（固定格式跨渠道）", () => {
    const db = openMemoryDatabase();
    seedDefaultTemplates(db);
    const rows = db.select().from(notificationTemplates).all();
    expect(rows).toHaveLength(6);
    const bodies = new Set(rows.map((r) => r.body));
    expect(bodies.size).toBe(1);
    const body = rows[0]!.body;
    const lines = body.split("\n");
    expect(lines[0]).toBe("【任务完成通知】");
    expect(lines[1]).toBe("标题：{{title}}");
    expect(lines[2]).toBe("任务 {{task_id}}（来源 {{source_agent}}）已结束");
    expect(lines[3]).toBe("结果：{{result_status}}");
    expect(lines[4]).toBe("结束时间：{{finished_at}}");
    expect(lines[5]).toBe("概要：{{result_summary}}");
  });
});

/**
 * 010-US2 概要优先级契约测试（Red 先行）：
 * resultSummary → 任务结论 → 首条用户消息 → 结果状态兜底（contracts/task-context.md）。
 */
describe("task context summary priority / 概要优先级（010-US2）", () => {
  it("来源 resultSummary 优先于任务结论", async () => {
    const message = await render({
      schemaVersion: 1,
      source: "demo",
      taskId: "t-ctx-1",
      result: "success",
      resultSummary: "来源提供的概要",
      conclusion: "转录中的任务结论",
    });
    expect(message).toContain("概要：来源提供的概要");
  });

  it("无 resultSummary 时概要取任务结论", async () => {
    const message = await render({
      schemaVersion: 1,
      source: "demo",
      taskId: "t-ctx-2",
      result: "success",
      conclusion: "已修复样式并更新 3 个文件",
    });
    expect(message).toContain("概要：已修复样式并更新 3 个文件");
  });

  it("无结论时概要取首条用户消息", async () => {
    const message = await render({
      schemaVersion: 1,
      source: "demo",
      taskId: "t-ctx-3",
      result: "success",
      firstUserMessage: "帮我修复登录页样式",
    });
    expect(message).toContain("概要：帮我修复登录页样式");
  });

  it("均缺失时概要回退结果状态兜底", async () => {
    const message = await render({
      schemaVersion: 1,
      source: "demo",
      taskId: "t-ctx-4",
      result: "success",
    });
    expect(message).toContain("概要：任务成功完成");
  });

  it("结论中的敏感信息渲染前脱敏", async () => {
    const secret = "sk-proj-abc123def456ghi789";
    const message = await render({
      schemaVersion: 1,
      source: "demo",
      taskId: "t-ctx-5",
      result: "success",
      conclusion: `已完成，密钥 ${secret} 已轮换`,
    });
    expect(message).not.toContain(secret);
    expect(message).toContain("[REDACTED]");
  });

  it("超长结论截断至 500 字符", async () => {
    const message = await render({
      schemaVersion: 1,
      source: "demo",
      taskId: "t-ctx-6",
      result: "success",
      conclusion: "长".repeat(800),
    });
    const line = message.split("\n").find((l) => l.startsWith("概要：")) ?? "";
    expect(line.length).toBeLessThanOrEqual("概要：".length + 500);
  });
});
