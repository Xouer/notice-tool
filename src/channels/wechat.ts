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
 * 微信适配器（T024，research.md R6）：
 * - webhook 模式：企业微信群机器人（{ msgtype: "text", text: { content } }，errcode/errmsg）
 * - push 模式：Server酱 / PushPlus 推送服务
 */
export class WeChatAdapter implements ChannelAdapter {
  readonly type = "wechat" as const;

  async send(
    payload: SendPayload,
    credentials: Record<string, unknown>,
  ): Promise<SendOutcome> {
    try {
      const mode = credentials.mode === "push" ? "push" : "webhook";
      const message = plainText(payload);
      if (mode === "webhook") {
        return await this.#sendWebhook(String(credentials.webhookUrl), message);
      }
      const pushKey = String(credentials.pushKey);
      const service = credentials.service === "pushplus" ? "pushplus" : "serverchan";
      return await this.#sendPush(service, pushKey, payload.title ?? "notice 通知", message);
    } catch (cause) {
      return classifyNetworkFailure(cause);
    }
  }

  async #sendWebhook(webhookUrl: string, message: string): Promise<SendOutcome> {
    const { status, json } = await postJson(webhookUrl, {
      msgtype: "text",
      text: { content: message },
    });
    if (status < 200 || status >= 300) return classifyHttpFailure(status);
    const errcode = json?.errcode;
    if (typeof errcode === "number" && errcode !== 0) {
      return businessCodeFailure("企业微信", errcode, json?.errmsg);
    }
    return { ok: true };
  }

  async #sendPush(
    service: "serverchan" | "pushplus",
    pushKey: string,
    title: string,
    message: string,
  ): Promise<SendOutcome> {
    if (service === "serverchan") {
      // Server酱：POST https://sctapi.ftqq.com/{key}.send
      const { status, json } = await postJson(
        `https://sctapi.ftqq.com/${encodeURIComponent(pushKey)}.send`,
        { title, desp: message },
      );
      if (status < 200 || status >= 300) return classifyHttpFailure(status);
      const code = json?.code;
      if (typeof code === "number" && code !== 0) {
        return businessCodeFailure("Server酱", code, json?.message);
      }
      return { ok: true };
    }
    // PushPlus：POST https://www.pushplus.plus/send
    const { status, json } = await postJson("https://www.pushplus.plus/send", {
      token: pushKey,
      title,
      content: message,
      template: "txt",
    });
    if (status < 200 || status >= 300) return classifyHttpFailure(status);
    const code = json?.code;
    if (typeof code === "number" && code !== 200) {
      return businessCodeFailure("PushPlus", code, json?.msg);
    }
    return { ok: true };
  }
}
