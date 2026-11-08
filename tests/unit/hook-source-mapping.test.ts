import { Readable } from "node:stream";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runCli } from "../../src/cli/index.js";
import { mapCodeBuddyStopPayload, mapCodexNotifyPayload } from "../../src/cli/hook.js";
import { createStableEventKey } from "../../src/core/stop-identity.js";
import { readFileSync } from "node:fs";

/**
 * T003：现有 stdin 钩子特征测试（基线保护网）。
 * 在扩展 --source / --payload-argv 之前固化现状行为，
 * 保证 005-ai-task-dialog-link 的 CLI 扩展不破坏既有契约（宪法 III）。
 */

const VALID_PAYLOAD = {
  schemaVersion: 1,
  source: "demo",
  taskId: "task-baseline-001",
  result: "success",
  resultSummary: "fixture：基线演示任务结束",
};

describe("hook baseline characterization / stdin 钩子基线特征（T003）", () => {
  let dataDir: string;

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), "notice-hook-baseline-"));
  });

  afterEach(() => {
    rmSync(dataDir, { recursive: true, force: true });
  });

  function cli(argv: string[], stdin?: Readable) {
    let out = "";
    let errOut = "";
    return runCli(argv, {
      dataDir,
      stdin,
      out: (s) => {
        out += s;
      },
      err: (s) => {
        errOut += s;
      },
    }).then((code) => ({ code, out, errOut }));
  }

  it("现状：合法负载走 stdin → 退出码 0", async () => {
    const { code } = await cli(
      ["hook"],
      Readable.from([Buffer.from(JSON.stringify(VALID_PAYLOAD))]),
    );
    expect(code).toBe(0);
  });

  it("现状：非法负载 → 退出码 2 且 stderr 为 VALIDATION_FAILED", async () => {
    const bad = { schemaVersion: 1, taskId: "t" };
    const { code, errOut } = await cli(["hook"], Readable.from([Buffer.from(JSON.stringify(bad))]));
    expect(code).toBe(2);
    expect((JSON.parse(errOut.trim()) as { error: string }).error).toBe("VALIDATION_FAILED");
  });

  it("现状：非 JSON 输入 → 退出码 2", async () => {
    const { code } = await cli(["hook"], Readable.from([Buffer.from("not-json")]));
    expect(code).toBe(2);
  });

  it("现状：重复上报同一 source+taskId → 冷却窗口内去重", async () => {
    const stdin = Readable.from([Buffer.from(JSON.stringify(VALID_PAYLOAD))]);
    const first = await cli(["hook"], Readable.from([Buffer.from(JSON.stringify(VALID_PAYLOAD))]));
    expect(first.code).toBe(0);
    const second = await cli(["hook"], stdin);
    expect(second.code).toBe(0);
  });
});

const codebuddyFixture = JSON.parse(
  readFileSync(join(__dirname, "../fixtures/dialog-sources/codebuddy-stop-sample.json"), "utf8"),
) as Record<string, unknown>;

describe("CodeBuddy Stop payload mapping / CodeBuddy Stop 负载映射（T004，US1）", () => {
  it("fixture 负载 → 标准事件负载：source=codebuddy、session_id→taskId、event_id→eventKey", () => {
    const mapped = mapCodeBuddyStopPayload(codebuddyFixture);
    expect(mapped.status).toBe("mapped");
    if (mapped.status !== "mapped") return;
    expect(mapped.payload.source).toBe("codebuddy");
    expect(mapped.payload.taskId).toBe("fixture-session-codebuddy-0001");
    expect(mapped.payload.eventKey).toBe(
      createStableEventKey("codebuddy:fixture-session-codebuddy-0001:fixture-stop-codebuddy-0001"),
    );
    expect(mapped.payload.schemaVersion).toBe(1);
    expect(mapped.degradedKey).toBeUndefined();
  });

  it("显式 eventKey 保留给管线标准化且不降级", () => {
    const mapped = mapCodeBuddyStopPayload({
      session_id: "fixture-session-codebuddy-explicit",
      eventKey: "caller-stop-key-001",
    });
    expect(mapped.status).toBe("mapped");
    if (mapped.status !== "mapped") return;
    expect(mapped.payload.eventKey).toBe("caller-stop-key-001");
    expect(mapped.degradedKey).toBeUndefined();
  });

  it("缺 session_id 使用 unknown-session，不再因可选会话元数据丢失而拒绝", () => {
    const { session_id: _ignored, ...withoutSession } = codebuddyFixture;
    const mapped = mapCodeBuddyStopPayload(withoutSession);
    expect(mapped.status).toBe("mapped");
    if (mapped.status !== "mapped") return;
    expect(mapped.payload.taskId).toBe("unknown-session");
    expect(mapped.payload.eventKey).toBe(
      createStableEventKey("codebuddy:unknown-session:fixture-stop-codebuddy-0001"),
    );
    expect(mapped.payload.result).toBe("success");
  });

  it("无稳定身份时降级受理，两次调用生成不同事件键且警告不含负载", () => {
    const warnings: string[] = [];
    const mappedA = mapCodeBuddyStopPayload(
      { session_id: "fixture-session-no-identity", transcript_path: "C:\\missing\\no-file.jsonl" },
      (message) => warnings.push(message),
    );
    const mappedB = mapCodeBuddyStopPayload(
      { session_id: "fixture-session-no-identity", transcript_path: "C:\\missing\\no-file.jsonl" },
      (message) => warnings.push(message),
    );
    expect(mappedA.status).toBe("mapped");
    expect(mappedB.status).toBe("mapped");
    if (mappedA.status !== "mapped" || mappedB.status !== "mapped") return;
    expect(typeof mappedA.payload.eventKey).toBe("string");
    expect(mappedA.payload.eventKey).not.toBe(mappedB.payload.eventKey);
    expect(mappedA.degradedKey).toBe(true);
    expect(warnings.join(" ")).toContain("稳定事件身份");
    expect(warnings.join(" ")).not.toContain("fixture-session-no-identity");
    expect(warnings.join(" ")).not.toContain("C:\\missing\\no-file.jsonl");
  });

  it("缺少 result/resultSummary/finishedAt 仍走默认值", () => {
    const mapped = mapCodeBuddyStopPayload({
      session_id: "fixture-session-codebuddy-defaults",
      event_id: "fixture-stop-defaults",
    });
    expect(mapped.status).toBe("mapped");
    if (mapped.status !== "mapped") return;
    expect(mapped.payload.result).toBe("success");
    expect(mapped.payload.resultSummary).toBeUndefined();
    expect(typeof mapped.payload.finishedAt).toBe("string");
  });

  it("可选字段缺失 → 默认值渲染（result=success、finishedAt=当前时间）", () => {
    const mapped = mapCodeBuddyStopPayload({ session_id: "fixture-session-codebuddy-0002" });
    expect(mapped.status).toBe("mapped");
    if (mapped.status !== "mapped") return;
    expect(mapped.payload.result).toBe("success");
    expect(typeof mapped.payload.finishedAt).toBe("string");
    expect(mapped.payload.resultSummary).toBeUndefined();
  });

  it("显式非成功状态透传（如实反映失败/中断，SC-003）", () => {
    const mapped = mapCodeBuddyStopPayload({
      session_id: "fixture-session-codebuddy-0003",
      result: "failure",
      resultSummary: "fixture：任务失败",
    });
    expect(mapped.status).toBe("mapped");
    if (mapped.status !== "mapped") return;
    expect(mapped.payload.result).toBe("failure");
    expect(mapped.payload.resultSummary).toBe("fixture：任务失败");
  });

  it("非法 result 枚举 → 回落默认 success，不整体失败（FR-002 可选字段默认值）", () => {
    const mapped = mapCodeBuddyStopPayload({
      session_id: "fixture-session-codebuddy-0004",
      result: "ok-not-an-enum",
    });
    expect(mapped.status).toBe("mapped");
    if (mapped.status !== "mapped") return;
    expect(mapped.payload.result).toBe("success");
  });
});

describe("hook --source CLI / 来源钩子 CLI 契约（T004，US1）", () => {
  let dataDir: string;

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), "notice-hook-source-"));
  });

  afterEach(() => {
    rmSync(dataDir, { recursive: true, force: true });
  });

  function cli(argv: string[], stdin?: Readable) {
    let out = "";
    let errOut = "";
    return runCli(argv, {
      dataDir,
      stdin,
      out: (s) => {
        out += s;
      },
      err: (s) => {
        errOut += s;
      },
    }).then((code) => ({ code, out, errOut }));
  }

  it("--source codebuddy + stdin 负载 → 退出码 0", async () => {
    const { code } = await cli(
      ["hook", "--source", "codebuddy"],
      Readable.from([Buffer.from(JSON.stringify(codebuddyFixture))]),
    );
    expect(code).toBe(0);
  });

  it("--source codebuddy + 缺 session_id → 仍受理且不泄露负载", async () => {
    const { session_id: _ignored, ...withoutSession } = codebuddyFixture;
    const { code, errOut } = await cli(
      ["hook", "--source", "codebuddy"],
      Readable.from([Buffer.from(JSON.stringify(withoutSession))]),
    );
    expect(code).toBe(0);
    expect(errOut).toBe("");
  });

  it("未知 --source 值 → 退出码 2（FR-009 来源标识约束）", async () => {
    const { code, errOut } = await cli(
      ["hook", "--source", "unknown-agent"],
      Readable.from([Buffer.from(JSON.stringify(VALID_PAYLOAD))]),
    );
    expect(code).toBe(2);
    const parsed = JSON.parse(errOut.trim()) as { error: string; details: string[] };
    expect(parsed.error).toBe("VALIDATION_FAILED");
    expect(parsed.details.join(" ")).toContain("--source");
  });
});

const claudeFixture = JSON.parse(
  readFileSync(join(__dirname, "../fixtures/dialog-sources/claude-stop-sample.json"), "utf8"),
) as Record<string, unknown>;

describe("Claude Code Stop mapping / Claude Stop 映射（008 US1）", () => {
  let dataDir: string;

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), "notice-hook-claude-"));
  });

  afterEach(() => {
    rmSync(dataDir, { recursive: true, force: true });
  });

  function cli(argv: string[], stdin?: Readable) {
    let out = "";
    let errOut = "";
    return runCli(argv, {
      dataDir,
      stdin,
      out: (s) => {
        out += s;
      },
      err: (s) => {
        errOut += s;
      },
    }).then((code) => ({ code, out, errOut }));
  }

  it("--source claude-code 接受 Stop 负载，不报 CodeBuddy 来源错误", async () => {
    const { code, errOut } = await cli(
      ["hook", "--source", "claude-code"],
      Readable.from([Buffer.from(JSON.stringify(claudeFixture))]),
    );
    expect(code).toBe(0);
    expect(errOut).not.toContain("codebuddy");
  });
});

const codexFixture = JSON.parse(
  readFileSync(join(__dirname, "../fixtures/dialog-sources/codex-notify-sample.json"), "utf8"),
) as Record<string, unknown>;

describe("Codex notify payload mapping / Codex notify 负载映射（T009，US2）", () => {
  it("agent-turn-complete → 标准负载：source=codex-cli、thread-id→taskId、last-assistant-message→resultSummary", () => {
    const mapped = mapCodexNotifyPayload(codexFixture);
    expect(mapped.status).toBe("mapped");
    if (mapped.status !== "mapped") return;
    expect(mapped.payload.source).toBe("codex-cli");
    expect(mapped.payload.taskId).toBe("fixture-thread-codex-0001");
    expect(mapped.payload.schemaVersion).toBe(1);
    expect(mapped.payload.result).toBe("success");
    expect(mapped.payload.resultSummary).toBe("fixture：已完成虚构任务并修改 2 个文件");
    expect(typeof mapped.payload.finishedAt).toBe("string");
  });

  it("非 agent-turn-complete 事件 → ignored（静默忽略，退出码 0）", () => {
    const mapped = mapCodexNotifyPayload({ type: "session-started" });
    expect(mapped.status).toBe("ignored");
  });

  it("缺 thread-id → unknown-session 且按本次调用降级受理", () => {
    const warnings: string[] = [];
    const mapped = mapCodexNotifyPayload({ type: "agent-turn-complete" }, (message) =>
      warnings.push(message),
    );
    expect(mapped.status).toBe("mapped");
    if (mapped.status !== "mapped") return;
    expect(mapped.payload.taskId).toBe("unknown-session");
    expect(mapped.degradedKey).toBe(true);
    expect(warnings.join(" ")).toContain("稳定事件身份");
  });

  it("超长 last-assistant-message → 截断至 500 字符（管线 resultSummary 上限）", () => {
    const mapped = mapCodexNotifyPayload({
      ...codexFixture,
      "thread-id": "fixture-thread-codex-0003",
      "last-assistant-message": "长".repeat(800),
    });
    expect(mapped.status).toBe("mapped");
    if (mapped.status !== "mapped") return;
    const summary = mapped.payload.resultSummary as string;
    expect(summary.length).toBe(500);
  });
});

describe("hook --payload-argv CLI / Codex notify 调用契约（T009，US2）", () => {
  let dataDir: string;

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), "notice-hook-argv-"));
  });

  afterEach(() => {
    rmSync(dataDir, { recursive: true, force: true });
  });

  function cli(argv: string[], stdin?: Readable) {
    let out = "";
    let errOut = "";
    return runCli(argv, {
      dataDir,
      stdin,
      out: (s) => {
        out += s;
      },
      err: (s) => {
        errOut += s;
      },
    }).then((code) => ({ code, out, errOut }));
  }

  it("notify = [notice hook --source codex-cli --payload-argv <json>] → 退出码 0", async () => {
    const { code } = await cli([
      "hook",
      "--source",
      "codex-cli",
      "--payload-argv",
      JSON.stringify(codexFixture),
    ]);
    expect(code).toBe(0);
  });

  it("非 agent-turn-complete 事件 → 退出码 0 静默忽略", async () => {
    const { code } = await cli([
      "hook",
      "--source",
      "codex-cli",
      "--payload-argv",
      JSON.stringify({ type: "session-started" }),
    ]);
    expect(code).toBe(0);
  });

  it("argv JSON 损坏 → 退出码 2 且错误信息不含原始负载（脱敏）", async () => {
    const secret = "sk-proj-should-not-appear-in-logs";
    const { code, errOut } = await cli([
      "hook",
      "--source",
      "codex-cli",
      "--payload-argv",
      `{"type":"agent-turn-complete","thread-id":"${secret}"`,
    ]);
    expect(code).toBe(2);
    expect(errOut).not.toContain(secret);
    const parsed = JSON.parse(errOut.trim()) as { error: string };
    expect(parsed.error).toBe("VALIDATION_FAILED");
  });

  it("--payload-argv 无参数 → 退出码 2", async () => {
    const { code } = await cli(["hook", "--source", "codex-cli", "--payload-argv"]);
    expect(code).toBe(2);
  });
});
