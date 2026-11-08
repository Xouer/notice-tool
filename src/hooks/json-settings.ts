import type { HookConfigAdapter, MergeResult, RemoveResult } from "./adapter.js";
import type { HookTemplateDefinition } from "./default-templates.js";
import { HookConfigError } from "./types.js";

/**
 * JSON 设置文件合并逻辑（CodeBuddy / Claude Code 共用，006-US2）。
 * 结构约定（官方 hooks 配置）：
 *   { "hooks": { "<Event>": [ { "hooks": [ { "type": "command", "command": "..." } ] } ] } }
 * 幂等判定：某事件条目内存在 command 与本工具命令完全一致即视为"已存在"。
 * 冲突判定：该事件下存在任何非本工具的条目（用户自定义钩子），需 --confirm。
 */

export function commandString(template: HookTemplateDefinition): string {
  return template.command.join(" ");
}

function parseObject(existing: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(existing);
  } catch {
    throw new HookConfigError(
      "目标配置文件不是合法 JSON（内容损坏或无法识别），已保留原文件未改动",
      "invalid_content",
    );
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new HookConfigError("目标配置文件根节点不是 JSON 对象，无法安全合并", "invalid_content");
  }
  return parsed as Record<string, unknown>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** 事件条目中是否含本工具命令。 */
function entryContainsCommand(entry: unknown, command: string): boolean {
  if (!isRecord(entry)) return false;
  const hooks = entry.hooks;
  if (!Array.isArray(hooks)) return false;
  return hooks.some((hook) => {
    if (!isRecord(hook)) return false;
    return hook.command === command;
  });
}

function buildSnippet(eventName: string, command: string): Record<string, unknown> {
  return {
    hooks: {
      [eventName]: [
        {
          hooks: [{ type: "command", command }],
        },
      ],
    },
  };
}

function serialize(doc: Record<string, unknown>): string {
  return `${JSON.stringify(doc, null, 2)}\n`;
}

export class JsonSettingsAdapter implements HookConfigAdapter {
  merge(existing: string | undefined, template: HookTemplateDefinition): MergeResult {
    const command = commandString(template);
    if (existing === undefined) {
      return {
        content: serialize(buildSnippet(template.eventName, command)),
        conflict: false,
        alreadyPresent: false,
      };
    }
    const doc = parseObject(existing);
    const hooksValue = doc.hooks;
    if (hooksValue !== undefined && !isRecord(hooksValue)) {
      throw new HookConfigError(
        "目标配置的 hooks 字段格式无法识别（应为对象），已保留原文件未改动",
        "invalid_content",
      );
    }
    const hooks = (hooksValue ?? {}) as Record<string, unknown>;
    const rawEntries = hooks[template.eventName];
    if (rawEntries !== undefined && !Array.isArray(rawEntries)) {
      throw new HookConfigError(
        `目标配置的 hooks.${template.eventName} 字段格式无法识别（应为数组），已保留原文件未改动`,
        "invalid_content",
      );
    }
    const entries = (rawEntries ?? []) as unknown[];
    const alreadyPresent = entries.some((entry) => entryContainsCommand(entry, command));
    const conflict = entries.some((entry) => !entryContainsCommand(entry, command));

    if (!alreadyPresent) {
      entries.push({ hooks: [{ type: "command", command }] });
      hooks[template.eventName] = entries;
      doc.hooks = hooks;
    }
    return {
      content: serialize(doc),
      conflict,
      alreadyPresent,
    };
  }

  remove(existing: string, template: HookTemplateDefinition): RemoveResult {
    const command = commandString(template);
    const doc = parseObject(existing);
    if (!isRecord(doc.hooks)) {
      return { content: undefined, removed: false };
    }
    const hooks = doc.hooks as Record<string, unknown>;
    const rawEntries = hooks[template.eventName];
    if (!Array.isArray(rawEntries)) {
      return { content: undefined, removed: false };
    }
    const entries = rawEntries as unknown[];
    const filtered = entries.filter((entry) => !entryContainsCommand(entry, command));
    if (filtered.length === entries.length) {
      return { content: undefined, removed: false };
    }
    if (filtered.length === 0) {
      delete hooks[template.eventName];
    } else {
      hooks[template.eventName] = filtered;
    }
    if (Object.keys(hooks).length === 0) {
      delete doc.hooks;
    }
    return { content: serialize(doc), removed: true };
  }

  contains(existing: string, template: HookTemplateDefinition): boolean {
    const command = commandString(template);
    const doc = parseObject(existing);
    if (!isRecord(doc.hooks)) return false;
    const rawEntries = doc.hooks[template.eventName];
    if (!Array.isArray(rawEntries)) return false;
    return (rawEntries as unknown[]).some((entry) => entryContainsCommand(entry, command));
  }
}

/** 供 CodeBuddy / Claude Code 复用同一套 JSON 逻辑。 */
export const jsonSettingsAdapter = new JsonSettingsAdapter();
