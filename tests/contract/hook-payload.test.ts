import { Readable } from "node:stream";
import { mkdtempSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { EventValidationError, validateEventPayload } from "../../src/core/event-pipeline.js";
import { ingestTaskEndEvent } from "../../src/core/event-pipeline.js";
import { createHookServer } from "../../src/hookserver/server.js";
import { runCli } from "../../src/cli/index.js";
import { openMemoryDatabase } from "../../src/storage/db.js";
import { ChannelRepository } from "../../src/storage/channel-repository.js";
import { TemplateRepository } from "../../src/storage/template-repository.js";
import { BlobCipher } from "../../src/storage/crypto.js";
import { InMemorySecretStore } from "../../src/storage/secret-store.js";

/**
 * T030：钩子负载契约测试（Red 先行，contracts/hook-receiver.md）。
 * 字段必填性/长度上限（source ≤64、taskId ≤256、resultSummary ≤500）/枚举值；
 * 非法负载整体拒绝；HTTP 响应 202/400/429/500 及 deduplicated 标记；CLI 退出码 0/2/3。
 */
const VALID_PAYLOAD = {
  schemaVersion: 1,
  source: "demo",
  taskId: "task-001",
  result: "success",
  resultSummary: "演示任务结束",
};

function makeDeps() {
  const db = openMemoryDatabase();
  const channels = new ChannelRepository(db, new BlobCipher(new InMemorySecretStore().getMainKey()));
  const templates = new TemplateRepository(db);
  return {
    db,
    channels,
    templates,
    getAdapter: () => {
      throw new Error("本测试无渠道");
    },
    config: { cooldownMinutes: 10 },
  };
}

describe("hook payload validation / 负载校验（T030）", () => {
  it("合法负载通过并补齐缺省值", () => {
    const event = validateEventPayload({ ...VALID_PAYLOAD, trigger: "hook" });
    expect(event.source).toBe("demo");
    expect(event.taskId).toBe("task-001");
    expect(event.result).toBe("success");
    expect(event.trigger).toBe("hook");
    expect(event.finishedAt).toBeInstanceOf(Date);
  });

  it("缺必填字段（schemaVersion/source/taskId）整体拒绝", () => {
    expect(() => validateEventPayload({ source: "x" })).toThrow(EventValidationError);
    expect(() => validateEventPayload({ ...VALID_PAYLOAD, source: undefined })).toThrow(
      EventValidationError,
    );
  });

  it("长度上限：source ≤64 / taskId ≤256 / resultSummary ≤500", () => {
    expect(() =>
      validateEventPayload({ ...VALID_PAYLOAD, source: "s".repeat(65) }),
    ).toThrow(EventValidationError);
    expect(() =>
      validateEventPayload({ ...VALID_PAYLOAD, taskId: "t".repeat(257) }),
    ).toThrow(EventValidationError);
    expect(() =>
      validateEventPayload({ ...VALID_PAYLOAD, resultSummary: "r".repeat(501) }),
    ).toThrow(EventValidationError);
  });

  it("枚举值校验（result/trigger）", () => {
    expect(() => validateEventPayload({ ...VALID_PAYLOAD, result: "ok" })).toThrow(
      EventValidationError,
    );
    expect(() => validateEventPayload({ ...VALID_PAYLOAD, trigger: "cron" })).toThrow(
      EventValidationError,
    );
  });

  it("finishedAt 非 ISO 8601 拒绝", () => {
    expect(() =>
      validateEventPayload({ ...VALID_PAYLOAD, finishedAt: "yesterday" }),
    ).toThrow(EventValidationError);
  });

  it("schemaVersion 不匹配拒绝并注明版本", () => {
    try {
      validateEventPayload({ ...VALID_PAYLOAD, schemaVersion: 2 });
      expect.unreachable("应抛出 EventValidationError");
    } catch (cause) {
      expect(cause).toBeInstanceOf(EventValidationError);
      expect((cause as EventValidationError).details.join(" ")).toContain("1");
    }
  });
});

describe("hook HTTP endpoint / HTTP 端点契约（T030）", () => {
  const deps = makeDeps();
  const makeApp = (options?: Parameters<typeof createHookServer>[1]) =>
    createHookServer(
      {
        ingest: (payload, trigger) => ingestTaskEndEvent(deps, payload, { trigger }),
      },
      options,
    );
  const makeLimitedApp = () =>
    createHookServer(
      { ingest: (payload, trigger) => ingestTaskEndEvent(deps, payload, { trigger }) },
      { rateLimiter: () => false },
    );
  const makeFailingApp = () =>
    createHookServer({
      ingest: async () => {
        throw new Error("database is locked: secret-info-should-not-leak");
      },
    });

  it("合法负载 → 202 { eventId, deduplicated: false }", async () => {
    const app = await makeApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/hooks/task-completed",
      payload: { ...VALID_PAYLOAD },
    });
    expect(res.statusCode).toBe(202);
    const body = res.json() as { eventId: string; deduplicated: boolean };
    expect(body.eventId).toBeTruthy();
    expect(body.deduplicated).toBe(false);
  });

  it("重复 taskId → 202 且 deduplicated: true", async () => {
    const app = await makeApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/hooks/task-completed",
      payload: { ...VALID_PAYLOAD },
    });
    expect(res.statusCode).toBe(202);
    expect((res.json() as { deduplicated: boolean }).deduplicated).toBe(true);
  });

  it("非法负载（缺 source）→ 400 VALIDATION_FAILED", async () => {
    const app = await makeApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/hooks/task-completed",
      payload: { schemaVersion: 1, taskId: "t" },
    });
    expect(res.statusCode).toBe(400);
    const body = res.json() as { error: string; details: unknown[] };
    expect(body.error).toBe("VALIDATION_FAILED");
    expect(Array.isArray(body.details)).toBe(true);
  });

  it("触发频率超限 → 429 RATE_LIMITED retryAfterMs", async () => {
    const app = await makeLimitedApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/hooks/task-completed",
      payload: { ...VALID_PAYLOAD },
    });
    expect(res.statusCode).toBe(429);
    const body = res.json() as { error: string; retryAfterMs: number };
    expect(body.error).toBe("RATE_LIMITED");
    expect(body.retryAfterMs).toBeGreaterThan(0);
  });

  it("内部错误 → 500 INTERNAL 且不含堆栈/敏感细节回显", async () => {
    const app = await makeFailingApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/hooks/task-completed",
      payload: { ...VALID_PAYLOAD },
    });
    expect(res.statusCode).toBe(500);
    const body = res.json() as { error: string; details: string };
    expect(body.error).toBe("INTERNAL");
    expect(body.details).not.toContain("secret-info-should-not-leak");
  });
});

describe("CLI hook / stdin 钩子契约（T030）", () => {
  let dataDir: string;

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), "notice-hook-"));
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

  it("合法负载 → 退出码 0", async () => {
    const { code } = await cli(
      ["hook"],
      Readable.from([Buffer.from(JSON.stringify(VALID_PAYLOAD))]),
    );
    expect(code).toBe(0);
  });

  it("非法负载 → 退出码 2 且 stderr 输出机器可读错误 JSON", async () => {
    const bad = { schemaVersion: 1, taskId: "t" }; // 缺 source
    const { code, errOut } = await cli(
      ["hook"],
      Readable.from([Buffer.from(JSON.stringify(bad))]),
    );
    expect(code).toBe(2);
    const parsed = JSON.parse(errOut.trim()) as { error: string };
    expect(parsed.error).toBe("VALIDATION_FAILED");
  });

  it("非 JSON 输入 → 退出码 2", async () => {
    const { code } = await cli(["hook"], Readable.from([Buffer.from("not-json")]));
    expect(code).toBe(2);
  });

  it("本地存储异常 → 退出码 3", async () => {
    mkdirSync(join(dataDir, "notice.db")); // 数据库路径被目录占用 → 存储异常
    const { code } = await cli(
      ["hook"],
      Readable.from([Buffer.from(JSON.stringify(VALID_PAYLOAD))]),
    );
    expect(code).toBe(3);
  });
});
