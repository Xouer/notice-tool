import { describe, expect, it } from "vitest";
import {
  formatLocalDateTime,
  summaryFallback,
  titleFallback,
} from "../../src/core/notification-content.js";

/**
 * T001：通知内容纯函数单元测试（Red 先行，宪法 II）。
 * formatLocalDateTime（本地时区 YYYY-MM-DD HH:mm:ss）、titleFallback、
 * summaryFallback（四态结论）——data-model.md 渲染语义。
 */
describe("notification content pure functions / 通知内容纯函数（T001）", () => {
  it("formatLocalDateTime 输出本地时区 YYYY-MM-DD HH:mm:ss", () => {
    // 构造一个明确本地时间（避免依赖运行环境时区）：用本地 getter 直接构造
    const date = new Date(2026, 10, 8, 12, 15, 47); // 2026-11-08 12:15:47 本地
    expect(formatLocalDateTime(date)).toBe("2026-11-08 12:15:47");
  });

  it("formatLocalDateTime 对个位数月日时分秒补零", () => {
    const date = new Date(2026, 0, 5, 8, 3, 7); // 2026-01-05 08:03:07
    expect(formatLocalDateTime(date)).toBe("2026-01-05 08:03:07");
  });

  it("formatLocalDateTime 以本地时区渲染（与 toISOString 的 UTC 不同）", () => {
    // 用 UTC 语义构造时刻，本地渲染不应等于 UTC 字符串前缀
    const utcMidnight = new Date("2026-11-08T04:15:47.269Z");
    const local = formatLocalDateTime(utcMidnight);
    expect(local).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
    expect(local).not.toContain("T");
    expect(local).not.toContain("Z");
    // 非 UTC 时区下本地时间与 UTC 小时不同；无论如何不输出 ISO 形式
    expect(local).not.toBe("2026-11-08T04:15:47.269Z");
  });

  it("titleFallback 输出 source · taskId 前 6 字符", () => {
    expect(titleFallback("codebuddy", "0c489af57ca84e9599e46cf2da32a945")).toBe(
      "codebuddy · 0c489a",
    );
  });

  it("titleFallback 对短 taskId 截断不越界", () => {
    expect(titleFallback("demo", "abc")).toBe("demo · abc");
  });

  it("summaryFallback 四态映射", () => {
    expect(summaryFallback("success")).toBe("任务成功完成");
    expect(summaryFallback("failure")).toBe("任务失败");
    expect(summaryFallback("interrupted")).toBe("任务被中断");
    expect(summaryFallback("unknown")).toBe("任务结束（结果未知）");
  });
});
