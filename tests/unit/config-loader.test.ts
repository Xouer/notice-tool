import { describe, expect, it, vi } from "vitest";
import { loadConfig } from "../../src/config/loader.js";

/**
 * T004：config loader 单元测试（Red 先行）。
 * 依据 contracts/cli.md 配置结构与默认值：
 * - 默认：127.0.0.1:47650、巡查 10 秒、去重 10 分钟、聚合 30 秒、
 *   perChannelPerMinute 20、retentionDays 30
 * - 未知字段忽略并告警（向前兼容）
 * - 缺字段取默认
 */
describe("config loader / 配置加载（T004）", () => {
  it("空对象输入取全部内置默认值", () => {
    const cfg = loadConfig({});
    expect(cfg).toEqual({
      schemaVersion: 1,
      server: { host: "127.0.0.1", port: 47650 },
      polling: { enabled: true, intervalSeconds: 10, adapters: ["claude-code"] },
      dedup: { cooldownMinutes: 10 },
      antiFlood: { aggregateWindowSeconds: 30, perChannelPerMinute: 20 },
      notify: { channels: [] },
      retentionDays: 30,
    });
  });

  it("JSON 字符串输入解析并合并（缺字段取默认）", () => {
    const cfg = loadConfig(
      JSON.stringify({ retentionDays: 7, server: { port: 9000 } }),
    );
    expect(cfg.retentionDays).toBe(7);
    expect(cfg.server).toEqual({ host: "127.0.0.1", port: 9000 });
    expect(cfg.dedup.cooldownMinutes).toBe(10);
    expect(cfg.antiFlood).toEqual({
      aggregateWindowSeconds: 30,
      perChannelPerMinute: 20,
    });
  });

  it("未知顶层字段忽略并告警", () => {
    const warn = vi.fn();
    const cfg = loadConfig({ someFutureField: true }, warn);
    expect(cfg).toEqual(loadConfig({}));
    expect(warn).toHaveBeenCalled();
    const messages = warn.mock.calls.map((c) => String(c[0]));
    expect(messages.some((m) => m.includes("someFutureField"))).toBe(true);
  });

  it("未知嵌套字段忽略并告警，已知嵌套字段生效", () => {
    const warn = vi.fn();
    const cfg = loadConfig({ server: { host: "0.0.0.0", port: 8080, tls: true } }, warn);
    expect(cfg.server).toEqual({ host: "0.0.0.0", port: 8080 });
    const messages = warn.mock.calls.map((c) => String(c[0]));
    expect(messages.some((m) => m.includes("server.tls"))).toBe(true);
  });

  it("非 JSON 字符串输入抛出配置错误", () => {
    expect(() => loadConfig("not-json{")).toThrow();
  });

  it("notify.channels 指定渠道列表生效", () => {
    const cfg = loadConfig({ notify: { channels: ["feishu-主号", "mail-backup"] } });
    expect(cfg.notify).toEqual({ channels: ["feishu-主号", "mail-backup"] });
  });

  it("notify.channels 缺省取空数组（= 全部已启用渠道）", () => {
    const cfg = loadConfig({});
    expect(cfg.notify).toEqual({ channels: [] });
  });

  it("notify.channels 条目为空字符串抛出配置错误", () => {
    expect(() => loadConfig({ notify: { channels: ["ok", "  "] } })).toThrow(
      "notify.channels 条目必须为非空字符串",
    );
  });

  it("notify.channels 类型错误抛出配置错误", () => {
    expect(() => loadConfig({ notify: { channels: "feishu" } })).toThrow();
    expect(() => loadConfig({ notify: { channels: [1] } })).toThrow(
      "notify.channels 条目必须为非空字符串",
    );
  });
});
