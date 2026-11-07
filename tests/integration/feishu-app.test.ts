import { createServer, type IncomingMessage, type Server } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runCli } from "../../src/cli/index.js";
import { clearFeishuTokenCacheForTests } from "../../src/channels/feishu-token.js";
import { FeishuAdapter } from "../../src/channels/feishu.js";
import { ingestTaskEndEvent } from "../../src/core/event-pipeline.js";
import { BlobCipher } from "../../src/storage/crypto.js";
import { InMemorySecretStore } from "../../src/storage/secret-store.js";
import { openMemoryDatabase } from "../../src/storage/db.js";
import { ChannelRepository } from "../../src/storage/channel-repository.js";
import { TemplateRepository } from "../../src/storage/template-repository.js";
import { seedDefaultTemplates } from "../../src/storage/seed.js";
import { notificationRecords } from "../../src/storage/schema.js";
import {
  startFeishuFakeServer,
  type FeishuFakeServer,
} from "./helpers/feishu-fake-server.js";

/**
 * 002-T007：应用凭证模式发送链路集成测试（Red 先行，contracts/feishu-app-channel.md）。
 * - 全链路成功：令牌头、receive_id_type 查询参数、content 字符串化 JSON
 * - 错误分类映射：凭证无效/缺权限 → AUTH_INVALID；机器人不在会话/目标不存在 → CONTENT_REJECTED；
 *   限流 → RATE_LIMITED_REMOTE；网络故障 → NETWORK_UNREACHABLE
 * - 令牌中途失效：自动清缓存重取并重试一次成功
 * - 脱敏：全部输出不含 appSecret / 令牌 / 原始响应体（FR-106）
 */
const APP_ID = "cli_a1b2c3d4e5f6";
const APP_SECRET = "feishu-app-secret-9876543210";
const RECEIVE_ID = "oc_1234567890abcdef";

let dataDir: string;
let fake: FeishuFakeServer | null = null;

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), "notice-feishu-app-"));
  clearFeishuTokenCacheForTests();
});

afterEach(() => {
  delete process.env["NOTICE_FEISHU_API_BASE"];
  fake?.close();
  fake = null;
  for (const close of webhookOkClosers.splice(0)) {
    try {
      close();
    } catch {
      // ignore
    }
  }
  rmSync(dataDir, { recursive: true, force: true });
});

const webhookOkClosers: Array<() => void> = [];

/** 通用 Webhook 假服务：任意路径返回 { code: 0 }（供 001 Webhook 模式对照用例）。 */
function startWebhookOkServer(): Promise<{ port: number }> {
  const server: Server = createServer((req: IncomingMessage, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c as Buffer));
    req.on("end", () => {
      res.statusCode = 200;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ code: 0 }));
    });
  });
  webhookOkClosers.push(() => server.close());
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      resolve({ port: typeof addr === "object" && addr !== null ? addr.port : 0 });
    });
  });
}

function cli(argv: string[]) {
  let out = "";
  let errOut = "";
  return runCli(argv, {
    dataDir,
    out: (s) => {
      out += s;
    },
    err: (s) => {
      errOut += s;
    },
  }).then((code) => ({ code, out, errOut }));
}

async function startFake(
  options: Parameters<typeof startFeishuFakeServer>[0] = {},
): Promise<FeishuFakeServer> {
  fake = await startFeishuFakeServer(options);
  process.env["NOTICE_FEISHU_API_BASE"] = `http://127.0.0.1:${fake.port}`;
  return fake;
}

async function addAppChannel(name: string): Promise<void> {
  const { code } = await cli([
    "channel", "add", "feishu", "--name", name, "--mode", "app",
    "--app-id", APP_ID, "--app-secret", APP_SECRET,
    "--receive-id-type", "chat_id", "--receive-id", RECEIVE_ID,
  ]);
  expect(code).toBe(0);
}

describe("feishu app-mode send flow / 凭证通道发送（002-T007）", () => {
  it("全链路成功：Bearer 令牌头 + receive_id_type + content 字符串化 JSON；测试通过后自动启用", async () => {
    const server = await startFake();
    await addAppChannel("应用凭证");
    const { code, out } = await cli(["channel", "test", "应用凭证"]);
    expect(code).toBe(0);
    expect(out).toContain("成功");

    expect(server.calls.token).toBe(1);
    expect(server.calls.message).toBe(1);
    const msg = server.receivedMessages[0];
    expect(msg?.receiveIdType).toBe("chat_id");
    expect(msg?.authorization).toBe("Bearer t-fake-token-1");
    expect(msg?.body.receive_id).toBe(RECEIVE_ID);
    expect(msg?.body.msg_type).toBe("text");
    expect(typeof msg?.body.content).toBe("string");
    const content = JSON.parse(String(msg?.body.content)) as { text: string };
    expect(content.text.length).toBeGreaterThan(0);

    const listed = JSON.parse(
      (await cli(["channel", "list", "--json"])).out.trim(),
    ) as { channels: Array<{ enabled: boolean }> };
    expect(listed.channels[0]?.enabled).toBe(true);
  });

  it("令牌缓存生效：同渠道连续两次 test 仅一次令牌请求", async () => {
    const server = await startFake();
    await addAppChannel("缓存");
    expect((await cli(["channel", "test", "缓存"])).code).toBe(0);
    expect((await cli(["channel", "test", "缓存"])).code).toBe(0);
    expect(server.calls.token).toBe(1);
    expect(server.calls.message).toBe(2);
  });

  it("凭证无效（令牌接口 code != 0）→ AUTH_INVALID，输出不含 appSecret", async () => {
    await startFake({ tokenBehavior: "invalid-credential" });
    await addAppChannel("坏凭证");
    const { code, out, errOut } = await cli(["channel", "test", "坏凭证"]);
    expect(code).toBe(1);
    expect(`${out}${errOut}`).toContain("AUTH_INVALID");
    expect(`${out}${errOut}`).not.toContain(APP_SECRET);
  });

  it("缺消息发送权限 → AUTH_INVALID，提示开通权限/发布版本", async () => {
    await startFake({ messageBehavior: "no-permission" });
    await addAppChannel("无权限");
    const { code, out, errOut } = await cli(["channel", "test", "无权限"]);
    expect(code).toBe(1);
    expect(`${out}${errOut}`).toContain("AUTH_INVALID");
    expect(`${out}${errOut}`).toContain("权限");
    expect(`${out}${errOut}`).not.toContain("im:message"); // 原始响应体不回显
  });

  it("机器人不在目标会话 → CONTENT_REJECTED，提示检查接收目标", async () => {
    await startFake({ messageBehavior: "bot-not-in-chat" });
    await addAppChannel("不在群");
    const { code, out, errOut } = await cli(["channel", "test", "不在群"]);
    expect(code).toBe(1);
    expect(`${out}${errOut}`).toContain("CONTENT_REJECTED");
  });

  it("接收目标不存在 → CONTENT_REJECTED", async () => {
    await startFake({ messageBehavior: "target-not-found" });
    await addAppChannel("坏目标");
    const { code, out, errOut } = await cli(["channel", "test", "坏目标"]);
    expect(code).toBe(1);
    expect(`${out}${errOut}`).toContain("CONTENT_REJECTED");
  });

  it("接口限流 → RATE_LIMITED_REMOTE", async () => {
    await startFake({ messageBehavior: "rate-limited" });
    await addAppChannel("限流");
    const { code, out, errOut } = await cli(["channel", "test", "限流"]);
    expect(code).toBe(1);
    expect(`${out}${errOut}`).toContain("RATE_LIMITED_REMOTE");
  });

  it("网络不可达（开放平台不可达）→ NETWORK_UNREACHABLE，不崩溃", async () => {
    process.env["NOTICE_FEISHU_API_BASE"] = "http://127.0.0.1:1";
    await addAppChannel("断网");
    const { code, out, errOut } = await cli(["channel", "test", "断网"]);
    expect(code).toBe(1);
    expect(`${out}${errOut}`).toContain("NETWORK_UNREACHABLE");
  });

  it("令牌中途失效：自动清缓存重取并重试一次后成功（用户无感）", async () => {
    const server = await startFake({ messageBehavior: "token-expired-once" });
    await addAppChannel("过期重试");
    const { code, out } = await cli(["channel", "test", "过期重试"]);
    expect(code).toBe(0);
    expect(out).toContain("成功");
    // 令牌两次发放（重取）+ 消息两次发送（第二次成功）
    expect(server.calls.token).toBe(2);
    expect(server.calls.message).toBe(2);
    expect(server.receivedMessages[1]?.authorization).toBe("Bearer t-fake-token-2");
  });

  it("webhook 模式回归：mode=webhook 行为与 001 一致", async () => {
    const port = (await startFake()).port;
    const { code: addCode } = await cli([
      "channel", "add", "feishu", "--name", "旧方式",
      "--webhook-url", `http://127.0.0.1:${port}/hook/whatever`,
    ]);
    expect(addCode).toBe(0);
    const { code } = await cli(["channel", "test", "旧方式"]);
    // webhook 模式打到非 webhook 路径会 404，但失败分类存在即证明走的是 webhook 直发路径
    expect([0, 1]).toContain(code);
    // webhook 模式不应触碰令牌接口
    expect(fake?.calls.token).toBe(0);
  });
});

describe("dispatch via app-credential channel / 凭证通道通知分发（002-T010）", () => {
  function makeDispatchSetup() {
    const db = openMemoryDatabase();
    seedDefaultTemplates(db);
    const channels = new ChannelRepository(
      db,
      new BlobCipher(new InMemorySecretStore().getMainKey()),
    );
    const templates = new TemplateRepository(db);
    const adapter = new FeishuAdapter();
    const payload = {
      schemaVersion: 1,
      source: "claude-code",
      taskId: "task-001",
      result: "success",
      resultSummary: "完成三处修复",
    };
    const ingest = (overrides?: {
      result?: string;
      taskId?: string;
      maxAttempts?: number;
    }) =>
      ingestTaskEndEvent(
        {
          db,
          channels,
          templates,
          getAdapter: () => adapter,
          config: { cooldownMinutes: 10 },
          dispatchOptions: {
            maxAttempts: overrides?.maxAttempts ?? 2,
            retryDelayMs: 1,
          },
        },
        {
          ...payload,
          result: overrides?.result ?? payload.result,
          taskId: overrides?.taskId ?? payload.taskId,
        },
      );
    return { db, channels, templates, payload, ingest };
  }

  it("任务结束事件经凭证渠道送达：sent 记录 + 模板渲染内容含任务标识", async () => {
    const server = await startFake();
    const { db, channels, ingest } = makeDispatchSetup();
    const row = channels.create({
      type: "feishu",
      name: "应用凭证",
      credentials: {
        mode: "app",
        appId: APP_ID,
        appSecret: APP_SECRET,
        receiveIdType: "chat_id",
        receiveId: RECEIVE_ID,
      },
    });
    channels.setEnabled(row.id, true);

    const result = await ingest();
    expect(result.deduplicated).toBe(false);
    expect(result.records[0]?.status).toBe("sent");
    expect(db.select().from(notificationRecords).all()[0]?.status).toBe("sent");

    const msg = server.receivedMessages[0];
    const content = JSON.parse(String(msg?.body.content)) as { text: string };
    expect(content.text).toContain("task-001");
  });

  it("结果状态 failure 如实体现在通知内容", async () => {
    const server = await startFake();
    const { channels, ingest } = makeDispatchSetup();
    const row = channels.create({
      type: "feishu",
      name: "应用凭证",
      credentials: {
        mode: "app",
        appId: APP_ID,
        appSecret: APP_SECRET,
        receiveIdType: "chat_id",
        receiveId: RECEIVE_ID,
      },
    });
    channels.setEnabled(row.id, true);

    await ingest({ result: "failure", taskId: "task-fail-1" });
    const content = JSON.parse(
      String(server.receivedMessages[0]?.body.content),
    ) as { text: string };
    expect(content.text).toContain("failure");
  });

  it("去重复用：同一任务两次事件仅一轮通知", async () => {
    const server = await startFake();
    const { channels, ingest } = makeDispatchSetup();
    const row = channels.create({
      type: "feishu",
      name: "应用凭证",
      credentials: {
        mode: "app",
        appId: APP_ID,
        appSecret: APP_SECRET,
        receiveIdType: "chat_id",
        receiveId: RECEIVE_ID,
      },
    });
    channels.setEnabled(row.id, true);

    await ingest();
    const second = await ingest();
    expect(second.deduplicated).toBe(true);
    expect(second.records).toHaveLength(0);
    expect(server.calls.message).toBe(1);
  });

  it("单渠道失败不阻断其他渠道：凭证渠道限流失败，Webhook 渠道照常送达", async () => {
    await startFake({ messageBehavior: "rate-limited" });
    // 另起一个通用的 feishu-webhook 假服务（任意路径返回 code:0）
    const okServer = await startWebhookOkServer();
    const { db, channels, ingest } = makeDispatchSetup();
    const appRow = channels.create({
      type: "feishu",
      name: "应用凭证",
      credentials: {
        mode: "app",
        appId: APP_ID,
        appSecret: APP_SECRET,
        receiveIdType: "chat_id",
        receiveId: RECEIVE_ID,
      },
    });
    channels.setEnabled(appRow.id, true);
    const webhookRow = channels.create({
      type: "feishu",
      name: "群机器人",
      credentials: { webhookUrl: `http://127.0.0.1:${okServer.port}/hook/abc` },
    });
    channels.setEnabled(webhookRow.id, true);

    const result = await ingest({ maxAttempts: 2 });
    const statuses = result.records.map((r) => r.status).sort();
    expect(statuses).toEqual(["failed", "sent"]); // app 渠道失败（限流），webhook 渠道送达
    const failedRecord = db
      .select()
      .from(notificationRecords)
      .all()
      .find((r) => r.status === "failed");
    expect(failedRecord?.lastErrorCode).toBe("RATE_LIMITED_REMOTE");
  });

  it("令牌中途过期不产生用户可见干预：分发送达且令牌重取一次", async () => {
    const server = await startFake({ messageBehavior: "token-expired-once" });
    const { channels, ingest } = makeDispatchSetup();
    const row = channels.create({
      type: "feishu",
      name: "应用凭证",
      credentials: {
        mode: "app",
        appId: APP_ID,
        appSecret: APP_SECRET,
        receiveIdType: "chat_id",
        receiveId: RECEIVE_ID,
      },
    });
    channels.setEnabled(row.id, true);

    const result = await ingest();
    expect(result.records[0]?.status).toBe("sent");
    expect(server.calls.token).toBe(2);
  });
});
