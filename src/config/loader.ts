/**
 * config.json 加载、默认值合并与校验 / Config loading, defaults merging & validation.
 *
 * 契约依据 contracts/cli.md：
 * - 顶层键 schemaVersion/server/polling/dedup/antiFlood/retentionDays
 * - 缺失字段取内置默认值；未知字段忽略并告警（向前兼容）
 * - 仅存非敏感配置；凭据一律存数据库密文列
 */

export type PollingAdapterConfig =
  | string
  | { name: "generic-file"; path: string; completionPattern: string }
  | { name: "codex-cli"; sessionsDir?: string };

export interface NoticeConfig {
  schemaVersion: number;
  server: { host: string; port: number };
  polling: {
    enabled: boolean;
    intervalSeconds: number;
    adapters: PollingAdapterConfig[];
  };
  dedup: { cooldownMinutes: number };
  antiFlood: { aggregateWindowSeconds: number; perChannelPerMinute: number };
  retentionDays: number;
}

/** 内置默认值（与 contracts/cli.md 配置示例一致）/ Built-in defaults. */
export const DEFAULT_CONFIG: Readonly<NoticeConfig> = {
  schemaVersion: 1,
  server: { host: "127.0.0.1", port: 47650 },
  polling: { enabled: true, intervalSeconds: 10, adapters: ["claude-code"] },
  dedup: { cooldownMinutes: 10 },
  antiFlood: { aggregateWindowSeconds: 30, perChannelPerMinute: 20 },
  retentionDays: 30,
};

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

type WarnFn = (message: string) => void;

type FieldType = "string" | "number" | "boolean" | "array";

const SECTION_FIELD_TYPES: Record<string, Record<string, FieldType>> = {
  server: { host: "string", port: "number" },
  polling: { enabled: "boolean", intervalSeconds: "number", adapters: "array" },
  dedup: { cooldownMinutes: "number" },
  antiFlood: { aggregateWindowSeconds: "number", perChannelPerMinute: "number" },
};

const KNOWN_TOP_LEVEL_KEYS = new Set([
  "schemaVersion",
  "retentionDays",
  ...Object.keys(SECTION_FIELD_TYPES),
]);

function expectType(path: string, value: unknown, expected: FieldType): void {
  const actual = Array.isArray(value) ? "array" : typeof value;
  if (actual !== expected) {
    throw new ConfigError(`配置字段 ${path} 类型应为 ${expected}，实际为 ${actual}`);
  }
}

function validateAdapters(adapters: PollingAdapterConfig[]): void {
  for (const adapter of adapters) {
    if (typeof adapter === "string") {
      if (adapter.trim().length === 0) {
        throw new ConfigError("polling.adapters 条目不能为空字符串");
      }
      continue;
    }
    if (adapter !== null && typeof adapter === "object" && adapter.name === "codex-cli") {
      if (
        adapter.sessionsDir !== undefined &&
        (typeof adapter.sessionsDir !== "string" || adapter.sessionsDir.trim().length === 0)
      ) {
        throw new ConfigError("codex-cli 适配器 sessionsDir 必须为非空字符串");
      }
      continue;
    }
    if (
      typeof adapter === "object" &&
      adapter !== null &&
      adapter.name === "generic-file"
    ) {
      if (
        typeof adapter.path !== "string" ||
        adapter.path.trim().length === 0
      ) {
        throw new ConfigError("generic-file 适配器要求非空 path");
      }
      if (typeof adapter.completionPattern !== "string") {
        throw new ConfigError("generic-file 适配器要求字符串 completionPattern");
      }
      try {
        new RegExp(adapter.completionPattern);
      } catch {
        throw new ConfigError("generic-file 适配器 completionPattern 不是合法正则");
      }
      continue;
    }
    throw new ConfigError(
      "polling.adapters 条目必须为适配器注册名（字符串）或 generic-file/codex-cli 配置块",
    );
  }
}

/**
 * 加载配置：接受 JSON 字符串或已解析对象，合并默认值。
 * 未知字段忽略并经 `warn` 告警（默认 console.warn）。
 */
export function loadConfig(
  input: string | Record<string, unknown>,
  warn: WarnFn = console.warn,
): NoticeConfig {
  let raw: Record<string, unknown>;
  if (typeof input === "string") {
    try {
      raw = JSON.parse(input) as Record<string, unknown>;
    } catch {
      throw new ConfigError("配置不是合法 JSON");
    }
  } else {
    raw = input;
  }
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new ConfigError("配置根必须是 JSON 对象");
  }

  const config: NoticeConfig = structuredClone(DEFAULT_CONFIG);

  if ("schemaVersion" in raw) {
    if (typeof raw.schemaVersion !== "number" || !Number.isInteger(raw.schemaVersion)) {
      throw new ConfigError("schemaVersion 必须为整数");
    }
    if (raw.schemaVersion !== 1) {
      throw new ConfigError(
        `不支持的 schemaVersion: ${raw.schemaVersion}（当前支持 1）`,
      );
    }
    config.schemaVersion = raw.schemaVersion;
  }

  for (const [sectionName, fields] of Object.entries(SECTION_FIELD_TYPES)) {
    if (!(sectionName in raw)) continue;
    const provided = raw[sectionName];
    if (
      provided === null ||
      typeof provided !== "object" ||
      Array.isArray(provided)
    ) {
      throw new ConfigError(`配置节 ${sectionName} 必须为对象`);
    }
    const target = config[sectionName as keyof NoticeConfig] as Record<
      string,
      unknown
    >;
    for (const [key, value] of Object.entries(provided)) {
      const fieldPath = `${sectionName}.${key}`;
      const expected = fields[key];
      if (expected === undefined) {
        warn(`未知配置字段已忽略: ${fieldPath}（向前兼容）`);
        continue;
      }
      expectType(fieldPath, value, expected);
      target[key] = value;
    }
  }

  if ("retentionDays" in raw) {
    expectType("retentionDays", raw.retentionDays, "number");
    config.retentionDays = raw.retentionDays as number;
  }

  for (const key of Object.keys(raw)) {
    if (!KNOWN_TOP_LEVEL_KEYS.has(key)) {
      warn(`未知配置字段已忽略: ${key}（向前兼容）`);
    }
  }

  // 数值合法性 / numeric sanity
  const { server, polling, dedup, antiFlood, retentionDays } = config;
  if (
    !Number.isInteger(server.port) ||
    server.port < 1 ||
    server.port > 65535
  ) {
    throw new ConfigError("server.port 必须为 1–65535 的整数");
  }
  if (polling.intervalSeconds < 1) {
    throw new ConfigError("polling.intervalSeconds 必须 ≥ 1 秒");
  }
  if (dedup.cooldownMinutes < 0) {
    throw new ConfigError("dedup.cooldownMinutes 不能为负");
  }
  if (antiFlood.aggregateWindowSeconds < 0) {
    throw new ConfigError("antiFlood.aggregateWindowSeconds 不能为负");
  }
  if (antiFlood.perChannelPerMinute < 1) {
    throw new ConfigError("antiFlood.perChannelPerMinute 必须 ≥ 1");
  }
  if (!Number.isInteger(retentionDays) || retentionDays < 1) {
    throw new ConfigError("retentionDays 必须为 ≥ 1 的整数");
  }
  validateAdapters(config.polling.adapters);

  return config;
}
