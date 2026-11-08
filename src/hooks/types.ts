/**
 * 钩子配置共享类型（006-T001）。
 * 纯类型与常量，不依赖存储层，供 schema、default-templates、manager 复用。
 */

export const HOOK_PLATFORMS = ["linux", "macos", "windows"] as const;
export type HookPlatform = (typeof HOOK_PLATFORMS)[number];

export const HOOK_AGENTS = ["codebuddy", "claude-code", "codex-cli"] as const;
export type HookAgent = (typeof HOOK_AGENTS)[number];

/** 模板唯一标识：`<platform>-<agent>`。 */
export type HookTemplateId = `${HookPlatform}-${HookAgent}`;

/** 验证状态（data-model.md HookConfigResult 简化为实例字段）。 */
export const VALIDATION_STATUSES = ["valid", "invalid", "not_validated"] as const;
export type ValidationStatus = (typeof VALIDATION_STATUSES)[number];

/** 失败原因分类（contracts/cli-hook-config.md 错误语义）。 */
export const FAILURE_CATEGORIES = [
  "missing_target",
  "permission_denied",
  "invalid_content",
  "conflict",
  "not_found",
  "unknown",
] as const;
export type FailureCategory = (typeof FAILURE_CATEGORIES)[number];

/** 钩子配置领域错误（含失败分类，供 CLI 映射退出码）。 */
export class HookConfigError extends Error {
  constructor(
    message: string,
    readonly category: FailureCategory = "unknown",
  ) {
    super(message);
    this.name = "HookConfigError";
  }
}

export function isHookPlatform(value: string): value is HookPlatform {
  return (HOOK_PLATFORMS as readonly string[]).includes(value);
}

export function isHookAgent(value: string): value is HookAgent {
  return (HOOK_AGENTS as readonly string[]).includes(value);
}

/** 校验模板 id 格式：`<platform>-<agent>`。 */
export function isHookTemplateId(value: string): value is HookTemplateId {
  const idx = value.indexOf("-");
  if (idx <= 0 || idx === value.length - 1) return false;
  const platform = value.slice(0, idx);
  const agent = value.slice(idx + 1);
  return isHookPlatform(platform) && isHookAgent(agent);
}
