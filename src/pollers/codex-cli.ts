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
 * Codex CLI 会话巡查适配器（005-US3，contracts/dialog-source-integration.md）：
 * 读取 ~/.codex/sessions/ 下最近修改的 rollout JSONL 尾部，
 * 依据 turn_complete 事件判断会话是否到达结束态及具体状态（research.md 待验证项 3 固化样本）。
 */
const DEFAULT_TAIL_BYTES = 64 * 1024;
const SUMMARY_MAX = 200;

interface CodexTailLine {
  timestamp?: unknown;
  type?: unknown;
  session_id?: unknown;
  payload?: {
    type?: unknown;
    status?: unknown;
    message?: unknown;
  };
}

export interface CodexCliAdapterOptions {
  /** 会话根目录（缺省 ~/.codex/sessions）。 */
  sessionsDir?: string;
  tailBytes?: number;
}

export class CodexCliAdapter implements AgentStatusAdapter {
  readonly name = "codex-cli";
  readonly sourceAgent = "codex-cli";
  readonly #sessionsDir: string;
  readonly #tailBytes: number;

  constructor(options: CodexCliAdapterOptions = {}) {
    this.#sessionsDir = options.sessionsDir ?? join(homedir(), ".codex", "sessions");
    this.#tailBytes = options.tailBytes ?? DEFAULT_TAIL_BYTES;
  }

  async readTasks(): Promise<AgentTask[]> {
    const latest = this.#latestSessionFile();
    return this.#parseTail(latest);
  }

  #latestSessionFile(): string {
    if (!existsSync(this.#sessionsDir)) {
      throw new AgentStatusError(`codex-cli 会话目录不存在：${this.#sessionsDir}`);
    }
    const files: string[] = [];
    const walk = (dir: string): void => {
      let entries;
      try {
        entries = readdirSync(dir, { withFileTypes: true });
      } catch {
        return; // 不可读子目录跳过，不中断整体扫描
      }
      for (const entry of entries) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
        } else if (entry.isFile() && entry.name.endsWith(".jsonl")) {
          files.push(full);
        }
      }
    };
    walk(this.#sessionsDir);
    if (files.length === 0) {
      throw new AgentStatusError(`codex-cli 会话目录中未找到会话文件：${this.#sessionsDir}`);
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
      throw new AgentStatusError(`codex-cli 会话文件为空：${file}`);
    }
    const fallbackTaskId = basename(file).replace(/\.jsonl$/i, "");
    let taskId = fallbackTaskId;
    let parsedAny = false;
    let lastSummary: string | undefined;
    let finished: { status: AgentTaskStatus; at?: Date } | undefined;
    for (const line of lines) {
      let obj: CodexTailLine;
      try {
        obj = JSON.parse(line) as CodexTailLine;
      } catch {
        continue; // 跳过截断/损坏行（尾部读取可能切在行中间）
      }
      if (typeof obj.session_id === "string" && obj.session_id !== "") {
        taskId = obj.session_id; // session_meta 提供会话标识
      }
      if (obj.type !== "event_msg" || obj.payload === undefined) continue;
      parsedAny = true;
      const payload = obj.payload;
      if (payload.type === "agent_message" && typeof payload.message === "string") {
        lastSummary = payload.message.slice(0, SUMMARY_MAX);
      }
      if (payload.type === "turn_complete") {
        const status: AgentTaskStatus = payload.status === "success" ? "completed" : "failed";
        const at =
          typeof obj.timestamp === "string" && !Number.isNaN(Date.parse(obj.timestamp))
            ? new Date(obj.timestamp)
            : undefined;
        finished = { status, at };
      }
    }
    if (!parsedAny) {
      throw new AgentStatusError(`codex-cli 会话文件无法解析：${file}`);
    }
    if (finished !== undefined) {
      return [
        {
          taskId,
          status: finished.status,
          finishedAt: finished.at,
          summary: lastSummary,
        },
      ];
    }
    // 尾部无 turn_complete → 会话仍在进行
    return [{ taskId, status: "running" }];
  }
}

function statMtimeMs(file: string): number {
  return statSync(file).mtimeMs;
}
