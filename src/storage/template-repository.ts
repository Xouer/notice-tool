import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import {
  notificationRecords,
  notificationTemplates,
  CHANNEL_TYPES,
  type ChannelType,
} from "./schema.js";
import type { NoticeDatabase } from "./db.js";
import { TemplateError, validateTemplateBody } from "../core/template.js";
import { BuiltinTemplateError } from "./seed.js";

/**
 * 模板仓储（T039，data-model.md 通知模板实体 / FR-009）：
 * CRUD + 保存校验（白名单占位符、≤2000、默认唯一、内置不可删）。
 */
export interface TemplateRow {
  id: string;
  name: string;
  channelType: ChannelType | null;
  body: string;
  isDefault: boolean;
  isBuiltin: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export class TemplateRepository {
  readonly #db: NoticeDatabase;

  constructor(db: NoticeDatabase) {
    this.#db = db;
  }

  list(): TemplateRow[] {
    return this.#db
      .select()
      .from(notificationTemplates)
      .all()
      .map((row) => this.#toRow(row as typeof notificationTemplates.$inferSelect));
  }

  get(id: string): TemplateRow | undefined {
    const row = this.#db
      .select()
      .from(notificationTemplates)
      .where(eq(notificationTemplates.id, id))
      .get() as typeof notificationTemplates.$inferSelect | undefined;
    return row === undefined ? undefined : this.#toRow(row);
  }

  findByName(name: string): TemplateRow | undefined {
    return this.list().find((row) => row.name === name);
  }

  /** 指定渠道类型的默认模板（每渠道至多一个）。 */
  getDefaultForChannel(type: ChannelType): TemplateRow | undefined {
    return this.list().find((row) => row.channelType === type && row.isDefault);
  }

  /** 通用默认模板（channel_type 为空）。 */
  getGenericDefault(): TemplateRow | undefined {
    return this.list().find((row) => row.channelType === null && row.isDefault);
  }

  create(input: {
    name: string;
    channelType?: string | null;
    body: string;
  }): TemplateRow {
    const name = input.name?.trim() ?? "";
    if (name.length === 0 || name.length > 64) {
      throw new TemplateError("模板名称非空且 ≤ 64 字符");
    }
    let channelType: ChannelType | null = null;
    if (input.channelType !== undefined && input.channelType !== null) {
      if (!(CHANNEL_TYPES as readonly string[]).includes(input.channelType)) {
        throw new TemplateError(
          `channel_type 必须为 ${CHANNEL_TYPES.join("/")} 之一`,
        );
      }
      channelType = input.channelType as ChannelType;
    }
    validateTemplateBody(input.body);
    const now = new Date();
    const id = randomUUID();
    try {
      this.#db
        .insert(notificationTemplates)
        .values({
          id,
          name,
          channelType,
          body: input.body,
          isDefault: false, // 默认态经 setDefault 显式设置（保证互斥）
          isBuiltin: false,
          createdAt: now,
          updatedAt: now,
        })
        .run();
    } catch (cause) {
      if (cause instanceof Error && cause.message.includes("UNIQUE")) {
        throw new TemplateError(`模板名称已存在：${name}`);
      }
      throw cause;
    }
    return this.get(id)!;
  }

  /** 更新正文（内置模板允许编辑正文，不允许删除）。 */
  updateBody(id: string, body: string): TemplateRow {
    const row = this.get(id);
    if (row === undefined) {
      throw new TemplateError("模板不存在");
    }
    validateTemplateBody(body);
    this.#db
      .update(notificationTemplates)
      .set({ body, updatedAt: new Date() })
      .where(eq(notificationTemplates.id, id))
      .run();
    return this.get(id)!;
  }

  /** 设为默认：清除同渠道（或通用）其他默认，保证每渠道至多一个。 */
  setDefault(id: string): void {
    const row = this.get(id);
    if (row === undefined) {
      throw new TemplateError("模板不存在");
    }
    const now = new Date();
    if (row.channelType === null) {
      // 通用默认互斥（NULL 不被部分唯一索引覆盖，由仓储层保证）
      for (const other of this.list()) {
        if (other.channelType === null && other.id !== id && other.isDefault) {
          this.#db
            .update(notificationTemplates)
            .set({ isDefault: false, updatedAt: now })
            .where(eq(notificationTemplates.id, other.id))
            .run();
        }
      }
    } else {
      for (const other of this.list()) {
        if (other.channelType === row.channelType && other.id !== id && other.isDefault) {
          this.#db
            .update(notificationTemplates)
            .set({ isDefault: false, updatedAt: now })
            .where(eq(notificationTemplates.id, other.id))
            .run();
        }
      }
    }
    this.#db
      .update(notificationTemplates)
      .set({ isDefault: true, updatedAt: now })
      .where(eq(notificationTemplates.id, id))
      .run();
  }

  /** 删除模板：内置模板不可删；历史记录 template_id 置空。 */
  remove(id: string): void {
    const row = this.get(id);
    if (row === undefined) {
      throw new TemplateError("模板不存在");
    }
    BuiltinTemplateError.assertDeletable(row.name);
    this.#db
      .update(notificationRecords)
      .set({ templateId: null, updatedAt: new Date() })
      .where(eq(notificationRecords.templateId, id))
      .run();
    this.#db
      .delete(notificationTemplates)
      .where(eq(notificationTemplates.id, id))
      .run();
  }

  /** 按渠道类型/通用匹配的默认模板（分发选模板用）。 */
  findDefault(channelType: ChannelType | null): TemplateRow | undefined {
    return channelType === null
      ? this.getGenericDefault()
      : (this.getDefaultForChannel(channelType) ?? this.getGenericDefault());
  }

  #toRow(row: typeof notificationTemplates.$inferSelect): TemplateRow {
    return {
      id: row.id,
      name: row.name,
      channelType: row.channelType,
      body: row.body,
      isDefault: row.isDefault,
      isBuiltin: row.isBuiltin,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
