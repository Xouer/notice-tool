import { jsonSettingsAdapter } from "./json-settings.js";
import type { HookConfigAdapter } from "./adapter.js";

/**
 * CodeBuddy 配置适配（006-US2）：settings.json 的 hooks.Stop。
 * 与 Claude Code 同形，复用 JSON 设置合并逻辑。
 */
export const codebuddyConfigAdapter: HookConfigAdapter = jsonSettingsAdapter;
