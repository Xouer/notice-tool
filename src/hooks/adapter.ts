import type { HookTemplateDefinition } from "./default-templates.js";

/**
 * 智能体配置适配器接口（006-US2）：
 * 每个智能体实现"读取已有配置 → 合并/移除本工具钩子 → 输出最终文本"。
 * 冲突与幂等语义由 merge/remove 结果表达，写入由 config-file-writer 负责。
 */

export interface MergeResult {
  /** 最终写入的配置文本。 */
  content: string;
  /** 已存在非本工具的同类钩子配置（需用户确认）。 */
  conflict: boolean;
  /** 本工具的钩子已存在（幂等，无需改动）。 */
  alreadyPresent: boolean;
}

export interface RemoveResult {
  /** 最终写入的配置文本；undefined 表示无需改动。 */
  content: string | undefined;
  /** 是否实际移除了本工具的钩子。 */
  removed: boolean;
}

export interface HookConfigAdapter {
  /** 合并模板钩子到既有配置文本；existing 为 undefined 表示文件不存在。 */
  merge(existing: string | undefined, template: HookTemplateDefinition): MergeResult;
  /** 从既有配置文本移除本工具钩子。 */
  remove(existing: string, template: HookTemplateDefinition): RemoveResult;
  /** 校验既有配置是否包含本工具钩子（用于 validate）。 */
  contains(existing: string, template: HookTemplateDefinition): boolean;
}
