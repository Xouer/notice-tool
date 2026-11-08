import { randomUUID } from "node:crypto";
import pRetry from "p-retry";
import { eq } from "drizzle-orm";
import { notificationRecords, type ChannelType, type ErrorCode, type RecordStatus } from "../storage/schema.js";
import type { NoticeDatabase } from "../storage/db.js";
import type { ChannelRepository } from "../storage/channel-repository.js";
import type { TemplateRepository } from "../storage/template-repository.js";
import type { ChannelAdapter, SendPayload } from "../channels/adapter.js";
import { renderTemplate, type PlaceholderValues } from "./template.js";

/**
 * 通知分发器（T038）：
 * 每已启用渠道创建 pending 记录 → 渲染默认模板 → 发送（p-retry 退避重试）
 * → 更新 sent/retrying/failed；错误码脱敏分类（FR-003/FR-008）。
 * 单渠道失败不阻断其他渠道（data-model.md 校验规则）。
 */
export interface DispatchRecordResult {
  recordId: string;
  channelId: string;
  channelName: string;
  status: RecordStatus;
  errorCode?: ErrorCode;
  attempts: number;
}

export interface DispatchDeps {
  db: NoticeDatabase;
  channels: ChannelRepository;
  templates: TemplateRepository;
  getAdapter: (type: ChannelType) => ChannelAdapter;
  eventId: string;
  values: PlaceholderValues;
  /** 限定渠道类型（MCP send_notification 指定 channels 时使用）。 */
  channelTypes?: ChannelType[];
  /**
   * 限定渠道名称或 id（config.notify.channels 指定时使用）。
   * 未指定 = 全部已启用渠道；指定后仅向命中且启用的渠道分发。
   */
  channelNames?: string[];
  /** 直接指定发送内容（跳过模板渲染，MCP 即时通知用）。 */
  customMessage?: string;
  maxAttempts?: number;
  retryDelayMs?: number;
}

class SendAttemptFailure extends Error {
  constructor(
    readonly errorCode: ErrorCode,
    message: string,
  ) {
    super(message);
  }
}

/** 渲染单条记录的发送内容（渠道默认模板 → 通用默认 → 纯文本兜底）。 */
export function renderForChannel(
  templates: TemplateRepository,
  channelType: ChannelType,
  values: PlaceholderValues,
): { templateId: string | null; message: string } {
  const tpl = templates.findDefault(channelType);
  if (tpl !== undefined) {
    return { templateId: tpl.id, message: renderTemplate(tpl.body, values) };
  }
  return {
    templateId: null,
    message:
      `【任务完成通知】\n` +
      `标题：${values.title}\n` +
      `任务 ${values.task_id}（${values.source_agent}）已结束\n` +
      `结果：${values.result_status}\n` +
      `结束时间：${values.finished_at}\n` +
      `概要：${values.result_summary}`,
  };
}

/** 对单个事件执行分发：遍历已启用渠道，逐渠道独立发送与记录。 */
export async function dispatchEvent(deps: DispatchDeps): Promise<DispatchRecordResult[]> {
  const maxAttempts = deps.maxAttempts ?? 3;
  const retryDelayMs = deps.retryDelayMs ?? 1000;
  const results: DispatchRecordResult[] = [];

  for (const channel of deps.channels
    .list()
    .filter(
      (c) =>
        c.enabled &&
        (deps.channelTypes === undefined || deps.channelTypes.includes(c.type)) &&
        (deps.channelNames === undefined ||
          deps.channelNames.includes(c.name) ||
          deps.channelNames.includes(c.id)),
    )) {
    const custom = deps.customMessage;
    const { templateId, message } =
      custom !== undefined
        ? { templateId: null, message: custom }
        : renderForChannel(deps.templates, channel.type, deps.values);
    const recordId = randomUUID();
    const now = new Date();
    deps.db
      .insert(notificationRecords)
      .values({
        id: recordId,
        eventId: deps.eventId,
        channelId: channel.id,
        templateId,
        status: "pending",
        attempts: 0,
        createdAt: now,
        updatedAt: now,
      })
      .run();

    const updateRecord = (patch: {
      status: RecordStatus;
      attempts: number;
      lastErrorCode?: ErrorCode;
    }): void => {
      deps.db
        .update(notificationRecords)
        .set({ ...patch, updatedAt: new Date() })
        .where(eq(notificationRecords.id, recordId))
        .run();
    };

    let attempts = 0;
    try {
      const credentials = deps.channels.getCredentials(channel.id);
      const adapter = deps.getAdapter(channel.type);
      const payload: SendPayload = { message };
      await pRetry(
        async () => {
          attempts += 1;
          updateRecord({ status: attempts > 1 ? "retrying" : "pending", attempts });
          const outcome = await adapter.send(payload, credentials);
          if (!outcome.ok) {
            throw new SendAttemptFailure(outcome.errorCode, outcome.message);
          }
        },
        { retries: Math.max(0, maxAttempts - 1), minTimeout: retryDelayMs, maxTimeout: retryDelayMs },
      );
      updateRecord({ status: "sent", attempts });
      results.push({ recordId, channelId: channel.id, channelName: channel.name, status: "sent", attempts });
    } catch (cause) {
      const errorCode =
        cause instanceof SendAttemptFailure ? cause.errorCode : ("UNKNOWN" as ErrorCode);
      updateRecord({ status: "failed", attempts, lastErrorCode: errorCode });
      results.push({
        recordId,
        channelId: channel.id,
        channelName: channel.name,
        status: "failed",
        errorCode,
        attempts,
      });
    }
  }
  return results;
}
