import type { ChannelType, ErrorCode } from "../storage/schema.js";

/**
 * ChannelAdapter 统一接口（T020，contracts/cli.md 错误码分类）。
 * 五渠道适配器共同基座：差异只在 URL、鉴权头与负载格式（research.md R6）。
 */
export interface SendPayload {
  title?: string;
  message: string;
}

export type SendOutcome =
  | { ok: true }
  | { ok: false; errorCode: ErrorCode; message: string };

export interface ChannelAdapter {
  readonly type: ChannelType;
  send(payload: SendPayload, credentials: Record<string, unknown>): Promise<SendOutcome>;
}

/** 纯文本消息格式化（title 可选）。 */
export function plainText(payload: SendPayload): string {
  return payload.title === undefined
    ? payload.message
    : `${payload.title}\n${payload.message}`;
}

/** HTTP 状态码 → 错误分类；错误信息脱敏（不带原始响应体）。 */
export function classifyHttpFailure(status: number): SendOutcome {
  const errorCode: ErrorCode =
    status === 401 || status === 403 || status === 404
      ? "AUTH_INVALID"
      : status === 429
        ? "RATE_LIMITED_REMOTE"
        : status === 400 || status === 422
          ? "CONTENT_REJECTED"
          : "UNKNOWN";
  return { ok: false, errorCode, message: `渠道返回 HTTP ${status}` };
}

/** 网络层失败 → NETWORK_UNREACHABLE。 */
export function classifyNetworkFailure(cause: unknown): SendOutcome {
  const detail =
    cause instanceof Error ? cause.message.split("\n")[0] ?? "" : "未知错误";
  return { ok: false, errorCode: "NETWORK_UNREACHABLE", message: `网络请求失败：${detail}` };
}

/** 通用 JSON POST（fetch 封装，返回状态码与解析后的 JSON 体）。 */
export async function postJson(
  url: string,
  body: unknown,
  headers: Record<string, string> = {},
): Promise<{ status: number; json: Record<string, unknown> | null }> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
  let json: Record<string, unknown> | null;
  try {
    json = (await res.json()) as Record<string, unknown>;
  } catch {
    json = null;
  }
  return { status: res.status, json };
}

/** 业务码非零时的兜底分类（保持脱敏：仅回传错误码与渠道侧短消息）。 */
export function businessCodeFailure(
  channelLabel: string,
  code: unknown,
  hint?: unknown,
): SendOutcome {
  const message =
    typeof hint === "string" && hint.length > 0
      ? `${channelLabel}返回错误码 ${String(code)}`
      : `${channelLabel}返回错误码 ${String(code)}`;
  return { ok: false, errorCode: "UNKNOWN", message };
}
