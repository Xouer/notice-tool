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
