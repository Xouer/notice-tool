import type { HookConfigAdapter, MergeResult, RemoveResult } from "./adapter.js";
import type { HookTemplateDefinition } from "./default-templates.js";

/**
 * Codex CLI 配置适配（006-US2）：config.toml 的顶层 `notify` 数组。
 * 采用行级处理，仅管理单行 `notify = [...]`（Codex 官方单命令形式）。
 * 多行 notify 或无法识别的形式按冲突处理，需用户确认，不做静默改写。
 */

const NOTIFY_LINE = 'notify = ["notice", "hook", "--source", "codex-cli", "--payload-argv"]';
const NOTIFY_RE = /^[ \t]*notify[ \t]*=[ \t]*(.*)$/m;

function isOurs(value: string): boolean {
  return (
    value.includes("notice") && value.includes("codex-cli") && value.includes("--payload-argv")
  );
}

function findNotify(existing: string): { index: number; line: string; value: string } | undefined {
  const match = NOTIFY_RE.exec(existing);
  if (match === null) return undefined;
  return { index: match.index, line: match[0], value: match[1] ?? "" };
}

export class CodexConfigAdapter implements HookConfigAdapter {
  merge(existing: string | undefined, _template: HookTemplateDefinition): MergeResult {
    if (existing === undefined) {
      return { content: `${NOTIFY_LINE}\n`, conflict: false, alreadyPresent: false };
    }
    const found = findNotify(existing);
    if (found === undefined) {
      const separator = existing.endsWith("\n") ? "" : "\n";
      return {
        content: `${existing}${separator}${NOTIFY_LINE}\n`,
        conflict: false,
        alreadyPresent: false,
      };
    }
    if (isOurs(found.value)) {
      return { content: existing, conflict: false, alreadyPresent: true };
    }
    // 已存在其他 notify 配置：覆盖需用户确认（FR-011）
    const replaced =
      existing.slice(0, found.index) +
      NOTIFY_LINE +
      existing.slice(found.index + found.line.length);
    return { content: replaced, conflict: true, alreadyPresent: false };
  }

  remove(existing: string, _template: HookTemplateDefinition): RemoveResult {
    const found = findNotify(existing);
    if (found === undefined || !isOurs(found.value)) {
      return { content: undefined, removed: false };
    }
    const before = existing.slice(0, found.index);
    const after = existing.slice(found.index + found.line.length);
    // 去掉紧随其后的换行，避免留下连续空行
    const cleaned = before + after.replace(/^\r?\n/, "");
    return { content: cleaned, removed: true };
  }

  contains(existing: string, _template: HookTemplateDefinition): boolean {
    const found = findNotify(existing);
    return found !== undefined && isOurs(found.value);
  }
}

export const codexConfigAdapter = new CodexConfigAdapter();
