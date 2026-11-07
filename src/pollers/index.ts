import type { PollingAdapterConfig } from "../config/loader.js";
import { AgentStatusError, type AgentStatusAdapter } from "./adapter.js";
import { ClaudeCodeAdapter } from "./claude-code.js";
import { GenericFileAdapter } from "./generic-file.js";

/**
 * 按配置构建巡查适配器（T053 使用）。
 * 注册名："claude-code"；参数块：generic-file（路径 + 完成特征正则）。
 * 未知适配器名抛出明确错误（FR-002 场景 3）。
 */
export function buildAdapters(configs: PollingAdapterConfig[]): AgentStatusAdapter[] {
  return configs.map((config) => {
    if (typeof config === "string") {
      if (config === "claude-code") {
        return new ClaudeCodeAdapter();
      }
      throw new AgentStatusError(
        `不支持的巡查适配器：${config}（支持：claude-code、generic-file）`,
      );
    }
    if (config.name === "generic-file") {
      return new GenericFileAdapter({
        path: config.path,
        completionPattern: config.completionPattern,
      });
    }
    throw new AgentStatusError(`不支持的巡查适配器：${String(config.name)}`);
  });
}
