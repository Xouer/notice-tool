/**
 * 钩子配置模块公共出口（006-T002）。
 */
export { HookConfigManager, type ManagerOptions, type TemplateView } from "./manager.js";
export {
  buildHookTemplates,
  findHookTemplate,
  KNOWN_TEMPLATE_IDS,
  AGENT_LABELS,
  PLATFORM_LABELS,
  type HookTemplateDefinition,
} from "./default-templates.js";
export {
  HookConfigError,
  HOOK_PLATFORMS,
  HOOK_AGENTS,
  VALIDATION_STATUSES,
  FAILURE_CATEGORIES,
  isHookPlatform,
  isHookAgent,
  isHookTemplateId,
  type HookPlatform,
  type HookAgent,
  type HookTemplateId,
  type ValidationStatus,
  type FailureCategory,
} from "./types.js";
