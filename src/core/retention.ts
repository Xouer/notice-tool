import { inArray, lt } from "drizzle-orm";
import { notificationRecords, taskEvents } from "../storage/schema.js";
import type { NoticeDatabase } from "../storage/db.js";

/**
 * 保留清理（T059，data-model.md 保留与维护）：
 * - 通知历史（task_events / notification_records）超 retentionDays 清理
 * - 模板与渠道配置不自动清理
 * - 幂等：重复执行零删除
 */
export interface RetentionResult {
  eventsDeleted: number;
  recordsDeleted: number;
}

export function purgeExpiredHistory(
  db: NoticeDatabase,
  retentionDays: number,
  now: Date = new Date(),
): RetentionResult {
  const cutoff = new Date(now.getTime() - retentionDays * 24 * 60 * 60 * 1000);

  // 1. 删除过期事件名下的全部通知记录（含较新的重试记录，维持 FK 一致）
  const expiredEventIds = db
    .select({ id: taskEvents.id })
    .from(taskEvents)
    .where(lt(taskEvents.receivedAt, cutoff))
    .all()
    .map((row) => row.id);

  let recordsDeleted = 0;
  if (expiredEventIds.length > 0) {
    recordsDeleted += db
      .delete(notificationRecords)
      .where(inArray(notificationRecords.eventId, expiredEventIds))
      .run().changes;
  }
  // 2. 删除本身已过期的记录（事件被更早清理后遗留的孤儿，防御性）
  recordsDeleted += db
    .delete(notificationRecords)
    .where(lt(notificationRecords.createdAt, cutoff))
    .run().changes;

  // 3. 删除过期事件
  const eventsDeleted = db
    .delete(taskEvents)
    .where(lt(taskEvents.receivedAt, cutoff))
    .run().changes;

  return { eventsDeleted, recordsDeleted };
}
