import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readTranscriptTitle } from "../../src/core/transcript-title.js";

/**
 * 009：转录标题提取单元测试（Red 先行）。
 * custom-title → ai-title → topic → 首条用户消息 优先级；不可读/无标题返回 undefined。
 */
describe("transcript title / 转录标题提取", () => {
  let dir: string;
  let file: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "notice-transcript-title-"));
    file = join(dir, "session.jsonl");
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function write(lines: string[]): void {
    writeFileSync(file, lines.join("\n"), "utf8");
  }

  it("优先取最新 custom-title", () => {
    write([
      JSON.stringify({ type: "message", role: "user", content: [{ type: "input_text", text: "帮我修 bug" }] }),
      JSON.stringify({ type: "custom-title", title: "修复登录页 bug" }),
    ]);
    expect(readTranscriptTitle(file)).toBe("修复登录页 bug");
  });

  it("custom-title 缺失时取 ai-title", () => {
    write([
      JSON.stringify({ type: "ai-title", text: "AI 标题" }),
      JSON.stringify({ type: "message", role: "user", content: [{ type: "input_text", text: "帮我修 bug" }] }),
    ]);
    expect(readTranscriptTitle(file)).toBe("AI 标题");
  });

  it("topic 为 last-wins，取最后一条", () => {
    write([
      JSON.stringify({ type: "topic", topic: "第一个标题" }),
      JSON.stringify({ type: "topic", topic: "最新标题" }),
    ]);
    expect(readTranscriptTitle(file)).toBe("最新标题");
  });

  it("无标题记录时回退到首条用户消息", () => {
    write([
      JSON.stringify({ type: "message", role: "user", content: [{ type: "input_text", text: "fix task：修复通知格式" }] }),
      JSON.stringify({ type: "message", role: "assistant", content: [{ type: "output_text", text: "好的" }] }),
    ]);
    expect(readTranscriptTitle(file)).toBe("fix task：修复通知格式");
  });

  it("跳过以 < 开头的系统注入消息，取真实用户消息", () => {
    write([
      JSON.stringify({ type: "message", role: "user", content: [{ type: "input_text", text: "<system-reminder> 内部注入" }] }),
      JSON.stringify({ type: "message", role: "user", content: [{ type: "input_text", text: "真实用户问题" }] }),
    ]);
    expect(readTranscriptTitle(file)).toBe("真实用户问题");
  });

  it("文件不存在或无法解析返回 undefined", () => {
    expect(readTranscriptTitle(join(dir, "missing.jsonl"))).toBeUndefined();
    write(["not-json-line"]);
    expect(readTranscriptTitle(file)).toBeUndefined();
  });

  it("超长标题截断至 100 字符", () => {
    write([JSON.stringify({ type: "custom-title", title: "长".repeat(200) })]);
    expect(readTranscriptTitle(file)?.length).toBe(100);
  });
});
