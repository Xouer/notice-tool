import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readTranscriptContext, readTranscriptTitle } from "../../src/core/transcript-title.js";

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
      JSON.stringify({
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: "帮我修 bug" }],
      }),
      JSON.stringify({ type: "custom-title", title: "修复登录页 bug" }),
    ]);
    expect(readTranscriptTitle(file)).toBe("修复登录页 bug");
  });

  it("custom-title 缺失时取 ai-title", () => {
    write([
      JSON.stringify({ type: "ai-title", text: "AI 标题" }),
      JSON.stringify({
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: "帮我修 bug" }],
      }),
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
      JSON.stringify({
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: "fix task：修复通知格式" }],
      }),
      JSON.stringify({
        type: "message",
        role: "assistant",
        content: [{ type: "output_text", text: "好的" }],
      }),
    ]);
    expect(readTranscriptTitle(file)).toBe("fix task：修复通知格式");
  });

  it("跳过以 < 开头的系统注入消息，取真实用户消息", () => {
    write([
      JSON.stringify({
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: "<system-reminder> 内部注入" }],
      }),
      JSON.stringify({
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: "真实用户问题" }],
      }),
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

/**
 * 010：转录上下文提取单元测试（Red 先行）。
 * 字段识别（aiTitle/summary）+ 结论提取（最后一条完整 assistant 的 output_text）。
 */
describe("transcript context / 转录上下文提取（010）", () => {
  let dir: string;
  let file: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "notice-transcript-context-"));
    file = join(dir, "session.jsonl");
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function write(lines: string[]): void {
    writeFileSync(file, lines.join("\n"), "utf8");
  }

  it("ai-title 记录取 aiTitle 字段", () => {
    write([JSON.stringify({ type: "ai-title", aiTitle: "AI 生成的标题" })]);
    expect(readTranscriptContext(file).title).toBe("AI 生成的标题");
  });

  it("summary 记录（initial-user-message）取 summary 字段", () => {
    write([
      JSON.stringify({
        type: "summary",
        summary: "帮我修复登录页样式",
        providerData: { source: "initial-user-message" },
      }),
    ]);
    const ctx = readTranscriptContext(file);
    expect(ctx.title).toBe("帮我修复登录页样式");
    expect(ctx.firstUserMessage).toBe("帮我修复登录页样式");
  });

  it("结论取最后一条完整 assistant 的 output_text", () => {
    write([
      JSON.stringify({
        type: "message",
        role: "assistant",
        content: [{ type: "output_text", text: "第一步完成" }],
        status: "complete",
      }),
      JSON.stringify({
        type: "message",
        role: "assistant",
        content: [{ type: "output_text", text: "任务最终结论" }],
        status: "complete",
      }),
    ]);
    expect(readTranscriptContext(file).conclusion).toBe("任务最终结论");
  });

  it("跳过 incomplete 的 assistant 消息（Interrupted by user）", () => {
    write([
      JSON.stringify({
        type: "message",
        role: "assistant",
        content: [{ type: "output_text", text: "真正的结论" }],
        status: "complete",
      }),
      JSON.stringify({
        type: "message",
        role: "assistant",
        content: [{ type: "output_text", text: "Interrupted by user" }],
        status: "incomplete",
      }),
    ]);
    expect(readTranscriptContext(file).conclusion).toBe("真正的结论");
  });

  it("reasoning 记录不作为结论，只取 output_text", () => {
    write([
      JSON.stringify({
        type: "reasoning",
        content: [{ type: "input_text", text: "思考过程不应展示" }],
      }),
      JSON.stringify({
        type: "message",
        role: "assistant",
        content: [{ type: "output_text", text: "可见结论" }],
        status: "complete",
      }),
    ]);
    expect(readTranscriptContext(file).conclusion).toBe("可见结论");
  });

  it("无任何可提取内容时各字段为 undefined", () => {
    write(["not-json-line"]);
    const ctx = readTranscriptContext(file);
    expect(ctx.title).toBeUndefined();
    expect(ctx.firstUserMessage).toBeUndefined();
    expect(ctx.conclusion).toBeUndefined();
  });

  // —— US1：标题兜底链（custom-title → aiTitle → summary → 首条消息） ——

  it("US1 标题优先级：custom-title 优先于 ai-title 与 summary", () => {
    write([
      JSON.stringify({ type: "custom-title", title: "手动标题" }),
      JSON.stringify({ type: "ai-title", aiTitle: "AI 标题" }),
      JSON.stringify({
        type: "summary",
        summary: "首条消息",
        providerData: { source: "initial-user-message" },
      }),
    ]);
    expect(readTranscriptContext(file).title).toBe("手动标题");
  });

  it("US1 标题优先级：ai-title 优先于 summary", () => {
    write([
      JSON.stringify({ type: "ai-title", aiTitle: "AI 标题" }),
      JSON.stringify({
        type: "summary",
        summary: "首条消息",
        providerData: { source: "initial-user-message" },
      }),
    ]);
    expect(readTranscriptContext(file).title).toBe("AI 标题");
  });

  it("US1 标题优先级：summary 优先于首条用户消息", () => {
    write([
      JSON.stringify({
        type: "summary",
        summary: "摘要标题",
        providerData: { source: "initial-user-message" },
      }),
      JSON.stringify({
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: "真实请求" }],
      }),
    ]);
    expect(readTranscriptContext(file).title).toBe("摘要标题");
  });

  it("US1 标题兜底：无任何标题来源时回退首条用户消息", () => {
    write([
      JSON.stringify({
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: "真实请求" }],
      }),
      JSON.stringify({
        type: "message",
        role: "assistant",
        content: [{ type: "output_text", text: "回复" }],
        status: "complete",
      }),
    ]);
    expect(readTranscriptContext(file).title).toBe("真实请求");
  });
});

/**
 * 010 修复：CodeBuddyIDE 目录格式（Stop 负载实测）。
 * transcript_path 指向 index.json（仅含消息索引），内容在 messages/<id>.json，
 * 且 message/extra 字段均为字符串化 JSON（需二次解析）。
 */
describe("CodeBuddyIDE transcript / IDE 目录格式（010 修复）", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "notice-ide-transcript-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function writeIdeSession(
    sessionId: string,
    messages: Array<{
      id: string;
      role: string;
      content: unknown;
      extra?: unknown;
      isComplete?: boolean;
    }>,
  ): string {
    const sessionDir = join(dir, sessionId);
    mkdirSync(join(sessionDir, "messages"), { recursive: true });
    const index = {
      messages: messages.map((m) => ({
        id: m.id,
        type: "text",
        role: m.role,
        isComplete: m.isComplete ?? true,
      })),
      requests: [],
    };
    writeFileSync(join(sessionDir, "index.json"), JSON.stringify(index), "utf8");
    for (const m of messages) {
      const entry: Record<string, unknown> = {
        role: m.role,
        message: JSON.stringify({ role: m.role, content: m.content }),
      };
      if (m.extra !== undefined) {
        entry.extra = JSON.stringify(m.extra);
      }
      writeFileSync(join(sessionDir, "messages", `${m.id}.json`), JSON.stringify(entry), "utf8");
    }
    return join(sessionDir, "index.json");
  }

  it("从 index.json + messages 提取首条用户消息与 assistant 结论", () => {
    const indexFile = writeIdeSession("sess-1", [
      {
        id: "m1",
        role: "user",
        content: [{ type: "text", text: "<user_info>系统注入...</user_query>帮我修复登录超时" }],
        extra: { inputPhrase: [{ type: "normal", content: "帮我修复登录超时" }] },
      },
      {
        id: "m2",
        role: "assistant",
        content: [
          { type: "reasoning", text: "思考过程不应展示" },
          { type: "text", text: "已修复超时问题" },
        ],
        isComplete: false,
      },
    ]);
    const ctx = readTranscriptContext(indexFile);
    expect(ctx.firstUserMessage).toBe("帮我修复登录超时");
    expect(ctx.title).toBe("帮我修复登录超时");
    expect(ctx.conclusion).toBe("已修复超时问题");
  });

  it("多条 assistant 消息时结论取最后一条", () => {
    const indexFile = writeIdeSession("sess-2", [
      { id: "u1", role: "user", content: [{ type: "text", text: "任务目标" }] },
      { id: "a1", role: "assistant", content: [{ type: "text", text: "中间步骤" }] },
      { id: "a2", role: "assistant", content: [{ type: "text", text: "最终结论" }] },
    ]);
    expect(readTranscriptContext(indexFile).conclusion).toBe("最终结论");
  });

  it("user 消息无 inputPhrase 且 content 为系统注入时提取为空", () => {
    const indexFile = writeIdeSession("sess-3", [
      {
        id: "u1",
        role: "user",
        content: [{ type: "text", text: "<system-reminder>内部注入" }],
        extra: {},
      },
    ]);
    const ctx = readTranscriptContext(indexFile);
    expect(ctx.firstUserMessage).toBeUndefined();
  });

  it("消息实体文件缺失时跳过该条不报错", () => {
    const sessionDir = join(dir, "sess-4");
    mkdirSync(join(sessionDir, "messages"), { recursive: true });
    writeFileSync(
      join(sessionDir, "index.json"),
      JSON.stringify({
        messages: [{ id: "ghost", type: "text", role: "user", isComplete: true }],
        requests: [],
      }),
      "utf8",
    );
    const ctx = readTranscriptContext(join(sessionDir, "index.json"));
    expect(ctx.firstUserMessage).toBeUndefined();
  });
});
