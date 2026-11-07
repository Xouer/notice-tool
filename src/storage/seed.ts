import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import {
  notificationTemplates,
  type ChannelType,
} from "./schema.js";
import type { NoticeDatabase } from "./db.js";

/**
 * 默认模板播种（T015，data-model.md 通知模板实体）：
 * 每渠道一个默认模板 + 一个通用默认模板；is_default 标记；
 * 重复执行幂等；内置模板不可删除（FR-009）。
 */

export class BuiltinTemplateError extends Error {
  constructor(name: string) {
    super(`内置模板不可删除：${name}`);
    this.name = "BuiltinTemplateError";
  }

  /** 删除守卫：内置模板名称抛错，其余放行。 */
  static assertDeletable(name: string): void {
    if (BUILT_IN_TEMPLATE_NAMES.has(name)) {
      throw new BuiltinTemplateError(name);
    }
  }
}

const DEFAULT_BODY = [
  "【任务完成通知】",
  "任务 {{task_id}}（来源 {{source_agent}}）已结束",
  "结果：{{result_status}}",
  "结束时间：{{finished_at}}",
  "概要：{{result_summary}}",
].join("\n");

interface BuiltInTemplateDef {
  name: string;
  channelType: ChannelType | null;
  body: string;
}

const CHANNEL_DEFAULTS: ReadonlyArray<{ name: string; channelType: ChannelType }> = [
  { name: "default-feishu", channelType: "feishu" },
  { name: "default-dingtalk", channelType: "dingtalk" },
  { name: "default-email", channelType: "email" },
  { name: "default-wechat", channelType: "wechat" },
  { name: "default-qq", channelType: "qq" },
];

/** 内置模板定义：一个通用 + 每渠道一个。 */
export const BUILT_IN_TEMPLATE_DEFS: readonly BuiltInTemplateDef[] = [
  { name: "default-generic", channelType: null, body: DEFAULT_BODY },
  ...CHANNEL_DEFAULTS.map(({ name, channelType }) => ({
    name,
    channelType,
    body: DEFAULT_BODY,
  })),
];

export const BUILT_IN_TEMPLATE_NAMES: ReadonlySet<string> = new Set(
  BUILT_IN_TEMPLATE_DEFS.map((def) => def.name),
);

/**
 * 播种默认模板（幂等）：
 * - 不存在则插入（is_default = true, is_builtin = true）
 * - 已存在则跳过——用户对默认模板的替换（set-default）与正文编辑不被覆盖
 */
export function seedDefaultTemplates(db: NoticeDatabase): void {
  const now = new Date();
  for (const def of BUILT_IN_TEMPLATE_DEFS) {
    const existing = db
      .select()
      .from(notificationTemplates)
      .where(eq(notificationTemplates.name, def.name))
      .get();
    if (existing === undefined) {
      db.insert(notificationTemplates)
        .values({
          id: randomUUID(),
          name: def.name,
          channelType: def.channelType,
          body: def.body,
          isDefault: true,
          isBuiltin: true,
          createdAt: now,
          updatedAt: now,
        })
        .run();
    }
  }
}
