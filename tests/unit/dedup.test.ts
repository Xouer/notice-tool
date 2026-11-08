import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { isDuplicateEvent } from "../../src/core/dedup.js";
import { openMemoryDatabase } from "../../src/storage/db.js";
import { taskEvents } from "../../src/storage/schema.js";

/**
 * T028：去重冷却窗口单元测试（Red 先行，FR-007 / research.md R8）。
 * 同 (source_agent, task_id) 且 received_at 在冷却窗口（默认 10 分钟，可配）内判重；
 * 跨窗口放行。
 */
const db = openMemoryDatabase();

function insertEvent(source: string, taskId: string, receivedAt: Date, eventKey?: string): void {
  db.insert(taskEvents)
    .values({
      id: randomUUID(),
      sourceAgent: source,
      taskId,
      finishedAt: receivedAt,
      resultStatus: "success",
      triggerType: "hook",
      eventKey,
      receivedAt,
      notifyStatus: "dispatched",
    })
    .run();
}

describe("dedup cooldown / 去重冷却窗口（T028）", () => {
  const now = new Date();

  it("同 (source_agent, task_id) 且在窗口内判重", () => {
    insertEvent("claude-code", "t1", new Date(now.getTime() - 5 * 60_000));
    expect(
      isDuplicateEvent(db, { sourceAgent: "claude-code", taskId: "t1", cooldownMinutes: 10, now }),
    ).toBe(true);
  });

  it("跨窗口放行", () => {
    insertEvent("claude-code", "t2", new Date(now.getTime() - 11 * 60_000));
    expect(
      isDuplicateEvent(db, { sourceAgent: "claude-code", taskId: "t2", cooldownMinutes: 10, now }),
    ).toBe(false);
  });

  it("不同 taskId 或不同 source 不判重", () => {
    insertEvent("claude-code", "t3", new Date(now.getTime() - 60_000));
    expect(
      isDuplicateEvent(db, {
        sourceAgent: "claude-code",
        taskId: "other",
        cooldownMinutes: 10,
        now,
      }),
    ).toBe(false);
    expect(
      isDuplicateEvent(db, { sourceAgent: "other-agent", taskId: "t3", cooldownMinutes: 10, now }),
    ).toBe(false);
  });

  it("冷却窗口可配置", () => {
    insertEvent("demo", "t4", new Date(now.getTime() - 2 * 60_000));
    expect(
      isDuplicateEvent(db, { sourceAgent: "demo", taskId: "t4", cooldownMinutes: 1, now }),
    ).toBe(false);
    expect(
      isDuplicateEvent(db, { sourceAgent: "demo", taskId: "t4", cooldownMinutes: 5, now }),
    ).toBe(true);
  });

  it("无历史事件不判重", () => {
    expect(
      isDuplicateEvent(db, { sourceAgent: "demo", taskId: "never-seen", cooldownMinutes: 10, now }),
    ).toBe(false);
  });
});

describe("dedup eventKey / Stop 级事件身份去重（008）", () => {
  const now = new Date();

  it("同一稳定键判重，不同摘要、结束时间和触发方式不影响", () => {
    insertEvent("claude-code", "session-1", new Date(now.getTime() - 30 * 60_000), "stop-1");
    expect(
      isDuplicateEvent(db, {
        sourceAgent: "claude-code",
        taskId: "session-1",
        eventKey: "stop-1",
        cooldownMinutes: 10,
        now,
      }),
    ).toBe(true);
  });

  it("同一会话不同稳定键不判重", () => {
    insertEvent("claude-code", "session-2", new Date(now.getTime() - 60_000), "stop-1");
    insertEvent("claude-code", "session-2", new Date(now.getTime() - 30_000), "stop-2");
    expect(
      isDuplicateEvent(db, {
        sourceAgent: "claude-code",
        taskId: "session-2",
        eventKey: "stop-2",
        cooldownMinutes: 10,
        now,
      }),
    ).toBe(true);
    expect(
      isDuplicateEvent(db, {
        sourceAgent: "claude-code",
        taskId: "session-2",
        eventKey: "stop-3",
        cooldownMinutes: 10,
        now,
      }),
    ).toBe(false);
  });

  it("有键事件不与旧无键事件互相抑制", () => {
    insertEvent("claude-code", "session-3", new Date(now.getTime() - 60_000));
    expect(
      isDuplicateEvent(db, {
        sourceAgent: "claude-code",
        taskId: "session-3",
        eventKey: "stop-legacy-isolated",
        cooldownMinutes: 10,
        now,
      }),
    ).toBe(false);
  });
});
