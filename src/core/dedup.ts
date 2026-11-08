import { and, eq, gt, isNull } from "drizzle-orm";
import { taskEvents } from "../storage/schema.js";
import type { NoticeDatabase } from "../storage/db.js";

/**
 * 去重服务（T036，FR-007 / research.md R8）：
 * 冷却窗口查询式去重，走 (source_agent, task_id, received_at) 索引。
 * 不使用唯一约束硬去重（钩子与巡查观察到的结束时间存在偏差）。
 */
export interface DedupParams {
  sourceAgent: string;
  taskId: string;
  /** 008：可选稳定停止事件身份；有键走保留期判重，无键走旧冷却语义。 */
  eventKey?: string;
  /** 冷却窗口分钟数（默认 10，可配）。 */
  cooldownMinutes: number;
  now?: Date;
}

/** 判断是否为重复事件：稳定键按完整可见历史判重；旧无键沿用冷却窗口。 */
export function isDuplicateEvent(db: NoticeDatabase, params: DedupParams): boolean {
  if (params.eventKey !== undefined) {
    const hit = db
      .select({ id: taskEvents.id })
      .from(taskEvents)
      .where(
        and(
          eq(taskEvents.sourceAgent, params.sourceAgent),
          eq(taskEvents.taskId, params.taskId),
          eq(taskEvents.eventKey, params.eventKey),
        ),
      )
      .get();
    return hit !== undefined;
  }

  const now = params.now ?? new Date();
  const windowStart = new Date(now.getTime() - params.cooldownMinutes * 60_000);
  const hit = db
    .select({ id: taskEvents.id })
    .from(taskEvents)
    .where(
      and(
        eq(taskEvents.sourceAgent, params.sourceAgent),
        eq(taskEvents.taskId, params.taskId),
        isNull(taskEvents.eventKey),
        gt(taskEvents.receivedAt, windowStart),
      ),
    )
    .get();
  return hit !== undefined;
}
