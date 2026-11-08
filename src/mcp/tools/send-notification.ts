import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import {
  taskEvents,
  CHANNEL_TYPES,
  type ChannelType,
  type ErrorCode,
} from "../../storage/schema.js";
import type { NoticeDatabase } from "../../storage/db.js";
import type { ChannelRepository } from "../../storage/channel-repository.js";
import type { TemplateRepository } from "../../storage/template-repository.js";
import type { ChannelAdapter } from "../../channels/adapter.js";
import { dispatchEvent } from "../../core/dispatcher.js";
import { filterSensitiveSummary } from "../../core/sensitive-filter.js";
import { formatLocalDateTime } from "../../core/notification-content.js";

/**
 * send_notification 工具实现（T056，contracts/mcp-tools.md）：
 * 即时通知（不关联真实任务事件）；缺省发送全部已启用渠道，channels 可过滤；
 * 复用分发器（重试/记录/错误分类一致）；输出 delivered/failed 逐渠道结果。
 */
export class McpToolValidationError extends Error {
  constructor(readonly details: string[]) {
    super(`VALIDATION_FAILED: ${details.join("；")}`);
    this.name = "McpToolValidationError";
  }
}

export interface SendNotificationParams {
  schemaVersion?: unknown;
  title?: unknown;
  message?: unknown;
  channels?: unknown;
}

export interface SendNotificationDeps {
  db: NoticeDatabase;
  channels: ChannelRepository;
  templates: TemplateRepository;
  getAdapter: (type: ChannelType) => ChannelAdapter;
  dispatchOptions?: { maxAttempts?: number; retryDelayMs?: number };
}

export interface SendNotificationResult {
  delivered: string[];
  failed: Array<{ channel: string; errorCode: ErrorCode }>;
}

/** 入参校验（手动执行，保证契约错误码而非传输层默认错误）。 */
export function validateSendNotificationParams(
  params: SendNotificationParams,
): { title?: string; message: string; channels?: ChannelType[] } {
  const errors: string[] = [];
  if (params.schemaVersion !== 1) {
    errors.push("schemaVersion 必须为 1");
  }
  if (typeof params.message !== "string" || params.message.trim().length === 0) {
    errors.push("message 必须为非空字符串");
  } else if (params.message.length > 2000) {
    errors.push(`message 长度 ${params.message.length} 超过上限 2000`);
  }
  let title: string | undefined;
  if (params.title !== undefined && params.title !== null) {
    if (typeof params.title !== "string" || params.title.length > 100) {
      errors.push("title 必须为 ≤100 字符的字符串");
    } else {
      title = params.title;
    }
  }
  let channels: ChannelType[] | undefined;
  if (params.channels !== undefined && params.channels !== null) {
    if (
      !Array.isArray(params.channels) ||
      params.channels.some((c) => !(CHANNEL_TYPES as readonly string[]).includes(c as string))
    ) {
      errors.push(`channels 必须为 ${CHANNEL_TYPES.join("/")} 组成的数组`);
    } else {
      channels = params.channels as ChannelType[];
    }
  }
  if (errors.length > 0) {
    throw new McpToolValidationError(errors);
  }
  return { title, message: params.message as string, channels };
}

export async function sendNotificationImmediate(
  deps: SendNotificationDeps,
  params: SendNotificationParams,
): Promise<SendNotificationResult> {
  const validated = validateSendNotificationParams(params);
  const now = new Date();
  const message = validated.title !== undefined
    ? `${validated.title}\n${validated.message}`
    : validated.message;

  // 合成事件以承载通知记录（历史可追溯，FR-011）；不参与任务去重语义
  const eventId = randomUUID();
  deps.db
    .insert(taskEvents)
    .values({
      id: eventId,
      sourceAgent: "mcp",
      taskId: `immediate-${randomUUID().slice(0, 8)}`,
      finishedAt: now,
      resultStatus: "unknown",
      triggerType: "mcp",
      rawPayloadRef: filterSensitiveSummary(message),
      receivedAt: now,
      notifyStatus: "received",
    })
    .run();

  const results = await dispatchEvent({
    db: deps.db,
    channels: deps.channels,
    templates: deps.templates,
    getAdapter: deps.getAdapter,
    eventId,
    values: {
      title: validated.title ?? "即时通知",
      task_id: "即时通知",
      source_agent: "mcp",
      result_status: "unknown",
      finished_at: formatLocalDateTime(now),
      result_summary: validated.message,
    },
    channelTypes: validated.channels,
    customMessage: message,
    maxAttempts: deps.dispatchOptions?.maxAttempts,
    retryDelayMs: deps.dispatchOptions?.retryDelayMs,
  });

  if (results.length > 0) {
    deps.db
      .update(taskEvents)
      .set({ notifyStatus: "dispatched" })
      .where(eq(taskEvents.id, eventId))
      .run();
  }

  return {
    delivered: results.filter((r) => r.status === "sent").map((r) => r.channelName),
    failed: results
      .filter((r) => r.status === "failed")
      .map((r) => ({ channel: r.channelName, errorCode: r.errorCode ?? "UNKNOWN" })),
  };
}
