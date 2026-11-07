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
 * QQ 适配器（T025，research.md R6）：
 * - official 模式：QQ 官方机器人（appId/appSecret 换取 access token 后调用消息接口）
 * - push 模式：PushPlus 等第三方推送服务
 */
export class QqAdapter implements ChannelAdapter {
  readonly type = "qq" as const;

  async send(
    payload: SendPayload,
    credentials: Record<string, unknown>,
  ): Promise<SendOutcome> {
    try {
      const mode = credentials.mode === "push" ? "push" : "official";
      if (mode === "official") {
        return await this.#sendOfficial(
          String(credentials.appId),
          String(credentials.appSecret),
          String(credentials.endpoint),
          plainText(payload),
        );
      }
      return await this.#sendPushPlus(
        String(credentials.pushKey),
        payload.title ?? "notice 通知",
        plainText(payload),
      );
    } catch (cause) {
      return classifyNetworkFailure(cause);
    }
  }

  async #sendOfficial(
    appId: string,
    appSecret: string,
    endpoint: string,
    message: string,
  ): Promise<SendOutcome> {
    // 1. 换取 access token（QQ 开放平台机器人接口）
    const tokenRes = await postJson("https://bots.qq.com/app/getAppAccessToken", {
      appId,
      clientSecret: appSecret,
    });
    if (tokenRes.status < 200 || tokenRes.status >= 300) {
      return classifyHttpFailure(tokenRes.status);
    }
    const accessToken = tokenRes.json?.accessToken;
    if (typeof accessToken !== "string" || accessToken === "") {
      return { ok: false, errorCode: "AUTH_INVALID", message: "QQ 机器人 access token 获取失败" };
    }
    // 2. 调用消息接口（endpoint 由用户配置为完整消息 API URL）
    const sendRes = await postJson(
      endpoint,
      { content: message, msg_type: 0 },
      { Authorization: `QQBot ${accessToken}` },
    );
    if (sendRes.status < 200 || sendRes.status >= 300) {
      return classifyHttpFailure(sendRes.status);
    }
    return { ok: true };
  }

  async #sendPushPlus(
    pushKey: string,
    title: string,
    message: string,
  ): Promise<SendOutcome> {
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
