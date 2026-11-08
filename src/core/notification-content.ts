import type { ResultStatus } from "../storage/schema.js";

/**
 * 通知内容纯函数（009-T002，research.md R1/R2/R3）：
 * 标题兜底、概要兜底、本地时间格式化——零依赖，均为可独立测试的纯函数。
 */

/** 本地时区、人类可读时间格式：`YYYY-MM-DD HH:mm:ss`（24 小时制）。 */
export function formatLocalDateTime(date: Date): string {
  const pad = (n: number): string => String(n).padStart(2, "0");
  const y = date.getFullYear();
  const m = pad(date.getMonth() + 1);
  const d = pad(date.getDate());
  const hh = pad(date.getHours());
  const mm = pad(date.getMinutes());
  const ss = pad(date.getSeconds());
  return `${y}-${m}-${d} ${hh}:${mm}:${ss}`;
}

/** 标题兜底：来源 + 任务标识前 6 字符，保证通知首行可识别、可区分。 */
export function titleFallback(sourceAgent: string, taskId: string): string {
  return `${sourceAgent} · ${taskId.slice(0, 6)}`;
}

/** 概要兜底：按结果状态返回有意义的本地化结论。 */
export function summaryFallback(resultStatus: ResultStatus): string {
  switch (resultStatus) {
    case "success":
      return "任务成功完成";
    case "failure":
      return "任务失败";
    case "interrupted":
      return "任务被中断";
    default:
      return "任务结束（结果未知）";
  }
}
