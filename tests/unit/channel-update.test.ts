import { afterAll, describe, expect, it } from "vitest";
import { openMemoryDatabase, type NoticeDatabase } from "../../src/storage/db.js";
import { BlobCipher } from "../../src/storage/crypto.js";
import { InMemorySecretStore } from "../../src/storage/secret-store.js";
import { ChannelRepository } from "../../src/storage/channel-repository.js";
import { ChannelConfigError } from "../../src/channels/channel-config.js";

/**
 * 004-T002：渠道修改仓储能力单元测试（Red 先行）。
 * 引用 data-model.md 仓储操作增量与不变量：
 * - rename：成功改名仅更新 name/updatedAt；同 type 内重名预检（排除自身 id）；
 *   不同 type 之间同名允许（FR-009）；改名后 id/type/enabled/credentials_blob 不变
 * - updateCredentials：归一化整体替换重新加密；校验失败时原密文逐字节不变（SC-002）
 */

const WEBHOOK = "https://open.feishu.example/open-apis/bot/v2/hook/0d1e2f3a4b5c6d7e8f9a0b1c";
const OTHER_HOOK = "https://open.feishu.example/open-apis/bot/v2/hook/other0123456789abcdef";

const dbs: NoticeDatabase[] = [];
afterAll(() => {
  for (const db of dbs) {
    try {
      db.$client.close();
    } catch {
      // 已关闭
    }
  }
});

function makeRepo(): { repo: ChannelRepository; db: NoticeDatabase } {
  const db = openMemoryDatabase();
  dbs.push(db);
  const cipher = new BlobCipher(new InMemorySecretStore().getMainKey());
  return { repo: new ChannelRepository(db, cipher), db };
}

/** 直接读取行内密文（ChannelRow 不暴露 blob，用于原子性断言）。 */
function rawBlob(db: NoticeDatabase, name: string): string {
  const row = db.$client
    .prepare("SELECT credentials_blob FROM notification_channels WHERE name = ?")
    .get(name) as { credentials_blob: string } | undefined;
  return row!.credentials_blob;
}

describe("ChannelRepository.rename / 渠道改名（004-T002）", () => {
  it("成功改名：name/updatedAt 更新，其余属性不变", () => {
    const { repo } = makeRepo();
    const row = repo.create({
      type: "dingtalk",
      name: "old-name",
      credentials: { webhookUrl: WEBHOOK },
    });
    repo.setEnabled(row.id, true);
    const before = repo.get(row.id)!;

    const renamed = repo.rename(row.id, "new-name");

    expect(renamed.name).toBe("new-name");
    expect(renamed.id).toBe(row.id);
    expect(renamed.type).toBe("dingtalk");
    expect(renamed.enabled).toBe(true);
    expect(renamed.credentialsSummary).toBe(before.credentialsSummary);
    expect(repo.findByName("old-name")).toBeUndefined();
    expect(repo.findByName("new-name")!.id).toBe(row.id);
  });

  it("同 type 内重名 → ChannelConfigError（同 type 内唯一）", () => {
    const { repo } = makeRepo();
    const a = repo.create({
      type: "feishu",
      name: "feishu-a",
      credentials: { webhookUrl: WEBHOOK },
    });
    repo.create({ type: "feishu", name: "feishu-b", credentials: { webhookUrl: OTHER_HOOK } });
    expect(() => repo.rename(a.id, "feishu-b")).toThrowError(ChannelConfigError);
    expect(() => repo.rename(a.id, "feishu-b")).toThrowError(/同名渠道已存在/);
  });

  it("改名预检排除自身：改为现名幂等成功", () => {
    const { repo } = makeRepo();
    const row = repo.create({ type: "dingtalk", name: "dd", credentials: { webhookUrl: WEBHOOK } });
    const renamed = repo.rename(row.id, "dd");
    expect(renamed.name).toBe("dd");
  });

  it("不同 type 之间同名允许（FR-009）", () => {
    const { repo } = makeRepo();
    const feishu = repo.create({
      type: "feishu",
      name: "shared",
      credentials: { webhookUrl: WEBHOOK },
    });
    repo.create({
      type: "email",
      name: "shared",
      credentials: { smtpHost: "smtp.qq.com", authCode: "code-1", to: "a@example.com" },
    });
    const renamed = repo.rename(feishu.id, "shared");
    expect(renamed.name).toBe("shared");
  });

  it("非法名称（空/超 64 字符）→ ChannelConfigError", () => {
    const { repo } = makeRepo();
    const row = repo.create({ type: "dingtalk", name: "dd", credentials: { webhookUrl: WEBHOOK } });
    expect(() => repo.rename(row.id, "  ")).toThrowError(ChannelConfigError);
    expect(() => repo.rename(row.id, "x".repeat(65))).toThrowError(ChannelConfigError);
  });

  it("渠道不存在 → ChannelConfigError", () => {
    const { repo } = makeRepo();
    expect(() => repo.rename("no-such-id", "whatever")).toThrowError(ChannelConfigError);
  });
});

describe("ChannelRepository.updateCredentials 原子性（004-T002，SC-002）", () => {
  it("校验失败时原密文逐字节不变", () => {
    const { repo, db } = makeRepo();
    const row = repo.create({
      type: "feishu",
      name: "fs",
      credentials: {
        mode: "app",
        appId: "cli_a1b2c3d4e5f6",
        appSecret: "secret-1",
        receiveIdType: "chat_id",
        receiveId: "oc_target",
      },
    });
    const beforeBlob = rawBlob(db, "fs");
    expect(() =>
      repo.updateCredentials(row.id, {
        mode: "app",
        appId: "cli_a1b2c3d4e5f6",
        appSecret: "secret-2",
        receiveIdType: "chat_id",
        receiveId: "",
      }),
    ).toThrowError(ChannelConfigError);
    expect(rawBlob(db, "fs")).toBe(beforeBlob);
    // 现有凭据仍可解密为旧值
    expect(repo.getCredentials(row.id)).toMatchObject({ appSecret: "secret-1" });
  });

  it("归一化整体替换：切换连接方式后旧方式字段被丢弃", () => {
    const { repo } = makeRepo();
    const row = repo.create({
      type: "feishu",
      name: "fs2",
      credentials: {
        mode: "app",
        appId: "cli_a1b2c3d4e5f6",
        appSecret: "secret-1",
        receiveIdType: "chat_id",
        receiveId: "oc_target",
      },
    });
    // 合并语义：merged = 旧凭据 + 新 webhookUrl + mode=webhook（模拟 CLI 合并产物）
    const merged = { ...repo.getCredentials(row.id), mode: "webhook", webhookUrl: OTHER_HOOK };
    repo.updateCredentials(row.id, merged);
    const creds = repo.getCredentials(row.id);
    expect(creds).toMatchObject({ mode: "webhook", webhookUrl: OTHER_HOOK });
    expect(creds.appId).toBeUndefined(); // 归一化丢弃旧方式残留
    expect(creds.appSecret).toBeUndefined();
  });

  it("渠道不存在 → ChannelConfigError", () => {
    const { repo } = makeRepo();
    expect(() => repo.updateCredentials("no-such-id", { webhookUrl: WEBHOOK })).toThrowError(
      ChannelConfigError,
    );
  });
});
