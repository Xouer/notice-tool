import { mkdirSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ClaudeCodeAdapter } from "../../src/pollers/claude-code.js";
import { AgentStatusError } from "../../src/pollers/adapter.js";
import { createStableEventKey } from "../../src/core/stop-identity.js";
import { mapStopPayload } from "../../src/cli/hook.js";

/**
 * T046：claude-code 巡查适配器单元测试（Red 先行）。
 * 基于 fixtures 会话 JSONL 尾部解析：识别最近会话到达结束态、任务列表与各自状态。
 */
let fixtureDir: string;

beforeEach(() => {
  fixtureDir = join(
    tmpdir(),
    `notice-claude-fixture-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(join(fixtureDir, "proj-a"), { recursive: true });
});

afterEach(() => {
  rmSync(fixtureDir, { recursive: true, force: true });
});

function writeSession(name: string, lines: object[], ageMs = 0): string {
  const file = join(fixtureDir, "proj-a", name);
  writeFileSync(file, lines.map((l) => JSON.stringify(l)).join("\n"), "utf8");
  const t = new Date(Date.now() - ageMs);
  utimesSync(file, t, t);
  return file;
}

const RUNNING = [
  {
    type: "assistant",
    message: { role: "assistant", content: [{ type: "text", text: "正在分析代码" }] },
  },
];
const RESULT_SUCCESS = {
  type: "result",
  subtype: "success",
  session_id: "session-abc123",
  result: "修复完成，测试通过",
  timestamp: "2026-11-07T10:30:00.000Z",
};
const RESULT_FAILED = {
  type: "result",
  subtype: "error_during_execution",
  session_id: "session-err",
  result: "编译错误",
};
const RESULT_MAX = { type: "result", subtype: "error_max_turns", session_id: "session-max" };

function makeAdapter(): ClaudeCodeAdapter {
  return new ClaudeCodeAdapter({ projectsDir: fixtureDir });
}

describe("claude-code adapter / 会话巡查适配器（T046）", () => {
  it("读取最新修改的会话文件（忽略更早的会话）", async () => {
    writeSession("older.jsonl", [RESULT_SUCCESS], 60_000);
    writeSession("newer.jsonl", RUNNING, 0);
    const tasks = await makeAdapter().readTasks();
    expect(tasks).toHaveLength(1);
    expect(tasks[0]?.status).toBe("running");
    expect(tasks[0]?.taskId).toBe("newer");
  });

  it("最近会话到达成功结束态（result.success）", async () => {
    writeSession("latest.jsonl", [...RUNNING, RESULT_SUCCESS]);
    const tasks = await makeAdapter().readTasks();
    expect(tasks).toHaveLength(1);
    expect(tasks[0]?.taskId).toBe("session-abc123");
    expect(tasks[0]?.status).toBe("completed");
    expect(tasks[0]?.summary).toContain("修复完成");
    expect(tasks[0]?.finishedAt).toBeInstanceOf(Date);
  });

  it("失败与中断子类型正确映射", async () => {
    writeSession("latest.jsonl", [RESULT_FAILED, RESULT_MAX]);
    const tasks = await makeAdapter().readTasks();
    expect(tasks).toHaveLength(2);
    expect(tasks[0]?.status).toBe("failed");
    expect(tasks[0]?.taskId).toBe("session-err");
    expect(tasks[1]?.status).toBe("interrupted");
    expect(tasks[1]?.taskId).toBe("session-max");
  });

  it("尾部无 result → 会话进行中（running）", async () => {
    writeSession("latest.jsonl", RUNNING);
    const tasks = await makeAdapter().readTasks();
    expect(tasks[0]?.status).toBe("running");
  });

  it("会话目录不存在 → AgentStatusError 明确报错", async () => {
    const adapter = new ClaudeCodeAdapter({ projectsDir: join(fixtureDir, "no-such-dir") });
    await expect(adapter.readTasks()).rejects.toBeInstanceOf(AgentStatusError);
  });

  it("空会话文件 → AgentStatusError 明确报错", async () => {
    writeSession("latest.jsonl", []);
    await expect(makeAdapter().readTasks()).rejects.toBeInstanceOf(AgentStatusError);
  });
});

describe("claude-code terminal identity / Claude 终态事件键（008 US2）", () => {
  it("每个 result 记录生成稳定且不同的事件键", async () => {
    const first = { ...RESULT_SUCCESS, uuid: "claude-result-1" };
    const second = {
      ...RESULT_SUCCESS,
      session_id: "session-abc123",
      uuid: "claude-result-2",
      timestamp: "2026-11-07T10:31:00.000Z",
    };
    writeSession("latest.jsonl", [RUNNING, first, second]);
    const tasks = await makeAdapter().readTasks();
    expect(tasks).toHaveLength(2);
    expect(tasks[0]?.eventKey).toBe(
      createStableEventKey("claude-code:session-abc123:claude-result-1"),
    );
    expect(tasks[1]?.eventKey).toBe(
      createStableEventKey("claude-code:session-abc123:claude-result-2"),
    );
  });

  it("损坏 result 行跳过，不将路径或正文写入事件键", async () => {
    const file = join(fixtureDir, "proj-a", "corrupt.jsonl");
    writeFileSync(
      file,
      [
        '{"type":"result","session_id":"session-corrupt","uuid":"good-result"',
        JSON.stringify({ ...RESULT_SUCCESS, session_id: "session-corrupt", uuid: "good-result-2" }),
      ].join("\n"),
      "utf8",
    );
    const tasks = await makeAdapter().readTasks();
    expect(tasks).toHaveLength(1);
    expect(tasks[0]?.eventKey).toBe(
      createStableEventKey("claude-code:session-corrupt:good-result-2"),
    );
  });

  it("同一终态记录的钩子与巡查事件键一致", async () => {
    const first = { ...RESULT_SUCCESS, uuid: "claude-cross-result-1" };
    const file = writeSession("cross.jsonl", [RUNNING, first]);
    const tasks = await makeAdapter().readTasks();
    const mapped = mapStopPayload("claude-code", {
      session_id: "session-abc123",
      transcript_path: file,
    });
    expect(mapped.status).toBe("mapped");
    if (mapped.status !== "mapped") return;
    expect(tasks[0]?.eventKey).toBe(mapped.payload.eventKey);
  });
});
