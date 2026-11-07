import { CHANNEL_TYPES, type ChannelType } from "../storage/schema.js";
import { maskSecret } from "../storage/crypto.js";

/**
 * 渠道配置校验（T019 依赖，data-model.md 校验规则，源自 FR-004/FR-005）：
 * - type 必须属于五类枚举之一
 * - name 非空、同 type 内唯一（唯一性由仓储层唯一索引保证）
 * - Webhook 类要求 URL 合法（http/https）
 * - email 密文结构须含收件地址与 SMTP 授权码
 * - 凭据内部 schema 版本化（schemaVersion: 1）
 */
export class ChannelConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ChannelConfigError";
  }
}

export interface ValidatedChannel {
  type: ChannelType;
  name: string;
  /** 已按类型校验、附 schemaVersion 的凭据结构（入库前整体加密）。 */
  credentials: Record<string, unknown>;
}

function requireString(raw: Record<string, unknown>, field: string): string {
  const value = raw[field];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new ChannelConfigError(`凭据字段 ${field} 必须为非空字符串`);
  }
  return value.trim();
}

function optionalString(raw: Record<string, unknown>, field: string): string | undefined {
  const value = raw[field];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string" || value.trim().length === 0) return undefined;
  return value.trim();
}

function requireWebhookUrl(raw: Record<string, unknown>, field: string): string {
  const value = requireString(raw, field);
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new ChannelConfigError(`凭据字段 ${field} 不是合法 URL`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new ChannelConfigError(`凭据字段 ${field} 仅支持 http/https URL`);
  }
  return value;
}

function requireEnum(value: unknown, field: string, allowed: readonly string[]): string {
  if (typeof value !== "string" || !allowed.includes(value)) {
    throw new ChannelConfigError(`凭据字段 ${field} 必须为 ${allowed.join("|")} 之一`);
  }
  return value;
}

export function validateChannelInput(
  type: string,
  name: string,
  rawCredentials: unknown,
): ValidatedChannel {
  if (!(CHANNEL_TYPES as readonly string[]).includes(type)) {
    throw new ChannelConfigError(
      `渠道类型必须是 ${CHANNEL_TYPES.join("/")} 之一，收到：${String(type)}`,
    );
  }
  if (typeof name !== "string" || name.trim().length === 0) {
    throw new ChannelConfigError("渠道名称不能为空");
  }
  if (name.trim().length > 64) {
    throw new ChannelConfigError("渠道名称长度 ≤ 64 字符");
  }
  if (
    rawCredentials === null ||
    typeof rawCredentials !== "object" ||
    Array.isArray(rawCredentials)
  ) {
    throw new ChannelConfigError("凭据必须为对象结构");
  }
  const raw = rawCredentials as Record<string, unknown>;

  let credentials: Record<string, unknown>;
  switch (type as ChannelType) {
    case "feishu": {
      // 连接模式（002-FR-101/FR-104）：app=应用凭证（app_id+app_secret+接收目标）；
      // webhook=群机器人。mode 缺省视为 webhook（research.md R6：旧数据零迁移）。
      const mode = optionalString(raw, "mode") ?? "webhook";
      if (mode === "app") {
        credentials = {
          mode,
          appId: requireString(raw, "appId"),
          appSecret: requireString(raw, "appSecret"),
          receiveIdType: requireEnum(raw.receiveIdType, "receiveIdType", [
            "chat_id",
            "open_id",
            "user_id",
            "union_id",
            "email",
          ]),
          receiveId: requireString(raw, "receiveId"),
        };
      } else if (mode === "webhook") {
        credentials =
          raw.mode === undefined
            ? // 旧结构（无 mode 字段）保持原样输出，避免既有凭据往返变形
              { webhookUrl: requireWebhookUrl(raw, "webhookUrl") }
            : { mode, webhookUrl: requireWebhookUrl(raw, "webhookUrl") };
      } else {
        throw new ChannelConfigError("凭据字段 mode 必须为 app|webhook 之一");
      }
      break;
    }
    case "dingtalk": {
      const dingtalk: Record<string, unknown> = {
        webhookUrl: requireWebhookUrl(raw, "webhookUrl"),
      };
      const secret = optionalString(raw, "secret");
      if (secret !== undefined) dingtalk.secret = secret; // 加签密钥（可选）
      credentials = dingtalk;
      break;
    }
    case "email": {
      const email: Record<string, unknown> = {
        smtpHost: requireString(raw, "smtpHost"),
        smtpPort: typeof raw.smtpPort === "number" ? raw.smtpPort : 465,
        username: optionalString(raw, "username"),
        authCode: requireString(raw, "authCode"), // SMTP 授权码（必填）
        from: optionalString(raw, "from"),
        to: requireString(raw, "to"), // 收件地址（必填）
      };
      if (!email.to || !String(email.to).includes("@")) {
        throw new ChannelConfigError("凭据字段 to 必须为收件邮箱地址");
      }
      credentials = email;
      break;
    }
    case "wechat": {
      const mode = requireEnum(raw.mode, "mode", ["webhook", "push"]);
      if (mode === "webhook") {
        credentials = {
          mode,
          webhookUrl: requireWebhookUrl(raw, "webhookUrl"), // 企业微信群机器人
        };
      } else {
        credentials = {
          mode,
          pushKey: requireString(raw, "pushKey"), // Server酱/PushPlus 推送密钥
          service: requireEnum(
            raw.service ?? "serverchan",
            "service",
            ["serverchan", "pushplus"],
          ),
        };
      }
      break;
    }
    case "qq": {
      const mode = requireEnum(raw.mode, "mode", ["official", "push"]);
      if (mode === "official") {
        credentials = {
          mode,
          appId: requireString(raw, "appId"),
          appSecret: requireString(raw, "appSecret"),
          endpoint: requireWebhookUrl(raw, "endpoint"), // 消息接口地址（完整 URL）
        };
      } else {
        credentials = {
          mode,
          pushKey: requireString(raw, "pushKey"),
          service: requireEnum(raw.service ?? "pushplus", "service", ["pushplus"]),
        };
      }
      break;
    }
  }

  return {
    type: type as ChannelType,
    name: name.trim(),
    credentials: { schemaVersion: 1, ...credentials },
  };
}

/** 凭据掩码摘要（list 输出一律掩码，FR-012 / contracts/cli.md）。 */
export function summarizeCredentials(
  type: ChannelType,
  credentials: Record<string, unknown>,
): string {
  const str = (key: string): string =>
    typeof credentials[key] === "string" ? String(credentials[key]) : "";
  switch (type) {
    case "feishu": {
      // app 模式摘要：appId 掩码 → receiveId 掩码（appSecret 永不出现，002-FR-106）
      if (credentials.mode === "app") {
        const appId = str("appId");
        if (appId === "") return "***";
        return `${maskSecret(appId)} → ${maskSecret(str("receiveId"))}`;
      }
      return str("webhookUrl") === "" ? "***" : maskSecret(str("webhookUrl"));
    }
    case "dingtalk":
      return str("webhookUrl") === "" ? "***" : maskSecret(str("webhookUrl"));
    case "email":
      return str("authCode") === "" ? "***" : `${maskSecret(str("authCode"))} → ${str("to")}`;
    case "wechat":
    case "qq":
      return str("pushKey") !== "" ? maskSecret(str("pushKey")) : maskSecret(str("webhookUrl"));
  }
}
