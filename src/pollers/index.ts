import type { PollingAdapterConfig } from "../config/loader.js";
import { AgentStatusError, type AgentStatusAdapter } from "./adapter.js";
import { ClaudeCodeAdapter } from "./claude-code.js";
import { CodexCliAdapter } from "./codex-cli.js";
import { GenericFileAdapter } from "./generic-file.js";

/**
 * 按配置构建巡查适配器（T053 与 005-US3 使用）。
 * 注册名："claude-code"、"codex-cli"；参数块：generic-file（路径 + 完成特征正则）、
 * codex-cli（可选 sessionsDir）。
 * 未知适配器名抛出明确错误（FR-002 场景 3）。
 */
export function buildAdapters(configs: PollingAdapterConfig[]): AgentStatusAdapter[] {
  return configs.map((config) => {
    if (typeof config === "string") {
      if (config === "claude-code") {
        return new ClaudeCodeAdapter();
      }
      if (config === "codex-cli") {
        return new CodexCliAdapter();
      }
      throw new AgentStatusError(
        `不支持的巡查适配器：${config}（支持：claude-code、codex-cli、generic-file）`,
      );
    }
    if (config.name === "generic-file") {
      return new GenericFileAdapter({
        path: config.path,
        completionPattern: config.completionPattern,
      });
    }
    if (config.name === "codex-cli") {
      return new CodexCliAdapter({ sessionsDir: config.sessionsDir });
    }
    const unknownName = (config as { name?: unknown }).name;
    throw new AgentStatusError(`不支持的巡查适配器：${String(unknownName)}`);
  });
}
