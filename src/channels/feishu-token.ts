/**
 * 飞书 tenant_access_token 提供者（002-T008，research.md R2）：
 * - 单进程内存缓存 Map<appId, TokenEntry>，按接口返回的 expire 过期续取（5 分钟保险余量）
 * - 同 appId 更换 appSecret（密钥轮换）→ 不复用旧缓存
 * - 令牌仅驻内存，不落盘、不进日志（FR-106）
 * - fetch 与时钟可注入，测试友好（宪法 II）
 *
 * 令牌接口（research.md R1）：
 * POST {baseUrl}/open-apis/auth/v3/tenant_access_token/internal
 * body { app_id, app_secret } → { code, msg, tenant_access_token, expire(秒) }
 */
import type { ErrorCode } from "../storage/schema.js";

const DEFAULT_BASE_URL = "https://open.feishu.cn";
/** 过期保险余量：提前 5 分钟判定过期。 */
const EXPIRY_MARGIN_MS = 5 * 60 * 1000;

export type TokenResult =
  | { ok: true; token: string }
  | { ok: false; errorCode: ErrorCode; message: string };

export interface FeishuTokenProviderDeps {
  fetchImpl?: typeof fetch;
  /** 返回当前毫秒时间戳（默认 Date.now）。 */
  now?: () => number;
  /** 开放平台基地址（默认官方域名；测试经 NOTICE_FEISHU_API_BASE 或显式注入覆盖）。 */
  baseUrl?: string;
}

export interface FeishuTokenProvider {
  getToken(appId: string, appSecret: string): Promise<TokenResult>;
  /** 清空指定 appId 的缓存（令牌被服务端判定失效时由适配器调用）。 */
  invalidate(appId: string): void;
}

interface TokenEntry {
  token: string;
  /** 毫秒时间戳 = 获取时刻 + expire*1000 - 保险余量。 */
  expiresAt: number;
  /** 缓存生成时的 appSecret（轮换检测：密钥变更即视为缓存失效）。 */
  secret: string;
}

function resolveBaseUrl(deps: FeishuTokenProviderDeps): string {
  return (
    deps.baseUrl ??
    process.env["NOTICE_FEISHU_API_BASE"] ??
    DEFAULT_BASE_URL
  ).replace(/\/$/, "");
}

/** 开放平台基地址解析（令牌与消息接口共用；env 仅测试覆盖用）。 */
export function resolveFeishuBaseUrl(): string {
  return resolveBaseUrl({});
}

export function createFeishuTokenProvider(
  deps: FeishuTokenProviderDeps = {},
): FeishuTokenProvider {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const now = deps.now ?? Date.now;
  const cache = new Map<string, TokenEntry>();

  const provider: FeishuTokenProvider = {
    async getToken(appId: string, appSecret: string): Promise<TokenResult> {
      const cached = cache.get(appId);
      if (
        cached !== undefined &&
        cached.secret === appSecret &&
        now() < cached.expiresAt
      ) {
        return { ok: true, token: cached.token };
      }
      const url = `${resolveBaseUrl(deps)}/open-apis/auth/v3/tenant_access_token/internal`;
      let status: number;
      let json: Record<string, unknown> | null;
      try {
        const res = await fetchImpl(url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
        });
        status = res.status;
        try {
          json = (await res.json()) as Record<string, unknown>;
        } catch {
          json = null;
        }
      } catch (cause) {
        const detail =
          cause instanceof Error ? cause.message.split("\n")[0] ?? "" : "未知错误";
        return {
          ok: false,
          errorCode: "NETWORK_UNREACHABLE",
          message: `飞书令牌接口请求失败：${detail}`,
        };
      }
      const code = json?.code;
      const token = json?.tenant_access_token;
      const expire = json?.expire;
      if (
        status >= 200 &&
        status < 300 &&
        code === 0 &&
        typeof token === "string" &&
        token.length > 0
      ) {
        // expire 以接口响应为准（秒），不硬编码（spec 假设）
        const expireSeconds =
          typeof expire === "number" && expire > 0 ? expire : 7200;
        cache.set(appId, {
          token,
          expiresAt: now() + expireSeconds * 1000 - EXPIRY_MARGIN_MS,
          secret: appSecret,
        });
        return { ok: true, token };
      }
      // code != 0：凭证无效/被撤销（脱敏：不回传 msg 原文与 secret）
      return {
        ok: false,
        errorCode: "AUTH_INVALID",
        message: "飞书凭证无效或已失效，请检查开放平台应用凭据（App ID / App Secret）",
      };
    },
    invalidate(appId: string): void {
      cache.delete(appId);
    },
  };
  return provider;
}

/** 默认共享实例：同进程内所有飞书 app 模式渠道共享令牌缓存。 */
export const feishuTokenProvider: FeishuTokenProvider =
  createFeishuTokenProvider();

/** 测试专用：重置默认实例的令牌缓存（避免跨用例污染）。 */
export function clearFeishuTokenCacheForTests(): void {
  Object.assign(feishuTokenProvider, createFeishuTokenProvider(depsOfDefault));
}

/** 记录默认实例创建时的依赖（测试重置后保持相同行为，如 env 基地址读取）。 */
const depsOfDefault: FeishuTokenProviderDeps = {};
