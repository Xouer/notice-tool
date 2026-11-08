import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";

/**
 * 转录上下文提取（009/010）：
 * 支持两种实测格式——
 * 1. JSONL 格式（CLI/早期会话）：每行一条记录（custom-title/ai-title/summary/message）。
 * 2. CodeBuddyIDE 目录格式：transcript_path 指向 index.json（仅含消息索引），
 *    消息实体在同级 messages/<id>.json，且 message/extra 为字符串化 JSON。
 * 提取：标题（title）、首条用户消息（firstUserMessage）、任务结论（conclusion）。
 * 均不可得时对应字段为 undefined，由调用方回退到兜底。
 */
const TITLE_MAX = 100;
const SUMMARY_MAX = 500;

/** 从标题类记录中提取候选文本（兼容多种字段名）。 */
function recordTitle(record: Record<string, unknown>): string | undefined {
  for (const key of ["title", "topic", "name", "text"]) {
    const value = record[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }
  const content = record.content;
  if (Array.isArray(content)) {
    for (const item of content) {
      if (item === null || typeof item !== "object") continue;
      const it = item as Record<string, unknown>;
      const text = it.text ?? it.content;
      if (typeof text === "string" && text.trim().length > 0) {
        return text.trim();
      }
    }
  }
  return undefined;
}

/** 提取首条真实用户消息（跳过系统提醒/命令等元消息）。 */
function firstUserMessage(record: Record<string, unknown>): string | undefined {
  if (record.type !== "message" || record.role !== "user") return undefined;
  const content = record.content;
  if (!Array.isArray(content)) return undefined;
  for (const item of content) {
    if (item === null || typeof item !== "object") continue;
    const it = item as Record<string, unknown>;
    if (it.type !== "input_text" && it.type !== "text") continue;
    const text = it.text;
    if (typeof text !== "string") continue;
    const trimmed = text.trim();
    // 跳过以 < 开头的系统注入（<system-reminder>、<command-name> 等）
    if (trimmed.length === 0 || trimmed.startsWith("<")) continue;
    return trimmed;
  }
  return undefined;
}

/** 提取 assistant 回复的可见文本（仅 output_text，忽略 reasoning/工具调用）。 */
function outputText(record: Record<string, unknown>): string | undefined {
  const content = record.content;
  if (!Array.isArray(content)) return undefined;
  for (const item of content) {
    if (item === null || typeof item !== "object") continue;
    const it = item as Record<string, unknown>;
    if (it.type !== "output_text") continue;
    const text = it.text;
    if (typeof text === "string" && text.trim().length > 0) {
      return text.trim();
    }
  }
  return undefined;
}

/** 单字段文本提取（非空字符串）。 */
function fieldText(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  if (typeof value === "string" && value.trim().length > 0) {
    return value.trim();
  }
  return undefined;
}

/** 安全二次解析字符串化 JSON；非法返回 undefined。 */
function parseNested(value: unknown): Record<string, unknown> | undefined {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  if (typeof value !== "string" || value.trim().length === 0) return undefined;
  try {
    const parsed: unknown = JSON.parse(value);
    if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // 非 JSON 字符串
  }
  return undefined;
}

/** 转录上下文：用于识别任务的可读信息（均可能缺失）。 */
export interface TranscriptContext {
  /** 任务标题：来源标题 → 首条用户消息。 */
  title?: string;
  /** 首条真实用户消息（任务目标）。 */
  firstUserMessage?: string;
  /** 任务结论：最后一条 assistant 回复的可见文本。 */
  conclusion?: string;
}

function isEmptyContext(ctx: TranscriptContext): boolean {
  return (
    ctx.title === undefined && ctx.firstUserMessage === undefined && ctx.conclusion === undefined
  );
}

/** 入口：先按 JSONL 解析；无结果时尝试 CodeBuddyIDE 目录格式。 */
export function readTranscriptContext(transcriptPath: string): TranscriptContext {
  const jsonl = readJsonlContext(transcriptPath);
  if (!isEmptyContext(jsonl)) return jsonl;
  return readIdeContext(transcriptPath);
}

/** JSONL 格式（CLI/早期会话）解析。 */
function readJsonlContext(transcriptPath: string): TranscriptContext {
  let text: string;
  try {
    text = readFileSync(transcriptPath, "utf8");
  } catch {
    return {};
  }

  let lastCustomTitle: string | undefined;
  let lastAiTitle: string | undefined;
  let lastTopic: string | undefined;
  let lastSummary: string | undefined;
  let firstUser: string | undefined;
  let conclusion: string | undefined;

  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (line.length === 0) continue;
    let record: Record<string, unknown>;
    try {
      record = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }
    const type = record.type;
    if (type === "custom-title") {
      const t = recordTitle(record);
      if (t !== undefined) lastCustomTitle = t;
    } else if (type === "ai-title") {
      // 010 实测：AI 标题存于 aiTitle 字段（兼容旧 title/text 形态）
      const t = fieldText(record, "aiTitle") ?? recordTitle(record);
      if (t !== undefined) lastAiTitle = t;
    } else if (type === "topic") {
      const t = recordTitle(record);
      if (t !== undefined) lastTopic = t;
    } else if (type === "summary") {
      // 010 实测：首条用户消息存于 summary 字段（initial-user-message）
      const t = fieldText(record, "summary");
      if (t === undefined) continue;
      lastSummary = t;
      if (firstUser === undefined) {
        const provider = record.providerData;
        const source =
          provider !== null && typeof provider === "object"
            ? (provider as Record<string, unknown>).source
            : undefined;
        if (source === "initial-user-message") firstUser = t;
      }
    } else if (type === "message" && record.role === "user" && firstUser === undefined) {
      firstUser = firstUserMessage(record);
    } else if (type === "message" && record.role === "assistant") {
      // 010：结论 = 最后一条完整（非 incomplete）assistant 回复的可见文本
      const t = outputText(record);
      if (t !== undefined && record.status !== "incomplete") conclusion = t;
    }
  }

  const title = lastCustomTitle ?? lastAiTitle ?? lastTopic ?? lastSummary ?? firstUser;
  return {
    title: title?.slice(0, TITLE_MAX),
    firstUserMessage: firstUser,
    conclusion: conclusion?.slice(0, SUMMARY_MAX),
  };
}

/** 取 content 数组中最后一个指定类型块的文本。 */
function lastContentText(content: unknown, blockType: string): string | undefined {
  if (!Array.isArray(content)) return undefined;
  for (let i = content.length - 1; i >= 0; i -= 1) {
    const item = content[i];
    if (item === null || typeof item !== "object") continue;
    const it = item as Record<string, unknown>;
    if (it.type !== blockType) continue;
    const text = it.text;
    if (typeof text === "string" && text.trim().length > 0) {
      return text.trim();
    }
  }
  return undefined;
}

/**
 * CodeBuddyIDE 目录格式（010 实测）解析：
 * - index.json：{ messages: [{id, role, isComplete}], requests: [...] }（无内容）
 * - messages/<id>.json：{ role, message: "<字符串化 JSON>", extra?: "<字符串化 JSON>" }
 * - 用户原始输入优先取 extra.inputPhrase[].content（不含系统注入），
 *   否则取 message.content 中不以 < 开头的 text 块；
 * - 结论取最后一条 assistant 消息 content 中最后一个 text 块（忽略 reasoning）。
 */
function readIdeContext(transcriptPath: string): TranscriptContext {
  let indexRaw: string;
  try {
    indexRaw = readFileSync(transcriptPath, "utf8");
  } catch {
    return {};
  }
  let index: unknown;
  try {
    index = JSON.parse(indexRaw);
  } catch {
    return {};
  }
  if (index === null || typeof index !== "object" || Array.isArray(index)) return {};
  const entries = (index as Record<string, unknown>).messages;
  if (!Array.isArray(entries)) return {};

  const messagesDir = join(dirname(transcriptPath), "messages");
  let firstUser: string | undefined;
  let conclusion: string | undefined;

  for (const entryItem of entries) {
    if (entryItem === null || typeof entryItem !== "object") continue;
    const meta = entryItem as Record<string, unknown>;
    const id = meta.id;
    if (typeof id !== "string" || id.trim().length === 0) continue;
    // 防路径穿越：id 应为十六进制/UUID 形态
    if (/[\\/:*?"<>|]/.test(id) || id.includes("..")) continue;

    let entryRaw: string;
    try {
      entryRaw = readFileSync(join(messagesDir, `${id}.json`), "utf8");
    } catch {
      continue;
    }
    let entry: unknown;
    try {
      entry = JSON.parse(entryRaw);
    } catch {
      continue;
    }
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) continue;
    const record = entry as Record<string, unknown>;
    const role = record.role ?? meta.role;
    const body = parseNested(record.message);
    const content = body?.content;

    if (role === "user" && firstUser === undefined) {
      // 优先 extra.inputPhrase（用户原始输入，无系统注入）
      const extra = parseNested(record.extra);
      const phrases = extra?.inputPhrase;
      if (Array.isArray(phrases)) {
        for (const phrase of phrases) {
          if (phrase === null || typeof phrase !== "object") continue;
          const p = phrase as Record<string, unknown>;
          const text = p.content ?? p.expandContent;
          if (typeof text === "string" && text.trim().length > 0) {
            firstUser = text.trim();
            break;
          }
        }
      }
      if (firstUser === undefined) {
        const t = lastContentText(content, "text");
        if (t !== undefined && !t.startsWith("<")) firstUser = t;
      }
    } else if (role === "assistant") {
      const t = lastContentText(content, "text");
      if (t !== undefined) conclusion = t;
    }
  }

  return {
    title: firstUser?.slice(0, TITLE_MAX),
    firstUserMessage: firstUser,
    conclusion: conclusion?.slice(0, SUMMARY_MAX),
  };
}

/** 兼容 009 调用方：仅提取标题。 */
export function readTranscriptTitle(transcriptPath: string): string | undefined {
  return readTranscriptContext(transcriptPath).title;
}
