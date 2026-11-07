import type { ChannelAdapter, SendOutcome, SendPayload } from "./adapter.js";

/**
 * 邮箱 SMTP 适配器（T023）：nodemailer，SMTP 授权码模型。
 * 错误分类：EAUTH → AUTH_INVALID；连接/DNS 类 → NETWORK_UNREACHABLE；其余 UNKNOWN。
 * nodemailer 重量级依赖仅在发送时加载（内存优化）。
 */
export class EmailAdapter implements ChannelAdapter {
  readonly type = "email" as const;

  async send(
    payload: SendPayload,
    credentials: Record<string, unknown>,
  ): Promise<SendOutcome> {
    const nodemailer = (await import("nodemailer")).default;
    const host = String(credentials.smtpHost);
    const port = typeof credentials.smtpPort === "number" ? credentials.smtpPort : 465;
    const username = typeof credentials.username === "string" ? credentials.username : "";
    const authCode = String(credentials.authCode);
    const from = typeof credentials.from === "string" && credentials.from !== ""
      ? credentials.from
      : username;
    const to = String(credentials.to);

    const transport = nodemailer.createTransport({
      host,
      port,
      secure: port === 465,
      auth: username === "" ? undefined : { user: username, pass: authCode },
    });
    try {
      await transport.sendMail({
        from,
        to,
        subject: payload.title ?? "notice 通知",
        text: payload.message,
      });
      return { ok: true };
    } catch (cause) {
      const code = (cause as { code?: string }).code ?? "";
      if (code === "EAUTH" || code === "ESMTP") {
        return { ok: false, errorCode: "AUTH_INVALID", message: "SMTP 认证失败（授权码或账号无效）" };
      }
      if (
        code === "ECONNECTION" ||
        code === "ECONNREFUSED" ||
        code === "ETIMEDOUT" ||
        code === "EDNS" ||
        code === "EHOSTUNREACH" ||
        code === "ENOTFOUND"
      ) {
        return { ok: false, errorCode: "NETWORK_UNREACHABLE", message: "SMTP 服务器不可达" };
      }
      return { ok: false, errorCode: "UNKNOWN", message: `邮件发送失败（${code || "未知错误"}）` };
    } finally {
      transport.close();
    }
  }
}
