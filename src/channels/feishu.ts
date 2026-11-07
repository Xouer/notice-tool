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

/**
 * 飞书群机器人 Webhook 适配器（T021）。
 * POST { msg_type: "text", content: { text } }；响应 { code: 0 } / 旧版 { StatusCode: 0 }。
 */
export class FeishuAdapter implements ChannelAdapter {
  readonly type = "feishu" as const;

  async send(
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
}
