import {
  businessCodeFailure,
  classifyHttpFailure,
  classifyNetworkFailure,
  plainText,
  postJson,
  type ChannelAdapter,
  type SendOutcome,
  type SendPayload,
} from "./adapter.js";
import { feishuTokenProvider, resolveFeishuBaseUrl } from "./feishu-token.js";

/**
 * 飞书渠道适配器（001-T021 Webhook / 002-T009 应用凭证双模式）。
 *
 * - webhook 模式：POST { msg_type, content: { text } }，响应 { code: 0 } / 旧版 { StatusCode: 0 }
 * - app 模式（002-FR-101/FR-103）：令牌（tenant_access_token，自动缓存/续取）
 *   → POST /open-apis/im/v1/messages?receive_id_type=...，content 为字符串化 JSON（research.md R1）
 */

/** 业务码映射表（contracts/feishu-app-channel.md；实现期已按开放平台错误码文档核对固化）。 */
const TOKEN_RETRY_CODES = new Set([99991661, 99991663, 99991668]);
const PERMISSION_CODES = new Set([99991672, 99991679]);
const TARGET_CODES = new Set([230002, 230013]);
const RATE_CODES = new Set([99991400]);

/** 业务码 → 发送结果；tokenInvalid 标记令牌失效（适配器将清缓存重取并重试一次）。 */
type AppAttempt =
  | { outcome: SendOutcome; ok: true }
  | { outcome: SendOutcome; ok: false; tokenInvalid?: boolean };

function classifyBusinessCode(code: number): AppAttempt {
  if (TOKEN_RETRY_CODES.has(code)) {
    return {
      ok: false,
      tokenInvalid: true,
      outcome: {
        ok: false,
        errorCode: "AUTH_INVALID",
        message: "访问令牌已失效",
      },
    };
  }
  if (PERMISSION_CODES.has(code)) {
    return {
      ok: false,
      outcome: {
        ok: false,
        errorCode: "AUTH_INVALID",
        message:
          "应用缺少消息发送权限或尚未发布版本，请在飞书开放平台开通消息发送权限并发布应用版本",
      },
    };
  }
  if (TARGET_CODES.has(code)) {
    return {
      ok: false,
      outcome: {
        ok: false,
        errorCode: "CONTENT_REJECTED",
        message:
          "应用机器人不在目标会话或接收目标不存在，请将应用机器人加入会话或检查接收目标配置",
      },
    };
  }
  if (RATE_CODES.has(code)) {
    return {
      ok: false,
      outcome: {
        ok: false,
        errorCode: "RATE_LIMITED_REMOTE",
        message: "飞书接口限流，请稍后重试",
      },
    };
  }
  // 未分类业务码：沿用兜底（脱敏，仅回传错误码；不回传原始响应体）
  return { ok: false, outcome: businessCodeFailure("飞书", code) };
}

interface AppCredentials {
  appId: string;
  appSecret: string;
  receiveIdType: string;
  receiveId: string;
}

export class FeishuAdapter implements ChannelAdapter {
  readonly type = "feishu" as const;

  async send(
    payload: SendPayload,
    credentials: Record<string, unknown>,
  ): Promise<SendOutcome> {
    if (credentials.mode === "app") {
      return this.sendViaApp(payload, credentials as unknown as AppCredentials & Record<string, unknown>);
    }
    return this.sendViaWebhook(payload, credentials);
  }

  /** 旧路径：群机器人 Webhook 直发（001 行为不变）。 */
  private async sendViaWebhook(
    payload: SendPayload,
    credentials: Record<string, unknown>,
  ): Promise<SendOutcome> {
    const webhookUrl = String(credentials.webhookUrl);
    try {
      const { status, json } = await postJson(webhookUrl, {
        msg_type: "text",
        content: { text: plainText(payload) },
      });
      if (status < 200 || status >= 300) {
        return classifyHttpFailure(status);
      }
      const code = json?.code ?? json?.StatusCode;
      if (typeof code === "number" && code !== 0) {
        return businessCodeFailure("飞书", code, json?.msg);
      }
      return { ok: true };
    } catch (cause) {
      return classifyNetworkFailure(cause);
    }
  }

  /** 新路径（002）：应用凭证 → 令牌 → im/v1/messages；令牌失效自动重取并重试一次（FR-103）。 */
  private async sendViaApp(
    payload: SendPayload,
    credentials: AppCredentials & Record<string, unknown>,
  ): Promise<SendOutcome> {
    const attempt = (): Promise<AppAttempt> => this.attemptAppSend(payload, credentials);
    const first = await attempt();
    if (first.ok) {
      return first.outcome;
    }
    if (first.tokenInvalid === true) {
      feishuTokenProvider.invalidate(credentials.appId);
      const second = await attempt();
      return second.outcome;
    }
    return first.outcome;
  }

  private async attemptAppSend(
    payload: SendPayload,
    credentials: AppCredentials & Record<string, unknown>,
  ): Promise<AppAttempt> {
    const tokenResult = await feishuTokenProvider.getToken(
      credentials.appId,
      credentials.appSecret,
    );
    if (!tokenResult.ok) {
      return { ok: false, outcome: tokenResult };
    }
    const receiveIdType = credentials.receiveIdType;
    const url =
      `${resolveFeishuBaseUrl()}/open-apis/im/v1/messages?receive_id_type=${encodeURIComponent(receiveIdType)}`;
    try {
      const { status, json } = await postJson(
        url,
        {
          receive_id: credentials.receiveId,
          msg_type: "text",
          // 注意：im/v1 的 content 字段是字符串化 JSON（research.md R1 格式差异）
          content: JSON.stringify({ text: plainText(payload) }),
        },
        { authorization: `Bearer ${tokenResult.token}` },
      );
      if (status < 200 || status >= 300) {
        return { ok: false, outcome: classifyHttpFailure(status) };
      }
      const code = json?.code;
      if (typeof code === "number" && code !== 0) {
        return classifyBusinessCode(code);
      }
      return { ok: true, outcome: { ok: true } };
    } catch (cause) {
      return { ok: false, outcome: classifyNetworkFailure(cause) };
    }
  }
}
