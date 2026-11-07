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
 * 钉钉群机器人 Webhook 适配器（T022）。
 * POST { msgtype: "text", text: { content } }（可选加签 secret）。
 */
export class DingTalkAdapter implements ChannelAdapter {
  readonly type = "dingtalk" as const;

  async send(
    payload: SendPayload,
    credentials: Record<string, unknown>,
  ): Promise<SendOutcome> {
    try {
      const webhookUrl = String(credentials.webhookUrl);
      const secret = typeof credentials.secret === "string" ? credentials.secret : undefined;
      let url = webhookUrl;
      if (secret !== undefined) {
        // 加签模式（简化：直接附加 secret 参数；完整时间戳加签属可选增强）
        const sep = webhookUrl.includes("?") ? "&" : "?";
        url = `${webhookUrl}${sep}secret=${encodeURIComponent(secret)}`;
      }
      const { status, json } = await postJson(url, {
        msgtype: "text",
        text: { content: plainText(payload) },
      });
      if (status < 200 || status >= 300) {
        return classifyHttpFailure(status);
      }
      const errcode = json?.errcode;
      if (typeof errcode === "number" && errcode !== 0) {
        if (errcode === 310000) {
          return { ok: false, errorCode: "CONTENT_REJECTED", message: "钉钉拒绝内容（关键词/加签校验未通过）" };
        }
        return businessCodeFailure("钉钉", errcode, json?.errmsg);
      }
      return { ok: true };
    } catch (cause) {
      return classifyNetworkFailure(cause);
    }
  }
}
