import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { purgeExpiredHistory } from "../../src/core/retention.js";
import { openMemoryDatabase } from "../../src/storage/db.js";
import { BlobCipher } from "../../src/storage/crypto.js";
import { InMemorySecretStore } from "../../src/storage/secret-store.js";
import { ChannelRepository } from "../../src/storage/channel-repository.js";
import { seedDefaultTemplates } from "../../src/storage/seed.js";
import {
  notificationChannels,
  notificationRecords,
  notificationTemplates,
  taskEvents,
} from "../../src/storage/schema.js";

/**
 * T059：30 天保留清理单元测试（Red 先行）。
 * 清理 task_events / notification_records 超 retentionDays 记录；
 * 渠道与模板配置不清理（data-model.md 保留策略）。
 */
const NOW = new Date("2026-11-07T12:00:00.000Z");

function makeFixture() {
  const db = openMemoryDatabase();
  seedDefaultTemplates(db);
  const channels = new ChannelRepository(db, new BlobCipher(new InMemorySecretStore().getMainKey()));
  const ch = channels.create({
    type: "feishu",
    name: "群",
    credentials: { webhookUrl: "https://x.example/hook/a" },
  });

  const insertEvent = (taskId: string, receivedAt: Date): string => {
    const eventId = randomUUID();
    db.insert(taskEvents)
      .values({
        id: eventId,
        sourceAgent: "demo",
        taskId,
        finishedAt: receivedAt,
        resultStatus: "success",
        triggerType: "hook",
        receivedAt,
        notifyStatus: "dispatched",
      })
      .run();
    return eventId;
  };
  const insertRecord = (eventId: string, createdAt: Date): string => {
    const recordId = randomUUID();
    db.insert(notificationRecords)
      .values({
        id: recordId,
        eventId,
        channelId: ch.id,
        status: "sent",
        attempts: 1,
        createdAt,
        updatedAt: createdAt,
      })
      .run();
    return recordId;
  };

  const oldDay = new Date(NOW.getTime() - 40 * 24 * 60 * 60 * 1000);
  const recentDay = new Date(NOW.getTime() - 6 * 24 * 60 * 60 * 1000);

  const oldEventId = insertEvent("old-task", oldDay);
  insertRecord(oldEventId, oldDay);
  const recentEventId = insertEvent("recent-task", recentDay);
  const recentRecordId = insertRecord(recentEventId, recentDay);

  return { db, channels, ch, oldEventId, recentEventId, recentRecordId };
}

describe("retention purge / 保留清理（T059）", () => {
  it("超 30 天的事件与通知记录被清理，近期保留", () => {
    const { db, recentEventId, recentRecordId } = makeFixture();
    const result = purgeExpiredHistory(db, 30, NOW);
    expect(result.eventsDeleted).toBe(1);
    expect(result.recordsDeleted).toBe(1);
    const events = db.select().from(taskEvents).all();
    expect(events.map((e) => e.id)).toEqual([recentEventId]);
    const records = db.select().from(notificationRecords).all();
    expect(records.map((r) => r.id)).toEqual([recentRecordId]);
  });

  it("渠道配置与模板不受清理影响", () => {
    const { db, ch } = makeFixture();
    purgeExpiredHistory(db, 30, NOW);
    expect(db.select().from(notificationChannels).all()).toHaveLength(1);
    expect(db.select().from(notificationChannels).all()[0]?.id).toBe(ch.id);
    expect(db.select().from(notificationTemplates).all()).toHaveLength(6);
  });

  it("retentionDays 可配置（5 天窗口清理近期记录）", () => {
    const { db } = makeFixture();
    purgeExpiredHistory(db, 5, NOW);
    expect(db.select().from(taskEvents).all()).toHaveLength(0); // 6 天前的记录也被清理
    expect(db.select().from(notificationRecords).all()).toHaveLength(0);
  });

  it("重复执行幂等（零删除）", () => {
    const { db } = makeFixture();
    purgeExpiredHistory(db, 30, NOW);
    const second = purgeExpiredHistory(db, 30, NOW);
    expect(second.eventsDeleted).toBe(0);
    expect(second.recordsDeleted).toBe(0);
  });
});
