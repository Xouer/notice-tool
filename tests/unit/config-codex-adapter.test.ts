import { describe, expect, it } from "vitest";
import { loadConfig, ConfigError } from "../../src/config/loader.js";
import { buildAdapters } from "../../src/pollers/index.js";
import { AgentStatusError } from "../../src/pollers/adapter.js";

/**
 * T014：polling.adapters 新增可选 codex-cli 条目的配置校验（Red 先行，US3）。
 * 向后兼容：旧配置（无该条目）行为不变（宪法 III）。
 */
describe("config codex-cli adapter / codex-cli 巡查配置校验（T014，US3）", () => {
  it("字符串注册名 codex-cli 可接受", () => {
    const config = loadConfig({ polling: { enabled: true, adapters: ["codex-cli"] } });
    expect(config.polling.adapters).toEqual(["codex-cli"]);
  });

  it("对象形式 { name: codex-cli, sessionsDir } 可接受且 sessionsDir 可选", () => {
    const withDir = loadConfig({
      polling: {
        enabled: true,
        adapters: [{ name: "codex-cli", sessionsDir: "C:/fake/.codex/sessions" }],
      },
    });
    expect(withDir.polling.adapters).toEqual([
      { name: "codex-cli", sessionsDir: "C:/fake/.codex/sessions" },
    ]);
    const withoutDir = loadConfig({
      polling: { enabled: true, adapters: [{ name: "codex-cli" }] },
    });
    expect(withoutDir.polling.adapters).toEqual([{ name: "codex-cli" }]);
  });

  it("sessionsDir 类型非法 → ConfigError", () => {
    expect(() =>
      loadConfig({
        polling: { enabled: true, adapters: [{ name: "codex-cli", sessionsDir: 123 }] },
      }),
    ).toThrow(ConfigError);
  });

  it("旧配置（无 codex-cli 条目）行为不变", () => {
    const config = loadConfig({});
    expect(config.polling.adapters).toEqual(["claude-code"]);
  });

  it("未知适配器名在构建适配器时被拒绝（loadConfig 仅校验非空字符串）", () => {
    expect(() => buildAdapters(["no-such-adapter"])).toThrow(AgentStatusError);
  });
});
