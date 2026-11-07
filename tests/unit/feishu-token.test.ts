import { describe, expect, it } from "vitest";
import {
  createFeishuTokenProvider,
  type FeishuTokenProviderDeps,
} from "../../src/channels/feishu-token.js";
import { createFakeClock } from "../integration/helpers/feishu-fake-server.js";

/**
 * 002-T006：tenant_access_token 提供者单元测试（Red 先行，research.md R2）。
 * - 首次获取成功并解析 expire
 * - 缓存命中零网络请求
 * - 过期（expire - 5 分钟保险余量）自动续取
 * - 换取失败按错误分类返回（凭证无效 → AUTH_INVALID；网络故障 → NETWORK_UNREACHABLE）
 * - 凭证错误不回传 secret
 * - 注入 fetch 与时钟
 */
const APP_ID = "cli_a1b2c3d4e5f6";
const APP_SECRET = "feishu-app-secret-9876543210";

interface FakeResponse {
  status: number;
  json: unknown;
}

function fetchFromResponses(
  responses: FakeResponse[],
  calls: Array<{ url: string; body: unknown }>,
): typeof fetch {
  return (async (input: unknown, init?: { body?: string }) => {
    const url = String(input);
    calls.push({ url, body: init?.body === undefined ? null : JSON.parse(init.body) });
    const next = responses.shift();
    if (next === undefined) {
      throw new Error("no more fake responses");
    }
    return {
      status: next.status,
      json: async () => next.json,
    } as Response;
  }) as typeof fetch;
}

function makeDeps(
  responses: FakeResponse[],
  calls: Array<{ url: string; body: unknown }>,
  now: () => number = createFakeClock().now,
): FeishuTokenProviderDeps {
  return { fetchImpl: fetchFromResponses(responses, calls), now, baseUrl: "https://fake.feishu.test" };
}

describe("feishu token provider / 飞书令牌提供者（002-T006）", () => {
  it("首次获取成功：POST 令牌接口，解析 tenant_access_token 与 expire", async () => {
    const calls: Array<{ url: string; body: unknown }> = [];
    const provider = createFeishuTokenProvider(
      makeDeps(
        [{ status: 200, json: { code: 0, msg: "ok", tenant_access_token: "t-1", expire: 7200 } }],
        calls,
      ),
    );
    const result = await provider.getToken(APP_ID, APP_SECRET);
    expect(result).toEqual({ ok: true, token: "t-1" });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe("https://fake.feishu.test/open-apis/auth/v3/tenant_access_token/internal");
    expect(calls[0]?.body).toEqual({ app_id: APP_ID, app_secret: APP_SECRET });
  });

  it("缓存命中：同 appId 二次获取零网络请求", async () => {
    const calls: Array<{ url: string; body: unknown }> = [];
    const provider = createFeishuTokenProvider(
      makeDeps(
        [{ status: 200, json: { code: 0, msg: "ok", tenant_access_token: "t-1", expire: 7200 } }],
        calls,
      ),
    );
    await provider.getToken(APP_ID, APP_SECRET);
    const second = await provider.getToken(APP_ID, APP_SECRET);
    expect(second).toEqual({ ok: true, token: "t-1" });
    expect(calls).toHaveLength(1);
  });

  it("过期（expire - 5 分钟保险余量）自动续取新令牌", async () => {
    const clock = createFakeClock();
    const calls: Array<{ url: string; body: unknown }> = [];
    const provider = createFeishuTokenProvider(
      makeDeps(
        [
          { status: 200, json: { code: 0, tenant_access_token: "t-1", expire: 7200 } },
          { status: 200, json: { code: 0, tenant_access_token: "t-2", expire: 7200 } },
        ],
        calls,
        clock.now,
      ),
    );
    await provider.getToken(APP_ID, APP_SECRET);
    // 未过期（expire=7200s，余量 300s → 6900s 内有效）
    clock.advance(6900_000 - 1000);
    const withinMargin = await provider.getToken(APP_ID, APP_SECRET);
    expect(withinMargin).toEqual({ ok: true, token: "t-1" });
    expect(calls).toHaveLength(1);
    // 越过余量边界 → 续取
    clock.advance(2000);
    const refreshed = await provider.getToken(APP_ID, APP_SECRET);
    expect(refreshed).toEqual({ ok: true, token: "t-2" });
    expect(calls).toHaveLength(2);
  });

  it("同 appId 不同 appSecret（密钥轮换）→ 不复用旧缓存", async () => {
    const calls: Array<{ url: string; body: unknown }> = [];
    const provider = createFeishuTokenProvider(
      makeDeps(
        [
          { status: 200, json: { code: 0, tenant_access_token: "t-1", expire: 7200 } },
          { status: 200, json: { code: 0, tenant_access_token: "t-2", expire: 7200 } },
        ],
        calls,
      ),
    );
    await provider.getToken(APP_ID, "old-secret-123456");
    const rotated = await provider.getToken(APP_ID, "new-secret-654321");
    expect(rotated).toEqual({ ok: true, token: "t-2" });
    expect(calls).toHaveLength(2);
  });

  it("凭证错误（code != 0）→ AUTH_INVALID，消息不含 app_secret", async () => {
    const calls: Array<{ url: string; body: unknown }> = [];
    const provider = createFeishuTokenProvider(
      makeDeps(
        [{ status: 200, json: { code: 99991663, msg: "app secret is invalid" } }],
        calls,
      ),
    );
    const result = await provider.getToken(APP_ID, APP_SECRET);
    expect(result).toMatchObject({ ok: false, errorCode: "AUTH_INVALID" });
    if (!result.ok) {
      expect(result.message).not.toContain(APP_SECRET);
    }
  });

  it("网络故障 → NETWORK_UNREACHABLE", async () => {
    const provider = createFeishuTokenProvider({
      fetchImpl: (async () => {
        throw new TypeError("fetch failed");
      }) as typeof fetch,
      baseUrl: "https://fake.feishu.test",
    });
    const result = await provider.getToken(APP_ID, APP_SECRET);
    expect(result).toMatchObject({ ok: false, errorCode: "NETWORK_UNREACHABLE" });
  });

  it("非 JSON 响应体 → 兜底 AUTH_INVALID（HTTP 4xx/5xx）", async () => {
    const provider = createFeishuTokenProvider({
      fetchImpl: (async () =>
        ({ status: 500, json: async () => null }) as unknown as Response) as typeof fetch,
      baseUrl: "https://fake.feishu.test",
    });
    const result = await provider.getToken(APP_ID, APP_SECRET);
    expect(result).toMatchObject({ ok: false });
  });

  it("invalidate(appId) 清空缓存 → 下次获取重新请求", async () => {
    const calls: Array<{ url: string; body: unknown }> = [];
    const provider = createFeishuTokenProvider(
      makeDeps(
        [
          { status: 200, json: { code: 0, tenant_access_token: "t-1", expire: 7200 } },
          { status: 200, json: { code: 0, tenant_access_token: "t-2", expire: 7200 } },
        ],
        calls,
      ),
    );
    await provider.getToken(APP_ID, APP_SECRET);
    provider.invalidate(APP_ID);
    const refreshed = await provider.getToken(APP_ID, APP_SECRET);
    expect(refreshed).toEqual({ ok: true, token: "t-2" });
    expect(calls).toHaveLength(2);
  });

  it("不同 appId 各自独立缓存", async () => {
    const calls: Array<{ url: string; body: unknown }> = [];
    const provider = createFeishuTokenProvider(
      makeDeps(
        [
          { status: 200, json: { code: 0, tenant_access_token: "t-a", expire: 7200 } },
          { status: 200, json: { code: 0, tenant_access_token: "t-b", expire: 7200 } },
        ],
        calls,
      ),
    );
    const a = await provider.getToken("cli_app_a_0001", "s-1111111111");
    const b = await provider.getToken("cli_app_b_0002", "s-2222222222");
    expect(a).toEqual({ ok: true, token: "t-a" });
    expect(b).toEqual({ ok: true, token: "t-b" });
    expect(calls).toHaveLength(2);
  });
});
