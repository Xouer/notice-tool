import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import {
  notificationChannels,
  notificationRecords,
  type ChannelType,
} from "./schema.js";

import type { NoticeDatabase } from "./db.js";
import type { BlobCipher } from "./crypto.js";
import {
  ChannelConfigError,
  summarizeCredentials,
  validateChannelInput,
} from "../channels/channel-config.js";

/**
 * 渠道仓储（T019）：CRUD + 凭据经 BlobCipher 加解密 + 删除即物理清除。
 * - 凭据密文仅存 credentials_blob（data-model.md）
 * - 删除渠道：物理删除该行及密文；历史通知记录保留且 channel_id 置空（FR-011）
 * - 明文凭据仅在调用方发送瞬间经 getCredentials 解密获取
 */
export interface ChannelRow {
  id: string;
  type: ChannelType;
  name: string;
  enabled: boolean;
  /** 掩码摘要（绝不返回明文凭据）。 */
  credentialsSummary: string;
  createdAt: Date;
  updatedAt: Date;
}

export class ChannelRepository {
  readonly #db: NoticeDatabase;
  readonly #cipher: BlobCipher;

  constructor(db: NoticeDatabase, cipher: BlobCipher) {
    this.#db = db;
    this.#cipher = cipher;
  }

  create(input: {
    type: string;
    name: string;
    credentials: unknown;
  }): ChannelRow {
    const validated = validateChannelInput(input.type, input.name, input.credentials);
    const now = new Date();
    const id = randomUUID();
    try {
      this.#db
        .insert(notificationChannels)
        .values({
          id,
          type: validated.type,
          name: validated.name,
          credentialsBlob: this.#cipher.seal(JSON.stringify(validated.credentials)),
          enabled: false, // 默认未启用（data-model.md：测试发送成功前不允许可用）
          createdAt: now,
          updatedAt: now,
        })
        .run();
    } catch (cause) {
      if (cause instanceof Error && cause.message.includes("UNIQUE")) {
        throw new ChannelConfigError(
          `同名渠道已存在（同 type 内唯一）：${validated.name}（${validated.type}）`,
        );
      }
      throw cause;
    }
    return this.#toRow(
      this.#db
        .select()
        .from(notificationChannels)
        .where(eq(notificationChannels.id, id))
        .get()! as typeof notificationChannels.$inferSelect,
    );
  }

  list(): ChannelRow[] {
    return this.#db
      .select()
      .from(notificationChannels)
      .all()
      .map((row) => this.#toRow(row as typeof notificationChannels.$inferSelect));
  }

  get(id: string): ChannelRow | undefined {
    const row = this.#db
      .select()
      .from(notificationChannels)
      .where(eq(notificationChannels.id, id))
      .get() as typeof notificationChannels.$inferSelect | undefined;
    return row === undefined ? undefined : this.#toRow(row);
  }

  findByName(name: string): ChannelRow | undefined {
    return this.list().find((row) => row.name === name);
  }

  setEnabled(id: string, enabled: boolean): void {
    this.#db
      .update(notificationChannels)
      .set({ enabled, updatedAt: new Date() })
      .where(eq(notificationChannels.id, id))
      .run();
  }

  updateCredentials(id: string, credentials: unknown): ChannelRow {
    const row = this.#db
      .select()
      .from(notificationChannels)
      .where(eq(notificationChannels.id, id))
      .get() as typeof notificationChannels.$inferSelect | undefined;
    if (row === undefined) {
      throw new ChannelConfigError("渠道不存在");
    }
    const validated = validateChannelInput(row.type, row.name, credentials);
    this.#db
      .update(notificationChannels)
      .set({
        credentialsBlob: this.#cipher.seal(JSON.stringify(validated.credentials)),
        updatedAt: new Date(),
      })
      .where(eq(notificationChannels.id, id))
      .run();
    return this.get(id)!;
  }

  /** 解密凭据（仅发送瞬间使用；不得缓存/落日志）。 */
  getCredentials(id: string): Record<string, unknown> {
    const row = this.#db
      .select()
      .from(notificationChannels)
      .where(eq(notificationChannels.id, id))
      .get() as typeof notificationChannels.$inferSelect | undefined;
    if (row === undefined) {
      throw new ChannelConfigError("渠道不存在");
    }
    return JSON.parse(this.#cipher.unseal(row.credentialsBlob)) as Record<
      string,
      unknown
    >;
  }

  /** 删除渠道：先置空历史记录外键，再物理清除渠道行与凭据密文。 */
  remove(id: string): void {
    this.#db
      .update(notificationRecords)
      .set({ channelId: null, updatedAt: new Date() })
      .where(eq(notificationRecords.channelId, id))
      .run();
    this.#db
      .delete(notificationChannels)
      .where(eq(notificationChannels.id, id))
      .run();
  }

  #toRow(row: typeof notificationChannels.$inferSelect): ChannelRow {
    const credentials = JSON.parse(
      this.#cipher.unseal(row.credentialsBlob),
    ) as Record<string, unknown>;
    return {
      id: row.id,
      type: row.type,
      name: row.name,
      enabled: row.enabled,
      credentialsSummary: summarizeCredentials(row.type, credentials),
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
