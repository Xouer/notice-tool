import { createServer, type IncomingMessage, type Server } from "node:http";

/**
 * T001：飞书开放平台假服务测试基建（specs/002-feishu-app-credential tasks.md）。
 * 模拟两个接口（research.md R1）：
 * - POST /open-apis/auth/v3/tenant_access_token/internal（令牌换取）
 * - POST /open-apis/im/v1/messages?receive_id_type=...（消息发送）
 * 场景注入：成功 / 凭证错误 / 权限不足 / 机器人不在会话 / 限流 / 令牌失效一次 / HTTP 错误。
 * 全部端点仅在 127.0.0.1 随机端口，无真实外联。
 */

/** 飞书开放平台错误码表（T009 实现期核对项，与 src/channels/feishu.ts 映射表一致）。 */
export const FEISHU_CODES = {
  /** 令牌无效/过期（触发适配器清缓存重取一次） */
  TOKEN_EXPIRED: 99991661,
  TOKEN_INVALID: 99991663,
  TOKEN_EXPIRED_ALT: 99991668,
  /** 缺少 im:message 权限 / 应用不可用 */
  NO_PERMISSION: 99991672,
  /** 应用机器人不在目标会话 */
  BOT_NOT_IN_CHAT: 230002,
  /** 接收目标不存在 */
  TARGET_NOT_FOUND: 230013,
  /** 应用请求过快（限流） */
  RATE_LIMITED: 99991400,
} as const;

export type TokenBehavior = "ok" | "invalid-credential" | "http-500";
export type MessageBehavior =
  | "ok"
  | "token-expired-once"
  | "no-permission"
  | "bot-not-in-chat"
  | "target-not-found"
  | "rate-limited"
  | "http-500"
  | "non-json";

export interface FeishuFakeOptions {
  tokenBehavior?: TokenBehavior;
  messageBehavior?: MessageBehavior;
  /** 令牌有效期秒数（默认 7200）。 */
  tokenExpireSeconds?: number;
}

export interface ReceivedMessage {
  receiveIdType: string;
  authorization: string;
  body: Record<string, unknown>;
}

export interface FeishuFakeServer {
  port: number;
  close(): void;
  /** 调用计数（供断言缓存命中/重试次数）。 */
  calls: { token: number; message: number };
  receivedMessages: ReceivedMessage[];
  /** 最近一次令牌接口请求体（app_id/app_secret）。 */
  lastTokenBody: Record<string, unknown> | null;
  /** 已发放令牌列表（按发放顺序）。 */
  issuedTokens: string[];
}

export function startFeishuFakeServer(
  options: FeishuFakeOptions = {},
): Promise<FeishuFakeServer> {
  const state: FeishuFakeServer = {
    port: 0,
    close: () => {},
    calls: { token: 0, message: 0 },
    receivedMessages: [],
    lastTokenBody: null,
    issuedTokens: [],
  };
  let messageTokenExpiredSent = false;
  let tokenCounter = 0;

  const server: Server = createServer((req: IncomingMessage, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c as Buffer));
    req.on("end", () => {
      const body = Buffer.concat(chunks).toString("utf8");
      const url = req.url ?? "";
      const respond = (code: number, obj: unknown): void => {
        res.statusCode = code;
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify(obj));
      };

      if (url.includes("/auth/v3/tenant_access_token/internal")) {
        state.calls.token += 1;
        state.lastTokenBody = body === "" ? null : (JSON.parse(body) as Record<string, unknown>);
        if (options.tokenBehavior === "http-500") {
          respond(500, { error: "internal" });
          return;
        }
        if (options.tokenBehavior === "invalid-credential") {
          respond(200, { code: FEISHU_CODES.TOKEN_INVALID, msg: "app secret is invalid" });
          return;
        }
        tokenCounter += 1;
        const token = `t-fake-token-${tokenCounter}`;
        state.issuedTokens.push(token);
        respond(200, {
          code: 0,
          msg: "ok",
          tenant_access_token: token,
          expire: options.tokenExpireSeconds ?? 7200,
        });
        return;
      }

      if (url.includes("/im/v1/messages")) {
        state.calls.message += 1;
        if (options.messageBehavior === "non-json") {
          res.statusCode = 200;
          res.end("not-json");
          return;
        }
        state.receivedMessages.push({
          receiveIdType: new URL(url, "http://x").searchParams.get("receive_id_type") ?? "",
          authorization: String(req.headers.authorization ?? ""),
          body: body === "" ? {} : (JSON.parse(body) as Record<string, unknown>),
        });
        if (options.messageBehavior === "http-500") {
          respond(500, { error: "internal" });
          return;
        }
        if (
          options.messageBehavior === "token-expired-once" &&
          !messageTokenExpiredSent
        ) {
          messageTokenExpiredSent = true;
          respond(200, { code: FEISHU_CODES.TOKEN_EXPIRED, msg: "tenant access token expired" });
          return;
        }
        if (options.messageBehavior === "no-permission") {
          respond(200, { code: FEISHU_CODES.NO_PERMISSION, msg: "permission denied: im:message" });
          return;
        }
        if (options.messageBehavior === "bot-not-in-chat") {
          respond(200, { code: FEISHU_CODES.BOT_NOT_IN_CHAT, msg: "bot not in chat" });
          return;
        }
        if (options.messageBehavior === "target-not-found") {
          respond(200, { code: FEISHU_CODES.TARGET_NOT_FOUND, msg: "receive_id not found" });
          return;
        }
        if (options.messageBehavior === "rate-limited") {
          respond(200, { code: FEISHU_CODES.RATE_LIMITED, msg: "too many requests" });
          return;
        }
        respond(200, {
          code: 0,
          data: { message_id: "om_fake_message_id" },
        });
        return;
      }

      respond(404, { code: 404, msg: "not found" });
    });
  });

  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      state.port = typeof addr === "object" && addr !== null ? addr.port : 0;
      state.close = () => server.close();
      resolve(state);
    });
  });
}

/** 可注入假时钟（供令牌过期边界测试）。 */
export function createFakeClock(startMs = 1_000_000_000_000): {
  now: () => number;
  advance: (ms: number) => void;
} {
  let current = startMs;
  return {
    now: () => current,
    advance: (ms: number) => {
      current += ms;
    },
  };
}
