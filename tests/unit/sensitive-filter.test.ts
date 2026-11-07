import { describe, expect, it } from "vitest";
import { filterSensitiveSummary } from "../../src/core/sensitive-filter.js";

/**
 * T033：敏感内容过滤单元测试（Red 先行）。
 * resultSummary 敏感模式（密钥/令牌样式）过滤、长度 ≤500 截断、
 * raw_payload_ref 仅存脱敏摘要（contracts/hook-receiver.md + data-model.md）。
 */
describe("sensitive filter / 敏感内容过滤（T033）", () => {
  it("过滤 sk- 样式 API 密钥", () => {
    const out = filterSensitiveSummary("使用密钥 sk-proj-abc123def456ghi789 完成部署");
    expect(out).not.toContain("sk-proj-abc123def456ghi789");
    expect(out).toContain("[REDACTED]");
    expect(out).toContain("完成部署");
  });

  it("过滤 token=/key= 键值对中的值", () => {
    const out = filterSensitiveSummary("请求 https://x.example/cb?token=abcdef1234567890abcdef 已回调");
    expect(out).not.toContain("abcdef1234567890abcdef");
    expect(out).toContain("[REDACTED]");
  });

  it("过滤长十六进制串（疑似密钥/哈希）", () => {
    const hex = "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8";
    const out = filterSensitiveSummary(`签名 ${hex} 校验通过`);
    expect(out).not.toContain(hex);
  });

  it("普通文本原样保留", () => {
    const text = "修复了登录页样式问题（3 个文件）";
    expect(filterSensitiveSummary(text)).toBe(text);
  });

  it("长度 ≤500 截断", () => {
    const long = "结果 ".repeat(120); // 720 字符
    const out = filterSensitiveSummary(long);
    expect(out !== undefined && out.length <= 500).toBe(true);
  });

  it("空值返回 undefined", () => {
    expect(filterSensitiveSummary(undefined)).toBeUndefined();
    expect(filterSensitiveSummary("")).toBeUndefined();
  });
});
