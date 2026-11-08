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
  /** 实例采用的模板版本（FR-014）；未记录时为空。 */
  templateVersion: string | null;
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
  /**
   * 自定义内容：undefined = 保留原值；null = 清除；对象 = 写入。
   * 用于满足 FR-014（升级/重复操作不得静默清空用户自定义内容）。
   */
  customContent?: unknown | null;
  templateVersion?: string;
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

  /** 插入或更新（幂等）；未提供的字段保留原值（FR-014）。 */
  upsert(input: HookTemplateInstanceInput): HookTemplateInstanceRow {
    const now = new Date();
    const existing = this.get(input.templateId);
    if (existing === undefined) {
      this.#db
        .insert(hookTemplateInstances)
        .values({
          templateId: input.templateId,
          platform: input.platform,
          agent: input.agent,
          enabled: input.enabled ?? false,
          customContent: serializeCustomContent(input.customContent),
          templateVersion: input.templateVersion ?? null,
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
        .set({
          enabled: input.enabled ?? existing.enabled,
          customContent:
            input.customContent === undefined
              ? existing.customContent === null
                ? null
                : JSON.stringify(existing.customContent)
              : serializeCustomContent(input.customContent),
          templateVersion: input.templateVersion ?? existing.templateVersion,
          updatedAt: now,
        })
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
      templateVersion: row.templateVersion,
      lastValidationStatus: row.lastValidationStatus,
      lastValidationMessage: row.lastValidationMessage,
      lastValidationAt: row.lastValidationAt,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}

/** undefined/null → null；对象 → JSON 字符串。 */
function serializeCustomContent(value: unknown | null | undefined): string | null {
  if (value === undefined || value === null) return null;
  return JSON.stringify(value);
}
