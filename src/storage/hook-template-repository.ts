import { eq } from "drizzle-orm";
import { hookTemplateInstances } from "./schema.js";
import type { NoticeDatabase } from "./db.js";
import type { HookAgent, HookPlatform, ValidationStatus } from "../hooks/types.js";

/**
 * 钩子模板实例仓储（006-T007）：
 * 稀疏存储——仅用户采用过的模板存在实例；内置模板定义静态，未实例化即"不启动"。
 */

export interface HookTemplateInstanceRow {
  templateId: string;
  platform: HookPlatform;
  agent: HookAgent;
  enabled: boolean;
  customContent: unknown | null;
  lastValidationStatus: ValidationStatus;
  lastValidationMessage: string | null;
  lastValidationAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface HookTemplateInstanceInput {
  templateId: string;
  platform: HookPlatform;
  agent: HookAgent;
  enabled?: boolean;
  customContent?: unknown | null;
}

export class HookTemplateRepository {
  readonly #db: NoticeDatabase;

  constructor(db: NoticeDatabase) {
    this.#db = db;
  }

  list(): HookTemplateInstanceRow[] {
    return this.#db
      .select()
      .from(hookTemplateInstances)
      .all()
      .map((row) => this.#toRow(row as typeof hookTemplateInstances.$inferSelect));
  }

  get(templateId: string): HookTemplateInstanceRow | undefined {
    const row = this.#db
      .select()
      .from(hookTemplateInstances)
      .where(eq(hookTemplateInstances.templateId, templateId))
      .get() as typeof hookTemplateInstances.$inferSelect | undefined;
    return row === undefined ? undefined : this.#toRow(row);
  }

  /** 插入或更新（幂等）；未提供 enabled 时默认 false。 */
  upsert(input: HookTemplateInstanceInput): HookTemplateInstanceRow {
    const now = new Date();
    const existing = this.get(input.templateId);
    const enabled = input.enabled ?? false;
    const customContent =
      input.customContent === undefined || input.customContent === null
        ? null
        : JSON.stringify(input.customContent);
    if (existing === undefined) {
      this.#db
        .insert(hookTemplateInstances)
        .values({
          templateId: input.templateId,
          platform: input.platform,
          agent: input.agent,
          enabled,
          customContent,
          lastValidationStatus: "not_validated",
          lastValidationMessage: null,
          lastValidationAt: null,
          createdAt: now,
          updatedAt: now,
        })
        .run();
    } else {
      this.#db
        .update(hookTemplateInstances)
        .set({ enabled, customContent, updatedAt: now })
        .where(eq(hookTemplateInstances.templateId, input.templateId))
        .run();
    }
    return this.get(input.templateId)!;
  }

  setEnabled(templateId: string, enabled: boolean): void {
    this.#db
      .update(hookTemplateInstances)
      .set({ enabled, updatedAt: new Date() })
      .where(eq(hookTemplateInstances.templateId, templateId))
      .run();
  }

  /** 记录最近一次验证结果（失败时不得显示为可用，由 manager 保证）。 */
  setValidation(templateId: string, status: ValidationStatus, message: string | null): void {
    this.#db
      .update(hookTemplateInstances)
      .set({
        lastValidationStatus: status,
        lastValidationMessage: message,
        lastValidationAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(hookTemplateInstances.templateId, templateId))
      .run();
  }

  #toRow(row: typeof hookTemplateInstances.$inferSelect): HookTemplateInstanceRow {
    let customContent: unknown | null = null;
    if (row.customContent !== null && row.customContent !== undefined) {
      try {
        customContent = JSON.parse(row.customContent) as unknown;
      } catch {
        customContent = null;
      }
    }
    return {
      templateId: row.templateId,
      platform: row.platform,
      agent: row.agent,
      enabled: row.enabled,
      customContent,
      lastValidationStatus: row.lastValidationStatus,
      lastValidationMessage: row.lastValidationMessage,
      lastValidationAt: row.lastValidationAt,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
