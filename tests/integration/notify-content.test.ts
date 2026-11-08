import { describe, expect, it } from "vitest";
import { ingestTaskEndEvent } from "../../src/core/event-pipeline.js";
import { formatLocalDateTime } from "../../src/core/notification-content.js";
import type { ChannelAdapter, SendOutcome, SendPayload } from "../../src/channels/adapter.js";
import { BlobCipher } from "../../src/storage/crypto.js";
import { InMemorySecretStore } from "../../src/storage/secret-store.js";
import { openMemoryDatabase } from "../../src/storage/db.js";
import { ChannelRepository } from "../../src/storage/channel-repository.js";
import { TemplateRepository } from "../../src/storage/template-repository.js";
import { seedDefaultTemplates } from "../../src/storage/seed.js";
import type { ChannelType } from "../../src/storage/schema.js";

/**
 * 009 通知内容集成测试（T013/T015，Red 先行）：
 * 模拟事件 → :memory: 库 → 假渠道适配器 → 断言最终通知文本的
 * 标题/本地时间/非空概要渲染语义（contracts/notification-content.md）。
 */
class FakeAdapter implements ChannelAdapter {
  readonly sends: SendPayload[] = [];
  constructor(readonly type: ChannelType) {}

  async send(payload: SendPayload): Promise<SendOutcome> {
    this.sends.push(payload);
    return { ok: true };
  }
}

async function ingestOnce(payload: unknown): Promise<string> {
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

describe("notification content / 通知内容渲染（T013/T015）", () => {
  it("标题：来源提供 title 时首行渲染为标题", async () => {
    const message = await ingestOnce({
      schemaVersion: 1,
      source: "codebuddy",
      taskId: "0c489af57ca84e9599e46cf2da32a945",
      title: "修复登录页样式问题",
      result: "success",
    });
    const lines = message.split("\n");
    expect(lines[0]).toBe("【任务完成通知】");
    expect(lines[1]).toBe("标题：修复登录页样式问题");
  });

  it("标题：未提供 title 时首行为兜底标题 source · taskId 前 6 位", async () => {
    const message = await ingestOnce({
      schemaVersion: 1,
      source: "codebuddy",
      taskId: "0c489af57ca84e9599e46cf2da32a945",
      result: "success",
    });
    expect(message).toContain("标题：codebuddy · 0c489a");
  });

  it("时间：finishedAt 以本地时区 YYYY-MM-DD HH:mm:ss 渲染，非 UTC ISO", async () => {
    const finishedAt = "2026-11-08T04:15:47.269Z";
    const message = await ingestOnce({
      schemaVersion: 1,
      source: "demo",
      taskId: "task-time",
      finishedAt,
      result: "success",
    });
    const expected = formatLocalDateTime(new Date(finishedAt));
    expect(message).toContain(`结束时间：${expected}`);
    expect(message).not.toContain("T04:15:47");
    expect(message).not.toContain(".269Z");
  });

  it("时间：未提供 finishedAt 时用接收时间且同为本地可读格式", async () => {
    const message = await ingestOnce({
      schemaVersion: 1,
      source: "demo",
      taskId: "task-time-default",
      result: "success",
    });
    expect(message).toMatch(/结束时间：\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/);
  });

  it("概要：未提供 resultSummary 时按结果状态兜底", async () => {
    const success = await ingestOnce({
      schemaVersion: 1,
      source: "demo",
      taskId: "task-sum-success",
      result: "success",
    });
    expect(success).toContain("概要：任务成功完成");

    const failure = await ingestOnce({
      schemaVersion: 1,
      source: "demo",
      taskId: "task-sum-failure",
      result: "failure",
    });
    expect(failure).toContain("概要：任务失败");

    const unknown = await ingestOnce({
      schemaVersion: 1,
      source: "demo",
      taskId: "task-sum-unknown",
    });
    expect(unknown).toContain("概要：任务结束（结果未知）");
  });

  it("概要：提供 resultSummary 时保留原值（非空白）", async () => {
    const message = await ingestOnce({
      schemaVersion: 1,
      source: "demo",
      taskId: "task-sum-provided",
      result: "success",
      resultSummary: "修复了登录页样式（3 个文件）",
    });
    expect(message).toContain("概要：修复了登录页样式（3 个文件）");
  });
});

/**
 * 010-US3 连续任务可区分集成测试：
 * 同一会话内不同任务（不同事件键/标题/概要）产生可区分通知；不同会话亦然。
 */
async function ingestMany(payloads: unknown[]): Promise<string[]> {
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
  const deps = {
    db,
    channels,
    templates,
    getAdapter: () => adapter,
    config: { cooldownMinutes: 10 },
    dispatchOptions: { maxAttempts: 1, retryDelayMs: 1 },
  };
  const messages: string[] = [];
  for (const payload of payloads) {
    await ingestTaskEndEvent(deps, payload);
    messages.push(adapter.sends.at(-1)?.message ?? "");
  }
  return messages;
}

describe("task distinguishability / 连续任务可区分（010-US3）", () => {
  it("同一会话两个不同任务 → 两条通知标题/概要可区分", async () => {
    const [first, second] = await ingestMany([
      {
        schemaVersion: 1,
        source: "codebuddy",
        taskId: "session-shared-001",
        eventKey: "stop-shared-1",
        title: "修复登录页样式",
        conclusion: "已定位问题并修复样式",
        result: "success",
      },
      {
        schemaVersion: 1,
        source: "codebuddy",
        taskId: "session-shared-001",
        eventKey: "stop-shared-2",
        title: "补充参数校验",
        conclusion: "已完成参数校验并更新测试",
        result: "success",
      },
    ]);
    expect(first).toContain("标题：修复登录页样式");
    expect(first).toContain("概要：已定位问题并修复样式");
    expect(second).toContain("标题：补充参数校验");
    expect(second).toContain("概要：已完成参数校验并更新测试");
    expect(first).not.toBe(second);
  });

  it("不同会话任务 → 通知互不混淆", async () => {
    const [first, second] = await ingestMany([
      {
        schemaVersion: 1,
        source: "codebuddy",
        taskId: "session-alpha",
        eventKey: "stop-alpha",
        title: "任务A",
        result: "success",
      },
      {
        schemaVersion: 1,
        source: "codebuddy",
        taskId: "session-beta",
        eventKey: "stop-beta",
        title: "任务B",
        result: "success",
      },
    ]);
    expect(first).toContain("标题：任务A");
    expect(second).toContain("标题：任务B");
  });
});
