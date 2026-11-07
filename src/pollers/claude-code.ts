import { basename, join } from "node:path";
import { homedir } from "node:os";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import {
  AgentStatusError,
  type AgentStatusAdapter,
  type AgentTask,
  type AgentTaskStatus,
} from "./adapter.js";

/**
 * claude-code 会话巡查适配器（T050，research.md R5）：
 * 读取 ~/.claude/projects/ 下最新修改的会话 JSONL 尾部，
 * 依据 result 行判断会话是否到达结束态及具体状态。
 */
const SUBTYPE_STATUS: Record<string, AgentTaskStatus> = {
  success: "completed",
  error_during_execution: "failed",
  error_max_turns: "interrupted",
};

const DEFAULT_TAIL_BYTES = 64 * 1024;
const SUMMARY_MAX = 200;

export interface ClaudeCodeAdapterOptions {
  /** 会话根目录（缺省 ~/.claude/projects）。 */
  projectsDir?: string;
  tailBytes?: number;
}

export class ClaudeCodeAdapter implements AgentStatusAdapter {
  readonly name = "claude-code";
  readonly sourceAgent = "claude-code";
  readonly #projectsDir: string;
  readonly #tailBytes: number;

  constructor(options: ClaudeCodeAdapterOptions = {}) {
    this.#projectsDir = options.projectsDir ?? join(homedir(), ".claude", "projects");
    this.#tailBytes = options.tailBytes ?? DEFAULT_TAIL_BYTES;
  }

  async readTasks(): Promise<AgentTask[]> {
    const latest = this.#latestSessionFile();
    return this.#parseTail(latest);
  }

  #latestSessionFile(): string {
    if (!existsSync(this.#projectsDir)) {
      throw new AgentStatusError(`claude-code 会话目录不存在：${this.#projectsDir}`);
    }
    const files: string[] = [];
    let projects: string[];
    try {
      projects = readdirSync(this.#projectsDir, { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => join(this.#projectsDir, e.name));
    } catch (cause) {
      throw new AgentStatusError(
        `无法读取 claude-code 会话目录：${cause instanceof Error ? cause.message : String(cause)}`,
      );
    }
    for (const project of projects) {
      let entries;
      try {
        entries = readdirSync(project, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const entry of entries) {
        if (entry.isFile() && entry.name.endsWith(".jsonl")) {
          files.push(join(project, entry.name));
        }
      }
    }
    if (files.length === 0) {
      throw new AgentStatusError(`claude-code 会话目录中未找到会话文件：${this.#projectsDir}`);
    }
    files.sort((a, b) => {
      try {
        return statMtimeMs(b) - statMtimeMs(a);
      } catch {
        return 0;
      }
    });
    return files[0]!;
  }

  #parseTail(file: string): AgentTask[] {
    let tail: string;
    try {
      const buf = readFileSync(file);
      tail = buf.subarray(Math.max(0, buf.length - this.#tailBytes)).toString("utf8");
    } catch (cause) {
      throw new AgentStatusError(
        `无法读取会话文件 ${file}：${cause instanceof Error ? cause.message : String(cause)}`,
      );
    }
    const lines = tail.split("\n").map((l) => l.trim()).filter((l) => l.length > 0);
    if (lines.length === 0) {
      throw new AgentStatusError(`claude-code 会话文件为空：${file}`);
    }
    const fallbackTaskId = basename(file).replace(/\.jsonl$/i, "");
    const tasks: AgentTask[] = [];
    let parsedAny = false;
    for (const line of lines) {
      let obj: Record<string, unknown>;
      try {
        obj = JSON.parse(line) as Record<string, unknown>;
      } catch {
        continue; // 跳过截断/损坏行（尾部读取可能切在行中间）
      }
      parsedAny = true;
      if (obj.type !== "result") continue;
      const taskId =
        typeof obj.session_id === "string" && obj.session_id !== ""
          ? obj.session_id
          : fallbackTaskId;
      const status = SUBTYPE_STATUS[String(obj.subtype)] ?? "unknown";
      const finishedAt =
        typeof obj.timestamp === "string" && !Number.isNaN(Date.parse(obj.timestamp))
          ? new Date(obj.timestamp)
          : undefined;
      tasks.push({
        taskId,
        status,
        finishedAt,
        summary: typeof obj.result === "string" ? obj.result.slice(0, SUMMARY_MAX) : undefined,
      });
    }
    if (!parsedAny) {
      throw new AgentStatusError(`claude-code 会话文件无法解析：${file}`);
    }
    if (tasks.length > 0) {
      return tasks;
    }
    // 尾部无 result 行 → 会话仍在进行
    return [{ taskId: fallbackTaskId, status: "running" }];
  }
}

function statMtimeMs(file: string): number {
  return statSync(file).mtimeMs;
}
