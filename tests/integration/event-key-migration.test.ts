import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { openMemoryDatabase } from "../../src/storage/db.js";
import { taskEvents } from "../../src/storage/schema.js";

/**
 * 008 T004：事件键迁移测试。
 * 验证 task_events.event_key 为可空文本、复合索引存在；
 * 旧无键事件保持 NULL 且升级后可继续受理。
 */
describe("task_events event_key migration / 事件键迁移（008）", () => {
  it("新增 event_key 为可空列且建立复合索引", () => {
    const db = openMemoryDatabase();
    const sqlite = db.$client;
    const columns = sqlite.pragma("table_info(task_events)") as Array<{
      name: string;
      type: string;
      notnull: number;
      pk: number;
    }>;
    const eventKey = columns.find((column) => column.name === "event_key");
    expect(eventKey).toBeDefined();
    expect(eventKey?.type.toLowerCase()).toBe("text");
    expect(eventKey?.notnull).toBe(0);
    expect(eventKey?.pk).toBe(0);

    const indexes = sqlite.pragma("index_list(task_events)") as Array<{
      name: string;
      unique: number;
    }>;
    const dedupIndex = indexes.find((index) => index.name === "idx_task_events_event_key_dedup");
    expect(dedupIndex).toBeDefined();
    expect(dedupIndex?.unique).toBe(0);
    const indexColumns = sqlite.pragma("index_info(idx_task_events_event_key_dedup)") as Array<{
      name: string;
    }>;
    expect(indexColumns.map((column) => column.name)).toEqual([
      "source_agent",
      "task_id",
      "event_key",
      "received_at",
    ]);
  });

  it("旧行 event_key 保持 NULL，新行保存稳定键", () => {
    const db = openMemoryDatabase();
    const now = new Date();
    db.insert(taskEvents)
      .values({
        id: randomUUID(),
        sourceAgent: "demo",
        taskId: "legacy-task",
        finishedAt: now,
        resultStatus: "success",
        triggerType: "hook",
        receivedAt: now,
        notifyStatus: "dispatched",
      })
      .run();
    db.insert(taskEvents)
      .values({
        id: randomUUID(),
        sourceAgent: "demo",
        taskId: "keyed-task",
        eventKey: "stop-keyed-001",
        finishedAt: now,
        resultStatus: "success",
        triggerType: "hook",
        receivedAt: now,
        notifyStatus: "received",
      })
      .run();

    const events = db.select().from(taskEvents).all();
    const legacy = events.find((event) => event.taskId === "legacy-task");
    const keyed = events.find((event) => event.taskId === "keyed-task");
    expect(legacy?.eventKey).toBeNull();
    expect(keyed?.eventKey).toBe("stop-keyed-001");
  });
});
