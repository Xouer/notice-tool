import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  ChannelConfigError,
  validateChannelInput,
  summarizeCredentials,
} from "../../src/channels/channel-config.js";
import { BlobCipher } from "../../src/storage/crypto.js";
import { InMemorySecretStore } from "../../src/storage/secret-store.js";
import { openMemoryDatabase } from "../../src/storage/db.js";
import { ChannelRepository } from "../../src/storage/channel-repository.js";
import {
  notificationChannels,
  notificationRecords,
  taskEvents,
} from "../../src/storage/schema.js";

/**
 * T016：渠道配置校验单元测试（Red 先行）。
 * 约束逐条引用 data-model.md：type 枚举五值；name 非空、同 type 内唯一；
 * Webhook URL 合法；email 密文结构须含收件地址与 SMTP 授权码；
 * enabled 默认 false；删除渠道后凭据一并清除且历史通知记录保留（channel_id 置空）。
 */
const FEISHU_WEBHOOK =
  "https://open.feishu.example/open-apis/bot/v2/hook/0d1e2f3a4b5c6d7e8f9a0b1c";

function makeRepo() {
  const db = openMemoryDatabase();
  const repo = new ChannelRepository(
    db,
    new BlobCipher(new InMemorySecretStore().getMainKey()),
  );
  return { db, repo };
}

describe("channel config validation / 渠道配置校验（T016）", () => {
  it("合法类型通过且密文内部结构带 schemaVersion", () => {
    const validated = validateChannelInput("feishu", "群机器人", {
      webhookUrl: FEISHU_WEBHOOK,
    });
    expect(validated.type).toBe("feishu");
    expect(validated.name).toBe("群机器人");
    expect(validated.credentials).toMatchObject({ schemaVersion: 1 });
  });

  it("type 枚举五值：非法类型拒绝", () => {
    expect(() =>
      validateChannelInput("slack", "x", { webhookUrl: FEISHU_WEBHOOK }),
    ).toThrow(ChannelConfigError);
  });

  it("name 非空且长度 ≤ 64", () => {
    expect(() =>
      validateChannelInput("feishu", "   ", { webhookUrl: FEISHU_WEBHOOK }),
    ).toThrow(ChannelConfigError);
    expect(() =>
      validateChannelInput("feishu", "x".repeat(65), { webhookUrl: FEISHU_WEBHOOK }),
    ).toThrow(ChannelConfigError);
  });

  it("Webhook URL 必须合法且仅 http/https", () => {
    expect(() =>
      validateChannelInput("feishu", "a", { webhookUrl: "not-a-url" }),
    ).toThrow(ChannelConfigError);
    expect(() =>
      validateChannelInput("dingtalk", "a", { webhookUrl: "ftp://example/x" }),
    ).toThrow(ChannelConfigError);
  });

  it("email 密文结构须含收件地址与 SMTP 授权码", () => {
    expect(() =>
      validateChannelInput("email", "mail", { smtpHost: "smtp.test", to: "a@b.c" }),
    ).toThrow(ChannelConfigError); // 缺 authCode
    expect(() =>
      validateChannelInput("email", "mail", { smtpHost: "smtp.test", authCode: "code" }),
    ).toThrow(ChannelConfigError); // 缺收件地址
    expect(() =>
      validateChannelInput("email", "mail", {
        smtpHost: "smtp.test",
        authCode: "auth-code-123456",
        to: "a@b.c",
      }),
    ).not.toThrow();
  });

  it("wechat：webhook 模式须合法 URL，push 模式须 pushKey", () => {
    expect(() =>
      validateChannelInput("wechat", "w", { mode: "webhook" }),
    ).toThrow(ChannelConfigError);
    expect(() =>
      validateChannelInput("wechat", "w", { mode: "push" }),
    ).toThrow(ChannelConfigError);
    expect(() =>
      validateChannelInput("wechat", "w", {
        mode: "push",
        pushKey: "SCT1234567890abcdef",
      }),
    ).not.toThrow();
  });

  it("qq：official 模式须 appId/appSecret/endpoint，push 模式须 pushKey", () => {
    expect(() =>
      validateChannelInput("qq", "q", { mode: "official", appId: "id" }),
    ).toThrow(ChannelConfigError);
    expect(() =>
      validateChannelInput("qq", "q", {
        mode: "official",
        appId: "id",
        appSecret: "s",
        endpoint: "https://api.qq.example/channels/1/messages",
      }),
    ).not.toThrow();
    expect(() =>
      validateChannelInput("qq", "q", {
        mode: "push",
        pushKey: "pushplus-key-123",
      }),
    ).not.toThrow();
  });

  it("summarizeCredentials 输出掩码且不含明文", () => {
    const summary = summarizeCredentials("feishu", { webhookUrl: FEISHU_WEBHOOK });
    expect(summary).not.toContain("0d1e2f3a4b5c6d7e8f9a0b1c");
    const emailSummary = summarizeCredentials("email", {
      authCode: "auth-code-123456",
      to: "a@b.c",
    });
    expect(emailSummary).not.toContain("auth-code-123456");
  });
});

describe("feishu app-mode credentials / 飞书应用凭证模式（002-T002）", () => {
  const APP_ID = "cli_a1b2c3d4e5f6";
  const APP_SECRET = "feishu-app-secret-9876543210";
  const RECEIVE_ID = "oc_1234567890abcdef";

  function appCredentials(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      mode: "app",
      appId: APP_ID,
      appSecret: APP_SECRET,
      receiveIdType: "chat_id",
      receiveId: RECEIVE_ID,
      ...overrides,
    };
  }

  it("mode=app 合法凭据通过且保留全部字段", () => {
    const validated = validateChannelInput("feishu", "应用凭证", appCredentials());
    expect(validated.credentials).toEqual({
      schemaVersion: 1,
      mode: "app",
      appId: APP_ID,
      appSecret: APP_SECRET,
      receiveIdType: "chat_id",
      receiveId: RECEIVE_ID,
    });
  });

  it("mode 枚举 app|webhook：非法值拒绝", () => {
    expect(() =>
      validateChannelInput("feishu", "a", appCredentials({ mode: "bot" })),
    ).toThrow(ChannelConfigError);
  });

  it("mode=app 缺任一必填字段（appId/appSecret/receiveIdType/receiveId）→ 拒绝且提示字段名", () => {
    for (const field of ["appId", "appSecret", "receiveIdType", "receiveId"]) {
      const broken = appCredentials();
      delete broken[field];
      try {
        validateChannelInput("feishu", "a", broken);
        expect.unreachable(`缺少 ${field} 应当拒绝`);
      } catch (cause) {
        expect(cause).toBeInstanceOf(ChannelConfigError);
        expect((cause as Error).message).toContain(field);
      }
    }
  });

  it("receiveIdType 枚举 chat_id|open_id|user_id|email：非法值拒绝", () => {
    expect(() =>
      validateChannelInput("feishu", "a", appCredentials({ receiveIdType: "union_id" })),
    ).toThrow(ChannelConfigError);
    expect(() =>
      validateChannelInput("feishu", "a", appCredentials({ receiveIdType: "open_id" })),
    ).not.toThrow();
  });

  it("mode 缺省视为 webhook（旧数据零迁移）：缺 webhookUrl 时仍拒绝", () => {
    expect(() => validateChannelInput("feishu", "a", { appId: APP_ID })).toThrow(
      ChannelConfigError,
    );
    expect(() =>
      validateChannelInput("feishu", "a", { webhookUrl: FEISHU_WEBHOOK }),
    ).not.toThrow();
  });

  it("mode=app 时未校验 webhookUrl；mode=webhook 时未要求 app 字段（互斥）", () => {
    // app 模式不需要 webhookUrl
    expect(() => validateChannelInput("feishu", "a", appCredentials())).not.toThrow();
    // webhook 模式不需要 app 字段（既有行为不变）
    expect(() =>
      validateChannelInput("feishu", "a", { mode: "webhook", webhookUrl: FEISHU_WEBHOOK }),
    ).not.toThrow();
  });

  it("summarizeCredentials app 模式：appId/receiveId 掩码，appSecret 原文不可见", () => {
    const summary = summarizeCredentials("feishu", appCredentials());
    expect(summary).not.toContain(APP_SECRET);
    expect(summary).not.toContain(APP_ID);
    expect(summary).not.toContain(RECEIVE_ID);
    expect(summary).toContain("→");
  });

  it("summarizeCredentials app 模式字段缺失时输出 *** 兜底", () => {
    expect(summarizeCredentials("feishu", { mode: "app" })).toBe("***");
  });

  it("app 模式凭据入库后 getCredentials 解密往返保留原结构", () => {
    const { repo } = makeRepo();
    const ch = repo.create({
      type: "feishu",
      name: "应用凭证",
      credentials: appCredentials(),
    });
    expect(repo.getCredentials(ch.id)).toEqual({
      schemaVersion: 1,
      ...appCredentials(),
    });
  });
});

describe("channel repository / 渠道仓储（T016 存储语义）", () => {
  it("enabled 默认 false；凭据以密文入库（raw blob 不含明文）", () => {
    const { db, repo } = makeRepo();
    const row = repo.create({
      type: "feishu",
      name: "群机器人",
      credentials: { webhookUrl: FEISHU_WEBHOOK },
    });
    expect(row.enabled).toBe(false);
    const raw = db
      .select()
      .from(notificationChannels)
      .where(eq(notificationChannels.id, row.id))
      .get();
    expect(raw?.credentialsBlob).not.toContain("open.feishu.example");
    expect(raw?.credentialsBlob).not.toContain("0d1e2f3a4b5c6d7e8f9a0b1c");
  });

  it("name 同 type 内唯一（不同 type 可同名）", () => {
    const { repo } = makeRepo();
    repo.create({ type: "feishu", name: "a", credentials: { webhookUrl: FEISHU_WEBHOOK } });
    expect(() =>
      repo.create({ type: "feishu", name: "a", credentials: { webhookUrl: FEISHU_WEBHOOK } }),
    ).toThrow(ChannelConfigError);
    expect(() =>
      repo.create({ type: "dingtalk", name: "a", credentials: { webhookUrl: "https://oapi.example/robot/send?access_token=x12345678" } }),
    ).not.toThrow();
  });

  it("删除渠道后凭据一并清除且历史通知记录保留（channel_id 置空）", () => {
    const { db, repo } = makeRepo();
    const ch = repo.create({
      type: "feishu",
      name: "待删除",
      credentials: { webhookUrl: FEISHU_WEBHOOK },
    });
    const now = new Date();
    const eventId = randomUUID();
    db.insert(taskEvents)
      .values({
        id: eventId,
        sourceAgent: "demo",
        taskId: "t-001",
        finishedAt: now,
        resultStatus: "success",
        triggerType: "hook",
        receivedAt: now,
        notifyStatus: "dispatched",
      })
      .run();
    db.insert(notificationRecords)
      .values({
        id: randomUUID(),
        eventId,
        channelId: ch.id,
        status: "sent",
        attempts: 1,
        createdAt: now,
        updatedAt: now,
      })
      .run();

    repo.remove(ch.id);

    expect(db.select().from(notificationChannels).all()).toHaveLength(0); // 渠道与凭据物理清除
    const records = db.select().from(notificationRecords).all();
    expect(records).toHaveLength(1); // 历史记录保留（FR-011）
    expect(records[0]?.channelId).toBeNull(); // channel_id 置空
  });

  it("getCredentials 解密往返返回原始凭据结构", () => {
    const { repo } = makeRepo();
    const ch = repo.create({
      type: "feishu",
      name: "解密",
      credentials: { webhookUrl: FEISHU_WEBHOOK },
    });
    expect(repo.getCredentials(ch.id)).toEqual({
      schemaVersion: 1,
      webhookUrl: FEISHU_WEBHOOK,
    });
  });
});
