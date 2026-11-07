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

function insertEvent(source: string, taskId: string, receivedAt: Date): void {
  db.insert(taskEvents)
    .values({
      id: randomUUID(),
      sourceAgent: source,
      taskId,
      finishedAt: receivedAt,
      resultStatus: "success",
      triggerType: "hook",
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
      isDuplicateEvent(db, { sourceAgent: "claude-code", taskId: "other", cooldownMinutes: 10, now }),
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
