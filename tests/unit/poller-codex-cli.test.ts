import { mkdirSync, mkdtempSync, rmSync, writeFileSync, utimesSync } from "node:fs";
import { dirname } from "node:path";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CodexCliAdapter } from "../../src/pollers/codex-cli.js";
import { AgentStatusError } from "../../src/pollers/adapter.js";
import { createStableEventKey } from "../../src/core/stop-identity.js";
import { readFileSync } from "node:fs";

/**
 * T013：Codex CLI 巡查适配器单元测试（Red 先行，US3）。
 * 以 fixtures/dialog-sources/codex-rollout-*.jsonl 虚构样本覆盖：
 * 状态迁移识别（turn_complete → 结束态）、启动基线补检所需字段（finishedAt/summary）、
 * 文件损坏/目录缺失 → AgentStatusError（FR-007 跳过本轮由调度器保证）。
 */
function readFixture(name: string): string {
  return readFileSync(join(__dirname, "../fixtures/dialog-sources", name), "utf8");
}

describe("codex-cli polling adapter / Codex CLI 巡查适配器（T013，US3）", () => {
  let dataDir: string;

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), "notice-codex-poller-"));
  });

  afterEach(() => {
    rmSync(dataDir, { recursive: true, force: true });
  });

  function writeSession(relative: string, content: string, mtime?: Date): string {
    const file = join(dataDir, relative);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, content, "utf8");
    if (mtime !== undefined) {
      utimesSync(file, mtime, mtime);
    }
    return file;
  }

  it("已完成会话 → completed + taskId 取自 session_meta + summary/finishedAt 就绪（基线补检依据）", async () => {
    writeSession("2026/11/07/rollout-a.jsonl", readFixture("codex-rollout-sample.jsonl"));
    const adapter = new CodexCliAdapter({ sessionsDir: dataDir });
    const tasks = await adapter.readTasks();
    expect(tasks).toHaveLength(1);
    expect(tasks[0]?.taskId).toBe("fixture-thread-codex-0001");
    expect(tasks[0]?.status).toBe("completed");
    expect(tasks[0]?.summary).toContain("虚构任务进行中");
    expect(tasks[0]?.finishedAt?.toISOString()).toBe("2026-11-07T10:00:30.000Z");
  });

  it("进行中会话（尾部无 turn_complete）→ running，不触发通知", async () => {
    writeSession(
      "2026/11/07/rollout-b.jsonl",
      readFixture("codex-rollout-incomplete-sample.jsonl"),
    );
    const adapter = new CodexCliAdapter({ sessionsDir: dataDir });
    const tasks = await adapter.readTasks();
    expect(tasks).toHaveLength(1);
    expect(tasks[0]?.status).toBe("running");
  });

  it("turn_complete 非成功状态 → failed（如实反映非成功结束，SC-003）", async () => {
    writeSession(
      "2026/11/07/rollout-c.jsonl",
      [
        JSON.stringify({
          timestamp: "2026-11-07T11:00:00.000Z",
          type: "session_meta",
          session_id: "fixture-thread-codex-0004",
        }),
        JSON.stringify({
          timestamp: "2026-11-07T11:00:10.000Z",
          type: "event_msg",
          payload: { type: "turn_complete", status: "error" },
        }),
      ].join("\n") + "\n",
    );
    const adapter = new CodexCliAdapter({ sessionsDir: dataDir });
    const tasks = await adapter.readTasks();
    expect(tasks[0]?.status).toBe("failed");
  });

  it("多会话文件 → 取最近修改的一个（与 claude-code 适配器同策略）", async () => {
    writeSession(
      "2026/11/06/rollout-old.jsonl",
      readFixture("codex-rollout-sample.jsonl"),
      new Date("2026-11-06T09:00:00Z"),
    );
    writeSession(
      "2026/11/07/rollout-new.jsonl",
      readFixture("codex-rollout-incomplete-sample.jsonl"),
      new Date("2026-11-07T09:00:00Z"),
    );
    const adapter = new CodexCliAdapter({ sessionsDir: dataDir });
    const tasks = await adapter.readTasks();
    expect(tasks[0]?.taskId).toBe("fixture-thread-codex-0002"); // 最新文件为 0002（进行中）
  });

  it("会话文件损坏 → AgentStatusError（调度器捕获后跳过本轮，FR-007）", async () => {
    writeSession("2026/11/07/rollout-broken.jsonl", "\u0000\u0001二进制损坏数据不是 JSON");
    const adapter = new CodexCliAdapter({ sessionsDir: dataDir });
    await expect(adapter.readTasks()).rejects.toBeInstanceOf(AgentStatusError);
  });

  it("会话目录不存在 → AgentStatusError", async () => {
    const adapter = new CodexCliAdapter({ sessionsDir: join(dataDir, "not-exist") });
    await expect(adapter.readTasks()).rejects.toBeInstanceOf(AgentStatusError);
  });

  it("sourceAgent 固定为 codex-cli（FR-009 来源标识）", () => {
    const adapter = new CodexCliAdapter({ sessionsDir: dataDir });
    expect(adapter.name).toBe("codex-cli");
    expect(adapter.sourceAgent).toBe("codex-cli");
  });
});

describe("codex terminal identity / Codex 终态事件键（008 US2）", () => {
  let dataDir: string;

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), "notice-codex-identity-"));
  });

  afterEach(() => {
    rmSync(dataDir, { recursive: true, force: true });
  });

  function writeSession(relative: string, content: string): string {
    const file = join(dataDir, relative);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, content, "utf8");
    return file;
  }

  it("turn_complete 提供稳定事件键并与 notify turn ID 对齐", async () => {
    writeSession("2026/11/07/rollout-key.jsonl", readFixture("codex-rollout-sample.jsonl"));
    const adapter = new CodexCliAdapter({ sessionsDir: dataDir });
    const tasks = await adapter.readTasks();
    expect(tasks[0]?.eventKey).toBe(
      createStableEventKey("codex-cli:fixture-thread-codex-0001:fixture-turn-codex-0001"),
    );
  });

  it("连续 turn_complete 使用最新事件键", async () => {
    const content =
      [
        JSON.stringify({
          timestamp: "2026-11-07T12:00:00.000Z",
          type: "session_meta",
          session_id: "fixture-thread-codex-turns",
        }),
        JSON.stringify({
          timestamp: "2026-11-07T12:00:01.000Z",
          type: "event_msg",
          payload: { type: "turn_complete", status: "success", turn_id: "turn-1" },
        }),
        JSON.stringify({
          timestamp: "2026-11-07T12:00:02.000Z",
          type: "event_msg",
          payload: { type: "turn_complete", status: "success", turn_id: "turn-2" },
        }),
      ].join("\n") + "\n";
    writeSession("2026/11/07/rollout-turns.jsonl", content);
    const adapter = new CodexCliAdapter({ sessionsDir: dataDir });
    const tasks = await adapter.readTasks();
    expect(tasks).toHaveLength(1);
    expect(tasks[0]?.eventKey).toBe(
      createStableEventKey("codex-cli:fixture-thread-codex-turns:turn-2"),
    );
  });
});
