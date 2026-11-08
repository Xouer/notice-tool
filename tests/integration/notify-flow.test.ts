import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { ingestTaskEndEvent } from "../../src/core/event-pipeline.js";
import { mapCodeBuddyStopPayload } from "../../src/cli/hook.js";
import type { ChannelAdapter, SendOutcome, SendPayload } from "../../src/channels/adapter.js";
import { BlobCipher } from "../../src/storage/crypto.js";
import { InMemorySecretStore } from "../../src/storage/secret-store.js";
import { openMemoryDatabase } from "../../src/storage/db.js";
import { ChannelRepository } from "../../src/storage/channel-repository.js";
import { TemplateRepository } from "../../src/storage/template-repository.js";
import { seedDefaultTemplates } from "../../src/storage/seed.js";
import { notificationRecords, taskEvents, type ChannelType } from "../../src/storage/schema.js";

/**
 * T031：通知流集成测试（Red 先行）。
 * 模拟事件 → :memory: 库 → 假渠道适配器：
 * 每个已启用渠道恰好一条 sent 记录；单渠道失败不阻断其他渠道；
 * 重试超限进入 failed 且错误码分类正确；重复 taskId 第二轮零通知；
 * 无任何已启用渠道时事件仍落库且不产生通知记录。
 */
class FakeAdapter implements ChannelAdapter {
  readonly sends: SendPayload[] = [];
  constructor(
    readonly type: ChannelType,
    private readonly respond: () => SendOutcome,
  ) {}

  async send(payload: SendPayload): Promise<SendOutcome> {
    this.sends.push(payload);
    return this.respond();
  }
}

function makeSetup(channelTypes: ChannelType[] = ["feishu", "dingtalk"]) {
  const db = openMemoryDatabase();
  seedDefaultTemplates(db);
  const channels = new ChannelRepository(
    db,
    new BlobCipher(new InMemorySecretStore().getMainKey()),
  );
  const templates = new TemplateRepository(db);
  const adapters = new Map<ChannelType, FakeAdapter>();
  const sendLog: SendPayload[] = [];
  const getAdapter = (type: ChannelType): ChannelAdapter => {
    let adapter = adapters.get(type);
    if (adapter === undefined) {
      adapter = new FakeAdapter(type, () => ({ ok: true }));
      adapters.set(type, adapter);
    }
    return adapter;
  };
  for (const type of channelTypes) {
    const row = channels.create({
      type,
      name: `渠道-${type}`,
      credentials:
        type === "email"
          ? { smtpHost: "smtp.test", authCode: "x", to: "a@b.c" }
          : { webhookUrl: `https://x.example/${type}` },
    });
    channels.setEnabled(row.id, true);
  }
  const payload = {
    schemaVersion: 1,
    source: "claude-code",
    taskId: "task-001",
    result: "success",
    resultSummary: "完成三处修复",
  };
  const ingest = (overrides?: { maxAttempts?: number; retryDelayMs?: number }) =>
    ingestTaskEndEvent(
      {
        db,
        channels,
        templates,
        getAdapter,
        config: { cooldownMinutes: 10 },
        dispatchOptions: {
          maxAttempts: overrides?.maxAttempts ?? 3,
          retryDelayMs: overrides?.retryDelayMs ?? 1,
        },
      },
      payload,
    );
  return { db, channels, templates, getAdapter, adapters, sendLog, payload, ingest };
}

describe("notify flow / 通知流集成（T031）", () => {
  it("每个已启用渠道恰好一条 sent 记录，事件标记 dispatched", async () => {
    const { db, ingest } = makeSetup();
    const result = await ingest();
    expect(result.deduplicated).toBe(false);
    expect(result.records).toHaveLength(2);
    for (const record of result.records) {
      expect(record.status).toBe("sent");
    }
    const records = db.select().from(notificationRecords).all();
    expect(records).toHaveLength(2);
    expect(new Set(records.map((r) => r.status))).toEqual(new Set(["sent"]));
    const event = db.select().from(taskEvents).get();
    expect(event?.notifyStatus).toBe("dispatched");
  });

  it("单渠道失败不阻断其他渠道", async () => {
    const { db, adapters, ingest } = makeSetup();
    // 让 feishu 恒定失败
    const failing = new FakeAdapter("feishu", () => ({
      ok: false,
      errorCode: "NETWORK_UNREACHABLE",
      message: "网络请求失败",
    }));
    adapters.set("feishu", failing);
    const result = await ingest({ maxAttempts: 1 });
    const byChannel = Object.fromEntries(
      result.records.map((r) => [r.status, true]) as Array<[string, boolean]>,
    );
    expect(byChannel["failed"]).toBe(true);
    expect(byChannel["sent"]).toBe(true);
    const failed = db
      .select()
      .from(notificationRecords)
      .where(eq(notificationRecords.status, "failed"))
      .get();
    expect(failed?.lastErrorCode).toBe("NETWORK_UNREACHABLE");
  });

  it("重试超限进入 failed 且 attempts 记录正确", async () => {
    const { db, adapters, ingest } = makeSetup(["feishu"]);
    let calls = 0;
    adapters.set(
      "feishu",
      new FakeAdapter("feishu", () => {
        calls += 1;
        return { ok: false, errorCode: "RATE_LIMITED_REMOTE", message: "渠道限流" };
      }),
    );
    const result = await ingest({ maxAttempts: 3, retryDelayMs: 1 });
    expect(calls).toBe(3); // 恰好重试至 maxAttempts
    const record = db.select().from(notificationRecords).get();
    expect(record?.status).toBe("failed");
    expect(record?.attempts).toBe(3);
    expect(record?.lastErrorCode).toBe("RATE_LIMITED_REMOTE");
    expect(result.records[0]?.errorCode).toBe("RATE_LIMITED_REMOTE");
  });

  it("重复 taskId 第二轮零通知", async () => {
    const { db, adapters, ingest } = makeSetup();
    await ingest();
    const sentBefore = [...adapters.values()].reduce((n, a) => n + a.sends.length, 0);
    const second = await ingest();
    expect(second.deduplicated).toBe(true);
    expect(second.records).toHaveLength(0);
    const sentAfter = [...adapters.values()].reduce((n, a) => n + a.sends.length, 0);
    expect(sentAfter).toBe(sentBefore); // 零通知
    // 第二轮事件被标记为 duplicated（保留记录不触发通知，FR-007）
    const duplicated = db
      .select()
      .from(taskEvents)
      .all()
      .filter((e) => e.notifyStatus === "duplicated");
    expect(duplicated).toHaveLength(1);
  });

  it("无任何已启用渠道时事件仍落库且不产生通知记录", async () => {
    const { db, ingest } = makeSetup([]);
    const result = await ingest();
    expect(result.records).toHaveLength(0);
    expect(result.message).toContain("无可用渠道");
    const events = db.select().from(taskEvents).all();
    expect(events).toHaveLength(1);
    expect(events[0]?.notifyStatus).toBe("received");
    expect(db.select().from(notificationRecords).all()).toHaveLength(0);
  });

  it("raw_payload_ref 仅存脱敏摘要", async () => {
    const setup = makeSetup(["feishu"]);
    const { db, channels, templates } = setup;
    const secret = "sk-proj-abc123def456ghi789";
    await ingestTaskEndEvent(
      {
        db,
        channels,
        templates,
        getAdapter: () => ({ type: "feishu", send: async () => ({ ok: true }) }),
        config: { cooldownMinutes: 10 },
        dispatchOptions: { maxAttempts: 1, retryDelayMs: 1 },
      },
      {
        schemaVersion: 1,
        source: "demo",
        taskId: "sec-1",
        eventKey: `key-${secret}`,
        resultSummary: `部署完成 ${secret}`,
      },
    );
    const event = db.select().from(taskEvents).get();
    expect(event?.rawPayloadRef).not.toContain(secret);
    expect(event?.rawPayloadRef).toContain("[REDACTED]");
    expect(event?.eventKey).not.toContain(secret);
  });
});

describe("single and multi-step stop flow / 单轮与多步骤 Stop 通知（008 US1）", () => {
  it("同一会话的单轮与多步骤不同 Stop 各自分发", async () => {
    const { db, adapters, channels, templates, getAdapter } = makeSetup(["feishu"]);
    const deps = {
      db,
      channels,
      templates,
      getAdapter,
      config: { cooldownMinutes: 10 },
      dispatchOptions: { maxAttempts: 1, retryDelayMs: 1 },
    };
    const single = await ingestTaskEndEvent(
      deps,
      {
        schemaVersion: 1,
        source: "codebuddy",
        taskId: "same-current-session",
        eventKey: "stop-single-turn-001",
        resultSummary: "虚构单轮问答结束",
      },
      { trigger: "hook" },
    );
    const multi = await ingestTaskEndEvent(
      deps,
      {
        schemaVersion: 1,
        source: "codebuddy",
        taskId: "same-current-session",
        eventKey: "stop-multi-step-002",
        result: "failure",
        resultSummary: "虚构多步骤任务失败",
      },
      { trigger: "hook" },
    );
    expect(single.deduplicated).toBe(false);
    expect(multi.deduplicated).toBe(false);
    expect(single.records).toHaveLength(1);
    expect(multi.records).toHaveLength(1);
    const feishu = adapters.get("feishu");
    expect(feishu?.sends).toHaveLength(2);
    const events = db.select().from(taskEvents).all();
    expect(events).toHaveLength(2);
    expect(new Set(events.map((event) => event.notifyStatus))).toEqual(new Set(["dispatched"]));
  });

  it("未收到 Stop 不产生事件，来源缺省字段仍受理并分发", async () => {
    const { db, channels, templates, getAdapter } = makeSetup(["feishu"]);
    const eventsBefore = db.select().from(taskEvents).all().length;
    const mapped = mapCodeBuddyStopPayload({
      event_id: "fixture-stop-minimal-001",
    });
    if (mapped.status !== "mapped") {
      throw new Error("来源映射应成功");
    }
    const result = await ingestTaskEndEvent(
      {
        db,
        channels,
        templates,
        getAdapter,
        config: { cooldownMinutes: 10 },
        dispatchOptions: { maxAttempts: 1, retryDelayMs: 1 },
      },
      mapped.payload,
      { trigger: "hook" },
    );
    expect(result.records).toHaveLength(1);
    expect(result.records[0]?.status).toBe("sent");
    const events = db.select().from(taskEvents).all();
    expect(events).toHaveLength(eventsBefore + 1);
    expect(events.at(-1)?.resultStatus).toBe("success");
  });
});

describe("stop event identity flow / Stop 事件身份流（008 US2）", () => {
  it("同一稳定键并发重复十次只产生一轮通知，重复历史可见", async () => {
    const { db, adapters, channels, templates, getAdapter } = makeSetup(["feishu"]);
    const deps = {
      db,
      channels,
      templates,
      getAdapter,
      config: { cooldownMinutes: 10 },
      dispatchOptions: { maxAttempts: 1, retryDelayMs: 1 },
    };
    const payload = {
      schemaVersion: 1,
      source: "codebuddy",
      taskId: "session-dedup",
      eventKey: "stop-same-001",
      resultSummary: "虚构单轮问答结束",
    };
    const results = await Promise.all(
      Array.from({ length: 10 }, () => ingestTaskEndEvent(deps, payload, { trigger: "hook" })),
    );
    expect(results.filter((result) => result.deduplicated)).toHaveLength(9);
    const feishu = adapters.get("feishu");
    expect(feishu?.sends).toHaveLength(1);
    const events = db.select().from(taskEvents).all();
    expect(events).toHaveLength(10);
    expect(events.filter((event) => event.notifyStatus === "duplicated")).toHaveLength(9);
    const records = db.select().from(notificationRecords).all();
    expect(records).toHaveLength(1);
  });

  it("同一会话三个不同稳定键产生三轮通知", async () => {
    const { db, adapters, channels, templates, getAdapter } = makeSetup(["feishu"]);
    const deps = {
      db,
      channels,
      templates,
      getAdapter,
      config: { cooldownMinutes: 10 },
      dispatchOptions: { maxAttempts: 1, retryDelayMs: 1 },
    };
    for (const [index, eventKey] of ["stop-a", "stop-b", "stop-c"].entries()) {
      const result = await ingestTaskEndEvent(
        deps,
        {
          schemaVersion: 1,
          source: "codebuddy",
          taskId: "session-three-stops",
          eventKey,
          resultSummary: `虚构第 ${index + 1} 次问答结束`,
        },
        { trigger: "hook" },
      );
      expect(result.deduplicated).toBe(false);
      expect(result.records).toHaveLength(1);
    }
    const feishu = adapters.get("feishu");
    expect(feishu?.sends).toHaveLength(3);
    expect(db.select().from(taskEvents).all()).toHaveLength(3);
  });
});
