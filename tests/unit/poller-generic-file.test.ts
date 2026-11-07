import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GenericFileAdapter } from "../../src/pollers/generic-file.js";
import { AgentStatusError } from "../../src/pollers/adapter.js";

/**
 * T047：generic-file 巡查适配器单元测试（Red 先行）。
 * "状态文件路径 + 完成特征正则"命中/未命中/文件不存在三种行为。
 */
let tmpDir: string;
let stateFile: string;

beforeEach(() => {
  tmpDir = join(tmpdir(), `notice-generic-file-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(tmpDir, { recursive: true });
  stateFile = join(tmpDir, "status-demo.txt");
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

function makeAdapter(completionPattern = "status=completed"): GenericFileAdapter {
  return new GenericFileAdapter({
    path: stateFile,
    completionPattern,
    sourceName: "my-agent",
  });
}

describe("generic-file adapter / 通用文件巡查适配器（T047）", () => {
  it("命中完成特征 → completed（摘要为匹配行）", async () => {
    writeFileSync(stateFile, "step1 running\nstatus=completed all green\n", "utf8");
    const tasks = await makeAdapter().readTasks();
    expect(tasks).toHaveLength(1);
    expect(tasks[0]?.taskId).toBe("status-demo.txt");
    expect(tasks[0]?.status).toBe("completed");
    expect(tasks[0]?.summary).toContain("status=completed");
    expect(tasks[0]?.summary).not.toContain("step1");
  });

  it("未命中 → running", async () => {
    writeFileSync(stateFile, "step1 running\nstep2 pending\n", "utf8");
    const tasks = await makeAdapter().readTasks();
    expect(tasks[0]?.status).toBe("running");
  });

  it("文件不存在 → AgentStatusError 明确报错（含路径）", async () => {
    const promise = makeAdapter().readTasks();
    await expect(promise).rejects.toBeInstanceOf(AgentStatusError);
    await promise.catch((cause: Error) => {
      expect(cause.message).toContain(stateFile);
    });
  });

  it("sourceAgent 命名空间为 generic:<来源名>", () => {
    expect(makeAdapter().sourceAgent).toBe("generic:my-agent");
  });

  it("非法正则 → AgentStatusError", () => {
    expect(
      () =>
        new GenericFileAdapter({
          path: stateFile,
          completionPattern: "([unclosed",
        }),
    ).toThrow(AgentStatusError);
  });
});
