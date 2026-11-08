import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { HookConfigManager } from "../../src/hooks/manager.js";
import { openMemoryDatabase, type NoticeDatabase } from "../../src/storage/db.js";
import { HookTemplateRepository } from "../../src/storage/hook-template-repository.js";
import type { HookAgent, HookPlatform } from "../../src/hooks/types.js";

interface ManagerOverrides {
  platform?: HookPlatform;
  isInstalled?: (agent: HookAgent) => boolean;
}

describe("hook config manager / 钩子配置编排（FR-013/014/015）", () => {
  let home: string;
  let db: NoticeDatabase;
  let repo: HookTemplateRepository;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "notice-mgr-"));
    db = openMemoryDatabase();
    repo = new HookTemplateRepository(db);
  });

  afterEach(() => {
    db.$client.close();
    rmSync(home, { recursive: true, force: true });
  });

  function makeManager(overrides: ManagerOverrides = {}) {
    return new HookConfigManager({
      homeDir: home,
      repository: repo,
      db,
      platform: overrides.platform ?? "windows",
      isInstalled: overrides.isInstalled,
    });
  }

  it("FR-013：platformMatches 按当前平台标识", () => {
    const manager = makeManager();
    expect(manager.show("windows-codebuddy").platformMatches).toBe(true);
    expect(manager.show("linux-codebuddy").platformMatches).toBe(false);
    expect(manager.show("macos-codex-cli").platformMatches).toBe(false);
  });

  it("FR-013：installed 反映注入的安装检测", () => {
    expect(makeManager({ isInstalled: () => false }).show("windows-codebuddy").installed).toBe(
      false,
    );
    expect(makeManager({ isInstalled: () => true }).show("windows-codebuddy").installed).toBe(true);
  });

  it("FR-013：validate 对平台不匹配返回 invalid 并说明原因", () => {
    const result = makeManager().validate("linux-codebuddy");
    expect(result.status).toBe("invalid");
    expect(result.message).toContain("linux");
    expect(result.message).toContain("windows");
  });

  it("FR-014：enable 记录模板版本，版本落后时 versionMismatch=true", () => {
    const manager = makeManager();
    manager.enable("windows-codebuddy", { confirm: false });
    expect(manager.show("windows-codebuddy").versionMismatch).toBe(false);
    repo.upsert({
      templateId: "windows-codebuddy",
      platform: "windows",
      agent: "codebuddy",
      templateVersion: "0",
    });
    expect(manager.show("windows-codebuddy").versionMismatch).toBe(true);
  });

  it("FR-015：status 输出四类诊断字段（空库：无事件/无通知）", () => {
    const manager = makeManager();
    manager.enable("windows-codebuddy", { confirm: false });
    const s = manager.status("windows-codebuddy");
    expect(s.enabled).toBe(true);
    expect(s.hookValid).toBe("valid");
    expect(s.platformMatches).toBe(true);
    expect(s.recentEvent.found).toBe(false);
    expect(s.recentNotification.found).toBe(false);
  });
});
