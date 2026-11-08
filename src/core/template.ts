/**
 * 白名单占位符模板渲染器（T035，research.md R7：约 50 行纯函数，拒绝通用模板引擎）。
 * 仅允许固定字段替换；未知占位符保存/渲染即报错（FR-009）；正文 ≤ 2000 字符。
 */
export const TEMPLATE_MAX_LENGTH = 2000;

export const PLACEHOLDERS = [
  "title",
  "task_id",
  "source_agent",
  "result_status",
  "finished_at",
  "result_summary",
] as const;

export type PlaceholderKey = (typeof PLACEHOLDERS)[number];
export type PlaceholderValues = Record<PlaceholderKey, string>;

export class TemplateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TemplateError";
  }
}

const PLACEHOLDER_PATTERN = /\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g;

/** 提取模板中的全部占位符名（含重复）。 */
export function extractPlaceholders(body: string): string[] {
  return [...body.matchAll(PLACEHOLDER_PATTERN)].map((m) => m[1] ?? "");
}

/** 校验模板正文：白名单占位符 + 长度 ≤ 2000。 */
export function validateTemplateBody(body: string): void {
  if (body.length > TEMPLATE_MAX_LENGTH) {
    throw new TemplateError(`模板正文长度 ${body.length} 超过上限 ${TEMPLATE_MAX_LENGTH}`);
  }
  for (const name of extractPlaceholders(body)) {
    if (!(PLACEHOLDERS as readonly string[]).includes(name)) {
      throw new TemplateError(
        `未知占位符 {{${name}}}（白名单：${PLACEHOLDERS.map((p) => `{{${p}}}`).join("、")}）`,
      );
    }
  }
}

/** 渲染模板：先校验再替换；未知占位符抛 TemplateError。 */
export function renderTemplate(body: string, values: PlaceholderValues): string {
  validateTemplateBody(body);
  return body.replace(PLACEHOLDER_PATTERN, (_match, name: string) => {
    if (!(PLACEHOLDERS as readonly string[]).includes(name)) {
      throw new TemplateError(`未知占位符 {{${name}}}`);
    }
    return values[name as PlaceholderKey] ?? "";
  });
}
