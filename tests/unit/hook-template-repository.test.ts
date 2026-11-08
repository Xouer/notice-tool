import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openMemoryDatabase, type NoticeDatabase } from "../../src/storage/db.js";
import { HookTemplateRepository } from "../../src/storage/hook-template-repository.js";

describe("hook template repository / 钩子模板实例仓储（T005）", () => {
  let db: NoticeDatabase;

  beforeEach(() => {
    db = openMemoryDatabase();
  });

  afterEach(() => {
    db.$client.close();
  });

  it("未实例化时 get 返回 undefined", () => {
    const repo = new HookTemplateRepository(db);
    expect(repo.get("windows-codebuddy")).toBeUndefined();
  });

  it("upsert 新建实例，默认不启动", () => {
    const repo = new HookTemplateRepository(db);
    const row = repo.upsert({
      templateId: "windows-codebuddy",
      platform: "windows",
      agent: "codebuddy",
    });
    expect(row.enabled).toBe(false);
    expect(row.lastValidationStatus).toBe("not_validated");
  });

  it("upsert 更新启用状态（未提供 enabled 时保留原值）", () => {
    const repo = new HookTemplateRepository(db);
    repo.upsert({ templateId: "linux-codex-cli", platform: "linux", agent: "codex-cli" });
    expect(repo.get("linux-codex-cli")?.enabled).toBe(false);
    repo.setEnabled("linux-codex-cli", true);
    expect(repo.get("linux-codex-cli")?.enabled).toBe(true);
    // 未提供 enabled → 保留已启用（validate 等只读操作不得重置状态）
    repo.upsert({ templateId: "linux-codex-cli", platform: "linux", agent: "codex-cli" });
    expect(repo.get("linux-codex-cli")?.enabled).toBe(true);
  });

  it("setValidation 记录验证结果与时间", () => {
    const repo = new HookTemplateRepository(db);
    repo.upsert({ templateId: "macos-codebuddy", platform: "macos", agent: "codebuddy" });
    repo.setValidation("macos-codebuddy", "valid", null);
    const row = repo.get("macos-codebuddy");
    expect(row?.lastValidationStatus).toBe("valid");
    expect(row?.lastValidationAt).not.toBeNull();
  });

  it("customContent 以 JSON 存取", () => {
    const repo = new HookTemplateRepository(db);
    repo.upsert({
      templateId: "windows-codebuddy",
      platform: "windows",
      agent: "codebuddy",
      customContent: { hooks: { Stop: [] } },
    });
    expect(repo.get("windows-codebuddy")?.customContent).toEqual({ hooks: { Stop: [] } });
  });

  it("未提供 customContent 时保留原值（FR-014）", () => {
    const repo = new HookTemplateRepository(db);
    repo.upsert({
      templateId: "windows-codebuddy",
      platform: "windows",
      agent: "codebuddy",
      customContent: { hooks: { Stop: [{ keep: true }] } },
    });
    // 再次 upsert（模拟升级/重复启用）不传 customContent，不应清空
    repo.upsert({ templateId: "windows-codebuddy", platform: "windows", agent: "codebuddy" });
    expect(repo.get("windows-codebuddy")?.customContent).toEqual({
      hooks: { Stop: [{ keep: true }] },
    });
  });

  it("templateVersion 记录并保留（FR-014）", () => {
    const repo = new HookTemplateRepository(db);
    repo.upsert({
      templateId: "windows-codebuddy",
      platform: "windows",
      agent: "codebuddy",
      templateVersion: "1",
    });
    expect(repo.get("windows-codebuddy")?.templateVersion).toBe("1");
    // 未提供 templateVersion 时保留原值
    repo.upsert({ templateId: "windows-codebuddy", platform: "windows", agent: "codebuddy" });
    expect(repo.get("windows-codebuddy")?.templateVersion).toBe("1");
  });
});
