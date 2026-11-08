import { createHash, randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import {
  taskEvents,
  RESULT_STATUSES,
  TRIGGER_TYPES,
  type ChannelType,
  type ErrorCode,
  type NotifyStatus,
  type RecordStatus,
  type ResultStatus,
  type TriggerType,
} from "../storage/schema.js";
import type { NoticeDatabase } from "../storage/db.js";
import type { ChannelRepository } from "../storage/channel-repository.js";
import type { TemplateRepository } from "../storage/template-repository.js";
import type { ChannelAdapter } from "../channels/adapter.js";
import { filterSensitiveSummary } from "./sensitive-filter.js";
import { isDuplicateEvent } from "./dedup.js";
import { dispatchEvent, type DispatchRecordResult } from "./dispatcher.js";
import type { PlaceholderValues } from "./template.js";

/**
 * 事件接入管线（T041，FR-007/FR-010）：校验 → 去重 → 落库 → 分发。
 * CLI/HTTP/MCP 三入口共用；落库前对 resultSummary 做敏感模式过滤，
 * raw_payload_ref 仅存脱敏摘要。
 */
export class EventValidationError extends Error {
  constructor(readonly details: string[]) {
    super(`负载校验失败：${details.join("；")}`);
    this.name = "EventValidationError";
  }
}

export interface NormalizedEvent {
  source: string;
  taskId: string;
  /** 008：可选稳定停止事件身份；无键时沿用旧冷却语义。 */
  eventKey?: string;
  finishedAt: Date;
  result: ResultStatus;
  resultSummary?: string;
  trigger: TriggerType;
}

export interface PipelineDeps {
  db: NoticeDatabase;
  channels: ChannelRepository;
  templates: TemplateRepository;
  getAdapter: (type: ChannelType) => ChannelAdapter;
  /** cooldownMinutes：去重冷却窗口；channels：指定通知渠道（名称/id），空/缺省 = 全部已启用渠道。 */
  config: { cooldownMinutes: number; channels?: string[] };
  dispatchOptions?: { maxAttempts?: number; retryDelayMs?: number };
}

export interface IngestResult {
  eventId: string;
  deduplicated: boolean;
  notifyStatus: NotifyStatus;
  records: DispatchRecordResult[];
  /** 人读提示（如"无可用渠道"）。 */
  message?: string;
}

function requireStringField(
  body: Record<string, unknown>,
  field: string,
  maxLength: number,
  errors: string[],
): string | undefined {
  const value = body[field];
  if (value === undefined || value === null) {
    errors.push(`缺少必填字段 ${field}`);
    return undefined;
  }
  if (typeof value !== "string" || value.trim().length === 0) {
    errors.push(`字段 ${field} 必须为非空字符串`);
    return undefined;
  }
  if (value.length > maxLength) {
    errors.push(`字段 ${field} 长度 ${value.length} 超过上限 ${maxLength}`);
    return undefined;
  }
  return value;
}

/** 负载校验（contracts/hook-receiver.md）：任何非法字段整体拒绝，不猜测、不部分接受。 */
export function validateEventPayload(
  input: unknown,
  defaultTrigger: TriggerType = "hook",
): NormalizedEvent {
  const errors: string[] = [];
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    throw new EventValidationError(["负载必须为 JSON 对象"]);
  }
  const body = input as Record<string, unknown>;

  const schemaVersion = body.schemaVersion;
  if (schemaVersion === undefined || schemaVersion === null) {
    errors.push("缺少必填字段 schemaVersion");
  } else if (!Number.isInteger(schemaVersion)) {
    errors.push("字段 schemaVersion 必须为整数");
  } else if (schemaVersion !== 1) {
    errors.push(
      `不支持的 schemaVersion: ${String(schemaVersion)}（当前支持 1；新增字段为可选演进）`,
    );
  }

  const source = requireStringField(body, "source", 64, errors);
  const taskId = requireStringField(body, "taskId", 256, errors);

  let eventKey: string | undefined;
  if (body.eventKey !== undefined && body.eventKey !== null) {
    if (typeof body.eventKey !== "string" || body.eventKey.trim().length === 0) {
      errors.push("字段 eventKey 必须为非空字符串");
    } else if (body.eventKey.length > 512) {
      errors.push(`字段 eventKey 长度 ${body.eventKey.length} 超过上限 512`);
    } else {
      eventKey = `sha256:${createHash("sha256").update(body.eventKey).digest("hex")}`;
    }
  }

  let finishedAt = new Date();
  if (body.finishedAt !== undefined && body.finishedAt !== null) {
    if (typeof body.finishedAt !== "string" || Number.isNaN(Date.parse(body.finishedAt))) {
      errors.push("字段 finishedAt 必须为 ISO 8601 时间字符串");
    } else {
      finishedAt = new Date(body.finishedAt);
    }
  }

  let result: ResultStatus = "unknown";
  if (body.result !== undefined && body.result !== null) {
    if (
      typeof body.result !== "string" ||
      !(RESULT_STATUSES as readonly string[]).includes(body.result)
    ) {
      errors.push(`字段 result 必须为 ${RESULT_STATUSES.join("/")} 之一`);
    } else {
      result = body.result as ResultStatus;
    }
  }

  let resultSummary: string | undefined;
  if (body.resultSummary !== undefined && body.resultSummary !== null) {
    if (typeof body.resultSummary !== "string") {
      errors.push("字段 resultSummary 必须为字符串");
    } else if (body.resultSummary.length > 500) {
      errors.push(`字段 resultSummary 长度 ${body.resultSummary.length} 超过上限 500`);
    } else {
      resultSummary = body.resultSummary;
    }
  }

  let trigger = defaultTrigger;
  if (body.trigger !== undefined && body.trigger !== null) {
    if (
      typeof body.trigger !== "string" ||
      !(TRIGGER_TYPES as readonly string[]).includes(body.trigger)
    ) {
      errors.push(`字段 trigger 必须为 ${TRIGGER_TYPES.join("/")} 之一`);
    } else {
      trigger = body.trigger as TriggerType;
    }
  }

  if (errors.length > 0) {
    throw new EventValidationError(errors);
  }
  return {
    source: source!,
    taskId: taskId!,
    eventKey,
    finishedAt,
    result,
    resultSummary,
    trigger,
  };
}

/**
 * 统一接入管线：
 * 1. 校验 → 2. 敏感过滤 → 3. 去重（命中仅记录不通知）→ 4. 落库 → 5. 分发
 */
export async function ingestTaskEndEvent(
  deps: PipelineDeps,
  payload: unknown,
  options: { trigger?: TriggerType; send?: boolean } = {},
): Promise<IngestResult> {
  const event = validateEventPayload(payload, options.trigger ?? "hook");
  const sanitizedSummary = filterSensitiveSummary(event.resultSummary);

  // 判重与首次写入在同一同步事务内，避免并发重复投递都通过先查再插。
  let deduplicated = false;
  let eventId = "";
  let receivedAt = new Date();
  deps.db.$client.transaction(() => {
    const isDuplicate = isDuplicateEvent(deps.db, {
      sourceAgent: event.source,
      taskId: event.taskId,
      eventKey: event.eventKey,
      cooldownMinutes: deps.config.cooldownMinutes,
    });
    receivedAt = new Date();
    if (isDuplicate) {
      deduplicated = true;
      eventId = randomUUID();
      deps.db
        .insert(taskEvents)
        .values({
          id: eventId,
          sourceAgent: event.source,
          taskId: event.taskId,
          eventKey: event.eventKey,
          finishedAt: event.finishedAt,
          resultStatus: event.result,
          triggerType: event.trigger,
          rawPayloadRef: sanitizedSummary,
          receivedAt,
          notifyStatus: "duplicated",
        })
        .run();
      return;
    }
    eventId = randomUUID();
    deps.db
      .insert(taskEvents)
      .values({
        id: eventId,
        sourceAgent: event.source,
        taskId: event.taskId,
        eventKey: event.eventKey,
        finishedAt: event.finishedAt,
        resultStatus: event.result,
        triggerType: event.trigger,
        rawPayloadRef: sanitizedSummary,
        receivedAt,
        notifyStatus: "received",
      })
      .run();
  })();

  if (deduplicated) {
    return {
      eventId: eventId!,
      deduplicated: true,
      notifyStatus: "duplicated",
      records: [],
    };
  }

  if (options.send === false) {
    return { eventId: eventId!, deduplicated: false, notifyStatus: "received", records: [] };
  }

  // 分发
  const values: PlaceholderValues = {
    task_id: event.taskId,
    source_agent: event.source,
    result_status: event.result,
    finished_at: event.finishedAt.toISOString(),
    result_summary: sanitizedSummary ?? "",
  };
  const records = await dispatchEvent({
    db: deps.db,
    channels: deps.channels,
    templates: deps.templates,
    getAdapter: deps.getAdapter,
    eventId,
    values,
    channelNames:
      deps.config.channels !== undefined && deps.config.channels.length > 0
        ? deps.config.channels
        : undefined,
    maxAttempts: deps.dispatchOptions?.maxAttempts,
    retryDelayMs: deps.dispatchOptions?.retryDelayMs,
  });

  let notifyStatus: NotifyStatus = "received";
  let message: string | undefined;
  if (records.length > 0) {
    notifyStatus = "dispatched";
  } else {
    message = "有事件但无可用渠道：未产生通知记录（请先 `notice channel add` 配置并启用渠道）";
  }
  if (notifyStatus !== "received") {
    deps.db.update(taskEvents).set({ notifyStatus }).where(eq(taskEvents.id, eventId)).run();
  }
  return { eventId, deduplicated: false, notifyStatus, records, message };
}

/** 记录结果展开为简表（CLI 输出用）。 */
export function summarizeRecords(
  records: DispatchRecordResult[],
): Array<{ recordId: string; channelId: string; status: RecordStatus; errorCode?: ErrorCode }> {
  return records.map(({ recordId, channelId, status, errorCode }) => ({
    recordId,
    channelId,
    status,
    errorCode,
  }));
}
