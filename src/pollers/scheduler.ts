import {
  FINISHED_STATUSES,
  toResultStatus,
  type AgentStatusAdapter,
  type AgentTask,
  type AgentTaskStatus,
} from "./adapter.js";
import type { IngestResult } from "../core/event-pipeline.js";
import type { TriggerType } from "../storage/schema.js";

/**
 * 巡查调度器（T052）：
 * - 默认 10 秒可配间隔轮询适配器
 * - 状态迁移检测：非结束态 → 结束态才触发通知（内存态）
 * - 启动基线扫描：对冷却窗口内已结束的任务补发通知（依赖管线去重保证"仅一次"）
 * - 不可读状态经 onError 明确报错（FR-002 场景 3），不静默、不中断其他适配器
 */
export interface PollNotification {
  source: string;
  taskId: string;
  deduplicated: boolean;
  notified: number;
}

export interface SchedulerDeps {
  adapters: AgentStatusAdapter[];
  ingest: (payload: unknown, trigger: TriggerType) => Promise<IngestResult>;
  intervalMs?: number;
  cooldownMinutes?: number;
  onError?: (error: Error, adapterName: string) => void;
  onNotify?: (info: PollNotification) => void;
}

export class PollingScheduler {
  readonly #deps: SchedulerDeps;
  readonly #intervalMs: number;
  readonly #cooldownMinutes: number;
  readonly #state = new Map<string, AgentTaskStatus>();
  #timer: NodeJS.Timeout | undefined;

  constructor(deps: SchedulerDeps) {
    this.#deps = deps;
    this.#intervalMs = deps.intervalMs ?? 10_000;
    this.#cooldownMinutes = deps.cooldownMinutes ?? 10;
  }

  /** 单次扫描（测试与手动触发用）。返回本轮触发的通知摘要。 */
  async scanOnce(): Promise<PollNotification[]> {
    const notifications: PollNotification[] = [];
    for (const adapter of this.#deps.adapters) {
      let tasks: AgentTask[];
      try {
        tasks = await adapter.readTasks();
      } catch (cause) {
        this.#deps.onError?.(
          cause instanceof Error ? cause : new Error(String(cause)),
          adapter.name,
        );
        continue;
      }
      for (const task of tasks) {
        const notification = await this.#processTask(adapter, task);
        if (notification !== undefined) {
          notifications.push(notification);
        }
      }
    }
    return notifications;
  }

  /** 启动周期巡查（含一次立即扫描）。 */
  start(): void {
    this.#timer = setInterval(() => {
      void this.scanOnce().catch(() => {});
    }, this.#intervalMs);
    this.#timer.unref?.();
  }

  stop(): void {
    if (this.#timer !== undefined) {
      clearInterval(this.#timer);
      this.#timer = undefined;
    }
  }

  async #processTask(
    adapter: AgentStatusAdapter,
    task: AgentTask,
  ): Promise<PollNotification | undefined> {
    const key = `${adapter.name}:${task.taskId}`;
    const previous = this.#state.get(key);
    this.#state.set(key, task.status);

    const finished = FINISHED_STATUSES.includes(task.status);
    let shouldIngest = false;
    if (previous === undefined) {
      // 基线：仅补检冷却窗口内已结束的任务（spec 边界情况 2）
      if (finished) {
        const finishedAt = task.finishedAt ?? new Date();
        shouldIngest =
          Date.now() - finishedAt.getTime() <= this.#cooldownMinutes * 60_000;
      }
    } else if (finished && !FINISHED_STATUSES.includes(previous)) {
      shouldIngest = true; // 状态迁移：非结束态 → 结束态
    }
    if (!shouldIngest) {
      return undefined;
    }

    const payload: Record<string, unknown> = {
      schemaVersion: 1,
      source: adapter.sourceAgent,
      taskId: task.taskId,
      result: toResultStatus(task.status),
      trigger: "polling",
    };
    if (task.summary !== undefined && task.summary !== "") {
      payload.resultSummary = task.summary;
    }
    if (task.finishedAt !== undefined) {
      payload.finishedAt = task.finishedAt.toISOString();
    }
    try {
      const result = await this.#deps.ingest(payload, "polling");
      const notification: PollNotification = {
        source: adapter.sourceAgent,
        taskId: task.taskId,
        deduplicated: result.deduplicated,
        notified: result.records.filter((r) => r.status === "sent").length,
      };
      this.#deps.onNotify?.(notification);
      return notification;
    } catch (cause) {
      this.#deps.onError?.(
        cause instanceof Error ? cause : new Error(String(cause)),
        adapter.name,
      );
      return undefined;
    }
  }
}
