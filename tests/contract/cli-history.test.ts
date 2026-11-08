import { createServer, type Server } from "node:http";
import { Readable } from "node:stream";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runCli } from "../../src/cli/index.js";

/**
 * history/resend 契约测试（支撑 T045）：
 * --limit/--status 过滤、resend 将 failed 重置 pending 并重发、输出无明文凭据、
 * "有事件但无可用渠道"提示。
 */
let dataDir: string;
const closers: Array<() => void> = [];

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), "notice-hist-"));
});

afterEach(() => {
  for (const close of closers.splice(0)) {
    try {
      close();
    } catch {
      // ignore
    }
  }
  rmSync(dataDir, { recursive: true, force: true });
});

function cli(argv: string[], stdin?: Buffer) {
  let out = "";
  let errOut = "";
  return runCli(argv, {
    dataDir,
    stdin: stdin === undefined ? undefined : Readable.from([stdin]),
    out: (s) => {
      out += s;
    },
    err: (s) => {
      errOut += s;
    },
  }).then((code) => ({ code, out, errOut }));
}

function listenHttp(statusCode: number): Promise<number> {
  const server: Server = createServer((_req, res) => {
    res.statusCode = statusCode;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ code: 0 }));
  });
  closers.push(() => server.close());
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      resolve(typeof addr === "object" && addr !== null ? addr.port : 0);
    });
  });
}

describe("CLI history / 通知历史契约（T045）", () => {
  it("history --json 空列表结构", async () => {
    const { code, out } = await cli(["history", "--json"]);
    expect(code).toBe(0);
    expect(JSON.parse(out.trim())).toEqual({ records: [] });
  });

  it("hook 触发后 history 可见 sent 记录且无明文凭据", async () => {
    const port = await listenHttp(200);
    await cli([
      "channel",
      "add",
      "feishu",
      "--name",
      "群",
      "--webhook-url",
      `http://127.0.0.1:${port}/hook/abc123def456`,
    ]);
    await cli(["channel", "enable", "群"]);
    await cli(
      ["hook"],
      Buffer.from(JSON.stringify({ schemaVersion: 1, source: "demo", taskId: "h1" })),
    );
    const { code, out } = await cli(["history", "--json"]);
    expect(code).toBe(0);
    const parsed = JSON.parse(out.trim()) as {
      records: Array<{ id: string; status: string; event: { taskId: string } }>;
    };
    expect(parsed.records).toHaveLength(1);
    expect(parsed.records[0]?.status).toBe("sent");
    expect(parsed.records[0]?.event.taskId).toBe("h1");
    expect(out).not.toContain("abc123def456");
  });

  it("resend：渠道修复后 failed 记录转 sent", async () => {
    let statusCode = 500;
    const server = new (await import("node:http")).Server((_req, res) => {
      res.statusCode = statusCode;
      res.end(JSON.stringify({ code: 0 }));
    });
    closers.push(() => server.close());
    const port = await new Promise<number>((resolve) => {
      server.listen(0, "127.0.0.1", () => {
        const addr = server.address();
        resolve(typeof addr === "object" && addr !== null ? addr.port : 0);
      });
    });
    await cli([
      "channel",
      "add",
      "feishu",
      "--name",
      "群",
      "--webhook-url",
      `http://127.0.0.1:${port}/hook/x`,
    ]);
    await cli(["channel", "enable", "群"]);
    await cli(
      ["hook"],
      Buffer.from(JSON.stringify({ schemaVersion: 1, source: "demo", taskId: "h2" })),
    );
    const failed = JSON.parse(
      (await cli(["history", "--status", "failed", "--json"])).out.trim(),
    ) as { records: Array<{ id: string; status: string }> };
    expect(failed.records).toHaveLength(1);
    // 修复渠道（服务端恢复 200）后手动重发
    statusCode = 200;
    const { code } = await cli(["history", "resend", failed.records[0]?.id ?? ""]);
    expect(code).toBe(0);
    const after = JSON.parse((await cli(["history", "--json"])).out.trim()) as {
      records: Array<{ id: string; status: string }>;
    };
    expect(after.records[0]?.status).toBe("sent");
    server.close();
  });

  it("resend 未知记录 → 退出码 2", async () => {
    const { code } = await cli(["history", "resend", "nonexistent-id"]);
    expect(code).toBe(2);
  });

  it("无渠道时 hook 输出明确提示", async () => {
    const { code, out } = await cli(
      ["hook"],
      Buffer.from(JSON.stringify({ schemaVersion: 1, source: "demo", taskId: "h3" })),
    );
    expect(code).toBe(0);
    expect(out).toContain("无可用渠道");
  });
});

describe("CLI event history / 事件历史契约（008 US2）", () => {
  it("events 空列表使用 events 顶层结构", async () => {
    const { code, out } = await cli(["history", "events", "--json"]);
    expect(code).toBe(0);
    expect(JSON.parse(out.trim())).toEqual({ events: [] });
  });

  it("received 与 duplicated 事件可见且可过滤", async () => {
    const first = {
      schemaVersion: 1,
      source: "demo",
      taskId: "events-1",
      eventKey: "stop-events-1",
    };
    const second = {
      schemaVersion: 1,
      source: "demo",
      taskId: "events-2",
      eventKey: "stop-events-2",
    };
    await cli(["hook"], Buffer.from(JSON.stringify(first)));
    await cli(["hook"], Buffer.from(JSON.stringify(second)));
    await cli(["hook"], Buffer.from(JSON.stringify(second)));
    const all = JSON.parse((await cli(["history", "events", "--json"])).out.trim()) as {
      events: Array<{ taskId: string; status: string }>;
    };
    expect(all.events).toHaveLength(3);
    expect(all.events.filter((event) => event.status === "received")).toHaveLength(2);
    expect(all.events.filter((event) => event.status === "duplicated")).toHaveLength(1);
    const duplicated = JSON.parse(
      (await cli(["history", "events", "--status", "duplicated", "--json"])).out.trim(),
    ) as { events: Array<{ taskId: string }> };
    expect(duplicated.events).toHaveLength(1);
    expect(duplicated.events[0]?.taskId).toBe("events-2");
  });

  it("events 不输出完整敏感事件键或路径", async () => {
    const sensitiveKey = "sk-event-key-very-secret-0123456789";
    await cli(
      ["hook"],
      Buffer.from(
        JSON.stringify({
          schemaVersion: 1,
          source: "demo",
          taskId: "security-events",
          eventKey: sensitiveKey,
          resultSummary: "C:\\Users\\secret\\transcript.jsonl 部署完成",
        }),
      ),
    );
    const { code, out } = await cli(["history", "events", "--json"]);
    expect(code).toBe(0);
    expect(out).not.toContain(sensitiveKey);
    expect(out).not.toContain("C:\\Users\\secret\\transcript.jsonl");
    const parsed = JSON.parse(out.trim()) as { events: Array<{ eventKeySummary: string }> };
    expect(parsed.events[0]?.eventKeySummary.length).toBeLessThanOrEqual(13);
  });

  it("limit 与非法状态过滤", async () => {
    for (const index of [1, 2, 3]) {
      await cli(
        ["hook"],
        Buffer.from(
          JSON.stringify({
            schemaVersion: 1,
            source: "demo",
            taskId: `limit-${index}`,
            eventKey: `stop-limit-${index}`,
          }),
        ),
      );
    }
    const limited = JSON.parse(
      (await cli(["history", "events", "--limit", "2", "--json"])).out.trim(),
    ) as { events: unknown[] };
    expect(limited.events).toHaveLength(2);
    const invalid = await cli(["history", "events", "--status", "sent"]);
    expect(invalid.code).toBe(2);
  });
});
