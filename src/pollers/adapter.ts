/**
 * AgentStatusAdapter 统一接口（T049，research.md R5）：
 * 覆盖"多智能体、演进快"的最小抽象——读取 → 解析 → 返回任务列表及各自状态。
 * 无法读取状态时抛 AgentStatusError（FR-002 场景 3 明确报错，不静默）。
 */
export class AgentStatusError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AgentStatusError";
  }
}

export type AgentTaskStatus =
  | "running"
  | "completed"
  | "failed"
  | "interrupted"
  | "unknown";

/** 结束态（触发通知的状态）。 */
export const FINISHED_STATUSES: readonly AgentTaskStatus[] = [
  "completed",
  "failed",
  "interrupted",
];

export interface AgentTask {
  /** 任务/会话标识（来源侧提供）。 */
  taskId: string;
  status: AgentTaskStatus;
  /** 观察到的结束时间（缺省由管线取接收时间）。 */
  finishedAt?: Date;
  /** 结束概要（进入 resultSummary 前会经敏感过滤）。 */
  summary?: string;
}

export interface AgentStatusAdapter {
  /** 适配器注册名（如 claude-code / generic-file）。 */
  readonly name: string;
  /** 事件 source_agent 命名空间（如 claude-code / generic:my-agent）。 */
  readonly sourceAgent: string;
  readTasks(): Promise<AgentTask[]>;
}

/** 结束态 → 事件 result 枚举映射。 */
export function toResultStatus(status: AgentTaskStatus): "success" | "failure" | "interrupted" {
  switch (status) {
    case "completed":
      return "success";
    case "failed":
      return "failure";
    case "interrupted":
      return "interrupted";
    default:
      return "interrupted";
  }
}
