import { readFileSync } from "node:fs";

/**
 * CodeBuddy/Claude 转录文件标题提取（009-US1 补充）：
 * 从 transcript_path 指向的 JSONL 转录中提取任务标题。
 * 标题来源优先级（deja-vu/codebuddy-history-viewer 实测格式）：
 *   最新 custom-title → 最新 ai-title → 最新 topic → 首条用户消息。
 * 均不可得时返回 undefined，由调用方回退到 taskId 前 6 位兜底。
 */
const TITLE_MAX = 100;

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

/** 读取转录文件并提取标题；文件不可读/无标题返回 undefined。 */
export function readTranscriptTitle(transcriptPath: string): string | undefined {
  let text: string;
  try {
    text = readFileSync(transcriptPath, "utf8");
  } catch {
    return undefined;
  }

  let lastCustomTitle: string | undefined;
  let lastAiTitle: string | undefined;
  let lastTopic: string | undefined;
  let firstUser: string | undefined;

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
      const t = recordTitle(record);
      if (t !== undefined) lastAiTitle = t;
    } else if (type === "topic") {
      const t = recordTitle(record);
      if (t !== undefined) lastTopic = t;
    } else if (type === "message" && firstUser === undefined) {
      firstUser = firstUserMessage(record);
    }
  }

  const title = lastCustomTitle ?? lastAiTitle ?? lastTopic ?? firstUser;
  if (title === undefined) return undefined;
  return title.slice(0, TITLE_MAX);
}
