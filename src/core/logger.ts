import { maskSecret } from "../storage/crypto.js";

/**
 * 凭据掩码日志器（T014，宪法 IV / FR-012）：
 * Webhook 地址、令牌、授权码、推送密钥一律掩码输出。
 * 日志写入 stderr（stdout 保留给 CLI --json 输出）。
 */
export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

/** URL 路径中的长令牌段（Webhook 类）。 */
const URL_SECRET_SEGMENT = /(\/(?:hook|bot|token|api-key|apikey)\/)([A-Za-z0-9_-]{16,})/gi;
/** Bearer / 基本授权头。 */
const AUTH_HEADER = /(Bearer|Basic)\s+[A-Za-z0-9-_.~+/]+=*/gi;
/** 键值对形式的敏感字段。 */
const SENSITIVE_KEY_VALUE =
  /(webhook|token|secret|password|authcode|authorization|apikey|api_key|access_key|pushkey|push_key)(\s*[:=]\s*)("[^"]*"|[^\s"',;}&]+)/gi;
/** 独立长令牌串（≥24 连续 token 字符）。 */
const LONG_TOKEN = /\b[A-Za-z0-9_-]{24,}\b/g;

/** 对任意文本做敏感信息掩码 / Redact secrets from arbitrary text. */
export function redactSensitive(text: string): string {
  return text
    .replace(URL_SECRET_SEGMENT, (_match, prefix: string) => `${prefix}****`)
    .replace(AUTH_HEADER, (_match, scheme: string) => `${scheme} ****`)
    .replace(
      SENSITIVE_KEY_VALUE,
      (_match, key: string, sep: string) => `${key}${sep}****`,
    )
    .replace(LONG_TOKEN, (token) => maskSecret(token));
}

const SENSITIVE_META_KEYS =
  /(webhook|token|secret|password|authcode|authorization|apikey|api_key|access_key|pushkey|push_key|credentials?)/i;

function maskMeta(meta: Record<string, unknown>): Record<string, unknown> {
  const masked: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(meta)) {
    masked[key] = SENSITIVE_META_KEYS.test(key)
      ? "***"
      : typeof value === "string"
        ? redactSensitive(value)
        : value;
  }
  return masked;
}

export interface Logger {
  debug(message: string, meta?: Record<string, unknown>): void;
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
}

export function createLogger(minLevel: LogLevel = "info"): Logger {
  const write = (level: LogLevel, message: string, meta?: Record<string, unknown>): void => {
    if (LEVEL_ORDER[level] < LEVEL_ORDER[minLevel]) return;
    const line = `[notice] ${level.toUpperCase()} ${redactSensitive(message)}`;
    const metaLine =
      meta === undefined ? "" : ` ${redactSensitive(JSON.stringify(maskMeta(meta)))}`;
    process.stderr.write(`${line}${metaLine}\n`);
  };
  return {
    debug: (m, meta) => write("debug", m, meta),
    info: (m, meta) => write("info", m, meta),
    warn: (m, meta) => write("warn", m, meta),
    error: (m, meta) => write("error", m, meta),
  };
}
