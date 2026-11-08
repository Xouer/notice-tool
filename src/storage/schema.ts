import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { HOOK_AGENTS, HOOK_PLATFORMS, VALIDATION_STATUSES } from "../hooks/types.js";

/**
 * 数据模型四实体（T012，data-model.md）：
 * notification_channels / task_events / notification_records / notification_templates
 *
 * 枚举、约束逐条对应 data-model.md；
 * 时间戳统一为毫秒整数（timestamp_ms）。
 */

export const CHANNEL_TYPES = ["feishu", "dingtalk", "email", "wechat", "qq"] as const;
export type ChannelType = (typeof CHANNEL_TYPES)[number];

export const RESULT_STATUSES = ["success", "failure", "interrupted", "unknown"] as const;
export type ResultStatus = (typeof RESULT_STATUSES)[number];

export const TRIGGER_TYPES = ["hook", "polling", "mcp"] as const;
export type TriggerType = (typeof TRIGGER_TYPES)[number];

/** task_events.notify_status 分发状态迁移：received → duplicated | dispatched（终态不可逆）。 */
export const NOTIFY_STATUSES = ["received", "duplicated", "dispatched"] as const;
export type NotifyStatus = (typeof NOTIFY_STATUSES)[number];

/** notification_records.status：pending → sent | retrying → sent | failed（failed 可手动重发回 pending）。 */
export const RECORD_STATUSES = ["pending", "sent", "retrying", "failed"] as const;
export type RecordStatus = (typeof RECORD_STATUSES)[number];

/** 渠道失败错误码分类（contracts/cli.md 错误码节）。 */
export const ERROR_CODES = [
  "AUTH_INVALID",
  "NETWORK_UNREACHABLE",
  "RATE_LIMITED_REMOTE",
  "CONTENT_REJECTED",
  "UNKNOWN",
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

/** 通知渠道配置 / Notification channels. */
export const notificationChannels = sqliteTable(
  "notification_channels",
  {
    id: text("id").primaryKey(),
    type: text("type", { enum: CHANNEL_TYPES }).notNull(),
    name: text("name").notNull(),
    /** 仅存密文（AES-256-GCM，密钥经 SecretStore 托管）。 */
    credentialsBlob: text("credentials_blob").notNull(),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(false),
    /** 渠道级限流参数（JSON，可空 = 用全局默认）。 */
    rateLimit: text("rate_limit"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    // name 同 type 内唯一
    uniqueIndex("uq_channels_type_name").on(table.type, table.name),
  ],
);

/** 任务结束事件 / Task completion events. */
export const taskEvents = sqliteTable(
  "task_events",
  {
    id: text("id").primaryKey(),
    sourceAgent: text("source_agent").notNull(),
    taskId: text("task_id").notNull(),
    /** 008：来源侧一次确定的停止事件身份；旧无键行保持 NULL。 */
    eventKey: text("event_key"),
    finishedAt: integer("finished_at", { mode: "timestamp_ms" }).notNull(),
    resultStatus: text("result_status", { enum: RESULT_STATUSES }).notNull(),
    triggerType: text("trigger_type", { enum: TRIGGER_TYPES }).notNull(),
    /** 原始负载摘要（脱敏后，可空）。 */
    rawPayloadRef: text("raw_payload_ref"),
    /** 系统接收时间（去重窗口基准）。 */
    receivedAt: integer("received_at", { mode: "timestamp_ms" }).notNull(),
    notifyStatus: text("notify_status", { enum: NOTIFY_STATUSES }).notNull(),
  },
  (table) => [
    // 旧无键调用的冷却窗口查询索引（research.md R8）
    index("idx_task_events_dedup").on(table.sourceAgent, table.taskId, table.receivedAt),
    // 008：Stop 级稳定事件键去重索引
    index("idx_task_events_event_key_dedup").on(
      table.sourceAgent,
      table.taskId,
      table.eventKey,
      table.receivedAt,
    ),
  ],
);

/** 通知模板 / Notification templates. */
export const notificationTemplates = sqliteTable(
  "notification_templates",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull().unique(),
    /** 可空 = 通用模板；非空时须为五类枚举之一。 */
    channelType: text("channel_type", { enum: CHANNEL_TYPES }),
    body: text("body").notNull(),
    /** 每渠道至多一个默认。 */
    isDefault: integer("is_default", { mode: "boolean" }).notNull().default(false),
    /** 实现级标记：产品内置模板不可删除（FR-009"默认模板随产品内置且不可删除"）。 */
    isBuiltin: integer("is_builtin", { mode: "boolean" }).notNull().default(false),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    // 每渠道至多一个默认（部分唯一索引；channel_type 为 NULL 的通用默认由仓储层保证）
    uniqueIndex("uq_templates_default_per_channel")
      .on(table.channelType)
      .where(sql`is_default = 1`),
  ],
);

/** 通知记录 / Notification records. */
export const notificationRecords = sqliteTable(
  "notification_records",
  {
    id: text("id").primaryKey(),
    eventId: text("event_id")
      .notNull()
      .references(() => taskEvents.id),
    /**
     * 渠道外键：新记录非空；删除渠道时历史记录保留并将 channel_id 置空
     * （data-model.md 关系章节"保留并置空"，满足 FR-011 历史可追溯）。
     */
    channelId: text("channel_id").references(() => notificationChannels.id),
    templateId: text("template_id").references(() => notificationTemplates.id),
    status: text("status", { enum: RECORD_STATUSES }).notNull(),
    attempts: integer("attempts").notNull().default(0),
    lastErrorCode: text("last_error_code", { enum: ERROR_CODES }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    index("idx_records_event").on(table.eventId),
    index("idx_records_status").on(table.status),
    index("idx_records_channel").on(table.channelId),
  ],
);

/**
 * 钩子模板实例（006，data-model.md HookTemplateInstance）：
 * 仅记录用户采用后的状态（稀疏）；内置模板定义静态不落库，未实例化即派生为"不启动"。
 * template_id 与 default-templates 的 `<platform>-<agent>` 一一对应。
 */
export const hookTemplateInstances = sqliteTable(
  "hook_template_instances",
  {
    templateId: text("template_id").primaryKey(),
    platform: text("platform", { enum: HOOK_PLATFORMS }).notNull(),
    agent: text("agent", { enum: HOOK_AGENTS }).notNull(),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(false),
    /** 用户确认后的自定义内容（JSON 字符串，可空）。 */
    customContent: text("custom_content"),
    /** 实例采用的模板版本（FR-014：升级时保留用户状态并提示变更）。 */
    templateVersion: text("template_version"),
    lastValidationStatus: text("last_validation_status", {
      enum: VALIDATION_STATUSES,
    })
      .notNull()
      .default("not_validated"),
    lastValidationMessage: text("last_validation_message"),
    lastValidationAt: integer("last_validation_at", { mode: "timestamp_ms" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [index("idx_hook_templates_agent").on(table.agent)],
);
