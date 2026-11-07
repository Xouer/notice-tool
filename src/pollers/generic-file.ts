import { basename } from "node:path";
import { readFileSync } from "node:fs";
import { AgentStatusError, type AgentStatusAdapter, type AgentTask } from "./adapter.js";

/**
 * generic-file 通用文件巡查适配器（T051，research.md R5）：
 * 用户配置"状态文件路径 + 完成特征正则"的通用模板——
 * 命中 → completed（摘要为首个匹配行）；未命中 → running；文件不可读 → 明确报错。
 */
export interface GenericFileAdapterOptions {
  path: string;
  completionPattern: string;
  /** 事件命名空间（sourceAgent = generic:<sourceName>，缺省取文件基名）。 */
  sourceName?: string;
}

export class GenericFileAdapter implements AgentStatusAdapter {
  readonly name = "generic-file";
  readonly sourceAgent: string;
  readonly #path: string;
  readonly #pattern: RegExp;

  constructor(options: GenericFileAdapterOptions) {
    try {
      this.#pattern = new RegExp(options.completionPattern);
    } catch {
      throw new AgentStatusError(
        `generic-file 完成特征正则不合法：${options.completionPattern}`,
      );
    }
    this.#path = options.path;
    this.sourceAgent = `generic:${options.sourceName ?? basename(options.path)}`;
  }

  async readTasks(): Promise<AgentTask[]> {
    let content: string;
    try {
      content = readFileSync(this.#path, "utf8");
    } catch {
      throw new AgentStatusError(`无法读取状态文件：${this.#path}`);
    }
    const taskId = basename(this.#path);
    const matchedLine = content
      .split(/\r?\n/)
      .find((line) => this.#pattern.test(line));
    if (matchedLine !== undefined) {
      return [
        {
          taskId,
          status: "completed",
          summary: matchedLine.trim().slice(0, 200),
        },
      ];
    }
    return [{ taskId, status: "running" }];
  }
}
