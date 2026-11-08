import { eq } from "drizzle-orm";
import pRetry from "p-retry";
import type { Command } from "commander";
import {
  notificationRecords,
  taskEvents,
  notificationChannels,
  NOTIFY_STATUSES,
  RECORD_STATUSES,
  type ErrorCode,
  type NotifyStatus,
  type RecordStatus,
  type ResultStatus,
  type TriggerType,
} from "../storage/schema.js";
import { renderTemplate } from "../core/template.js";
import {
  formatLocalDateTime,
  summaryFallback,
  titleFallback,
} from "../core/notification-content.js";
import { getAdapter } from "../channels/index.js";
import { CliFailure } from "./cli-failure.js";
import type { OpenedStore, CliContext } from "./index.js";

/**
 * 通知历史 CLI（T045，FR-008/FR-011）：
 * history [--limit N] [--status <status>]；history resend <recordId>。
 * 输出无明文凭据；resend 将 failed 记录重置 pending 并立即重发（更新原记录）。
 */
export function registerHistoryCommands(
  parent: Command,
  makeContext: () => CliContext,
  openStore: (ctx: CliContext) => OpenedStore,
): void {
  const history = parent.command("history").description("查看通知历史（--limit/--status 过滤）");

  // events 使用独立内部选项名；根入口把公开的 --limit/--status 映射过来，
  // 避免与父命令同名选项在 Commander 中冲突。
  history
    .command("events")
    .description("查看任务结束事件历史（received/duplicated/dispatched）")
    .option("--events-limit <n>", "返回条数（默认 20；公开参数 --limit 由根入口映射）", "20")
    .option("--events-status <status>", "按事件状态过滤（公开参数 --status 由根入口映射）")
    .action((opts: { eventsLimit: string; eventsStatus?: string }) => {
      const ctx = makeContext();
      const limit = Number(opts.eventsLimit);
      if (!Number.isInteger(limit) || limit < 1) {
        throw new CliFailure("--limit 必须为正整数", 2);
      }
      if (
        opts.eventsStatus !== undefined &&
        !(NOTIFY_STATUSES as readonly string[]).includes(opts.eventsStatus)
      ) {
        throw new CliFailure(`--status 必须为 ${NOTIFY_STATUSES.join("|")} 之一`, 2);
      }
      const store = openStore(ctx);
      try {
        const events = listEventHistory(
          store,
          limit,
          opts.eventsStatus as NotifyStatus | undefined,
        );
        if (ctx.json) {
          ctx.out(`${JSON.stringify({ events }, null, 2)}\n`);
        } else if (events.length === 0) {
          ctx.out("暂无事件记录。\n");
        } else {
          for (const event of events) {
            ctx.out(
              `${event.id.slice(0, 8)}\t${event.source}\t${event.taskId}\t${event.eventKeySummary}\t${event.trigger}\t${event.status}\t${event.receivedAt}\n`,
            );
          }
        }
      } finally {
        store.close();
      }
    });

  history
    .option("--limit <n>", "返回条数（默认 20）", "20")
    .option("--status <status>", "按状态过滤：pending|sent|retrying|failed")
    .action((opts: { limit: string; status?: string }) => {
      const ctx = makeContext();
      const limit = Number(opts.limit);
      if (!Number.isInteger(limit) || limit < 1) {
        throw new CliFailure("--limit 必须为正整数", 2);
      }
      if (
        opts.status !== undefined &&
        !(RECORD_STATUSES as readonly string[]).includes(opts.status)
      ) {
        throw new CliFailure(`--status 必须为 ${RECORD_STATUSES.join("|")} 之一`, 2);
      }
      const store = openStore(ctx);
      try {
        const rows = listHistory(store, limit, opts.status as RecordStatus | undefined);
        if (ctx.json) {
          ctx.out(`${JSON.stringify({ records: rows }, null, 2)}\n`);
        } else if (rows.length === 0) {
          ctx.out("暂无通知记录。\n");
        } else {
          for (const row of rows) {
            ctx.out(
              `${row.id.slice(0, 8)}\t${row.event.taskId}\t${row.channel ?? "(已删除渠道)"}\t${row.status}${row.lastErrorCode ? ` [${row.lastErrorCode}]` : ""}\t${row.attempts} 次\t${row.updatedAt}\n`,
            );
          }
        }
      } finally {
        store.close();
      }
    });

  history
    .command("resend")
    .description("手动重发失败记录（重置 pending 并立即重发）")
    .argument("<recordId>", "通知记录 ID")
    .action(async (recordId: string) => {
      const ctx = makeContext();
      const store = openStore(ctx);
      try {
        const outcome = await resendRecord(store, recordId);
        if (outcome === undefined) {
          throw new CliFailure(`未找到通知记录：${recordId}`, 2);
        }
        if (outcome.status === "sent") {
          ctx.out(
            ctx.json
              ? `${JSON.stringify({ recordId, status: "sent" })}\n`
              : `重发成功：${recordId.slice(0, 8)}（状态已更新为 sent）\n`,
          );
        } else {
          throw new CliFailure(
            `重发失败 [${outcome.errorCode ?? "UNKNOWN"}]（状态保持 failed，可修正渠道凭据后再次重发）`,
            1,
          );
        }
      } finally {
        store.close();
      }
    });
}

interface HistoryRow {
  id: string;
  event: { source: string; taskId: string };
  channel: string | null;
  status: RecordStatus;
  lastErrorCode?: string;
  attempts: number;
  updatedAt: string;
}

interface EventHistoryRow {
  id: string;
  source: string;
  taskId: string;
  eventKeySummary: string;
  trigger: TriggerType;
  result: ResultStatus;
  status: NotifyStatus;
  receivedAt: string;
  finishedAt: string;
}

function eventKeySummary(eventKey: string | null): string {
  if (eventKey === null || eventKey === "") return "(无)";
  return eventKey.length > 12 ? `${eventKey.slice(0, 12)}…` : eventKey;
}

function listEventHistory(
  store: OpenedStore,
  limit: number,
  status?: NotifyStatus,
): EventHistoryRow[] {
  return store.db
    .select()
    .from(taskEvents)
    .all()
    .filter((event) => status === undefined || event.notifyStatus === status)
    .sort((a, b) => b.receivedAt.getTime() - a.receivedAt.getTime())
    .slice(0, limit)
    .map((event) => ({
      id: event.id,
      source: event.sourceAgent,
      taskId: event.taskId,
      eventKeySummary: eventKeySummary(event.eventKey),
      trigger: event.triggerType,
      result: event.resultStatus,
      status: event.notifyStatus,
      receivedAt: event.receivedAt.toISOString(),
      finishedAt: event.finishedAt.toISOString(),
    }));
}

function listHistory(store: OpenedStore, limit: number, status?: RecordStatus): HistoryRow[] {
  const all = store.db
    .select({
      id: notificationRecords.id,
      status: notificationRecords.status,
      lastErrorCode: notificationRecords.lastErrorCode,
      attempts: notificationRecords.attempts,
      updatedAt: notificationRecords.updatedAt,
      channelName: notificationChannels.name,
      source: taskEvents.sourceAgent,
      taskId: taskEvents.taskId,
    })
    .from(notificationRecords)
    .leftJoin(taskEvents, eq(notificationRecords.eventId, taskEvents.id))
    .leftJoin(notificationChannels, eq(notificationRecords.channelId, notificationChannels.id))
    .all();
  return all
    .filter((r) => status === undefined || r.status === status)
    .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
    .slice(0, limit)
    .map((r) => ({
      id: r.id,
      event: { source: r.source ?? "(未知)", taskId: r.taskId ?? "(未知)" },
      channel: r.channelName ?? null,
      status: r.status,
      lastErrorCode: r.lastErrorCode ?? undefined,
      attempts: r.attempts,
      updatedAt: r.updatedAt.toISOString(),
    }));
}

const SEND_FAILURE_PREFIX = "__send_failure__:";

/** 重发单条记录：failed → pending → 立即按其模板与渠道重发（更新原记录）。 */
async function resendRecord(
  store: OpenedStore,
  recordId: string,
): Promise<{ status: RecordStatus; errorCode?: string } | undefined> {
  const record = store.db
    .select()
    .from(notificationRecords)
    .where(eq(notificationRecords.id, recordId))
    .get();
  if (record === undefined) {
    return undefined;
  }
  if (record.channelId === null) {
    throw new CliFailure("该记录的渠道已被删除，无法重发", 2);
  }
  if (record.status !== "failed") {
    throw new CliFailure(`仅 failed 记录可重发（当前状态：${record.status}）`, 2);
  }
  const channel = store.repo.get(record.channelId);
  const event = store.db.select().from(taskEvents).where(eq(taskEvents.id, record.eventId)).get();
  if (channel === undefined || event === undefined) {
    throw new CliFailure("记录关联的渠道或事件已不存在", 3);
  }
  const template = record.templateId !== null ? store.templates.get(record.templateId) : undefined;
  const tpl = template ?? store.templates.findDefault(channel.type);
  const values = {
    title: titleFallback(event.sourceAgent, event.taskId),
    task_id: event.taskId,
    source_agent: event.sourceAgent,
    result_status: event.resultStatus,
    finished_at: formatLocalDateTime(event.finishedAt),
    result_summary: event.rawPayloadRef ?? summaryFallback(event.resultStatus),
  };
  const message =
    tpl !== undefined
      ? renderTemplate(tpl.body, values)
      : `【任务完成通知】\n标题：${values.title}\n任务 ${event.taskId}（${event.sourceAgent}）已结束\n结果：${event.resultStatus}\n结束时间：${values.finished_at}\n概要：${values.result_summary}`;

  const patchRecord = (patch: {
    status: RecordStatus;
    attempts: number;
    lastErrorCode?: ErrorCode;
  }): void => {
    store.db
      .update(notificationRecords)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(notificationRecords.id, recordId))
      .run();
  };

  // failed → pending（FR-008 手动重发状态迁移）
  patchRecord({ status: "pending", attempts: 0 });

  const maxAttempts = 3;
  const retryDelayMs = 500;
  const credentials = store.repo.getCredentials(channel.id); // 仅发送瞬间解密
  const adapter = getAdapter(channel.type);
  let attempts = 0;
  try {
    await pRetry(
      async () => {
        attempts += 1;
        patchRecord({ status: attempts > 1 ? "retrying" : "pending", attempts });
        const outcome = await adapter.send({ message }, credentials);
        if (!outcome.ok) {
          throw new Error(`${SEND_FAILURE_PREFIX}${outcome.errorCode}:${outcome.message}`);
        }
      },
      { retries: maxAttempts - 1, minTimeout: retryDelayMs, maxTimeout: retryDelayMs },
    );
    patchRecord({ status: "sent", attempts });
    return { status: "sent" };
  } catch (cause) {
    const raw = cause instanceof Error ? cause.message : "";
    const errorCode: ErrorCode = raw.startsWith(SEND_FAILURE_PREFIX)
      ? ((raw.slice(SEND_FAILURE_PREFIX.length).split(":")[0] ?? "UNKNOWN") as ErrorCode)
      : "UNKNOWN";
    patchRecord({ status: "failed", attempts, lastErrorCode: errorCode });
    return { status: "failed", errorCode };
  }
}
