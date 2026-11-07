import { describe, expect, it } from "vitest";
import { openMemoryDatabase } from "../../src/storage/db.js";
import {
  BuiltinTemplateError,
  BUILT_IN_TEMPLATE_NAMES,
  seedDefaultTemplates,
} from "../../src/storage/seed.js";
import { notificationTemplates } from "../../src/storage/schema.js";
import { eq } from "drizzle-orm";

/**
 * T007：默认模板 seeding 单元测试（Red 先行，宪法 II）。
 * - 每渠道恰好一个默认模板 + 一个通用默认模板
 * - is_default 标记
 * - 重复执行幂等
 * - 内置模板删除被拒
 */
const CHANNEL_TYPES = ["feishu", "dingtalk", "email", "wechat", "qq"] as const;

describe("default template seeding / 默认模板播种（T007）", () => {
  it("seed 后恰好 6 个模板：五渠道各一 + 一个通用", () => {
    const db = openMemoryDatabase();
    seedDefaultTemplates(db);
    const rows = db.select().from(notificationTemplates).all();
    expect(rows).toHaveLength(6);
  });

  it("每渠道恰好一个默认模板且带 is_default 标记", () => {
    const db = openMemoryDatabase();
    seedDefaultTemplates(db);
    const rows = db.select().from(notificationTemplates).all();
    for (const type of CHANNEL_TYPES) {
      const defaults = rows.filter(
        (r) => r.channelType === type && r.isDefault === true,
      );
      expect(defaults).toHaveLength(1);
    }
  });

  it("恰好一个通用默认模板（channel_type 为空）", () => {
    const db = openMemoryDatabase();
    seedDefaultTemplates(db);
    const rows = db.select().from(notificationTemplates).all();
    const genericDefaults = rows.filter(
      (r) => r.channelType === null && r.isDefault === true,
    );
    expect(genericDefaults).toHaveLength(1);
  });

  it("重复执行幂等：不产生重复模板", () => {
    const db = openMemoryDatabase();
    seedDefaultTemplates(db);
    seedDefaultTemplates(db);
    seedDefaultTemplates(db);
    const rows = db.select().from(notificationTemplates).all();
    expect(rows).toHaveLength(6);
    for (const type of CHANNEL_TYPES) {
      const defaults = rows.filter(
        (r) => r.channelType === type && r.isDefault === true,
      );
      expect(defaults).toHaveLength(1);
    }
  });

  it("内置模板删除被拒", () => {
    const db = openMemoryDatabase();
    seedDefaultTemplates(db);
    const builtin = db
      .select()
      .from(notificationTemplates)
      .where(eq(notificationTemplates.name, "default-feishu"))
      .get();
    expect(builtin).toBeDefined();
    expect(BUILT_IN_TEMPLATE_NAMES.has("default-feishu")).toBe(true);
    // 删除守卫：内置模板抛出 BuiltinTemplateError
    expect(() =>
      builtin ? BuiltinTemplateError.assertDeletable(builtin.name) : undefined,
    ).toThrow(BuiltinTemplateError);
    // 非内置模板允许删除
    expect(() =>
      BuiltinTemplateError.assertDeletable("my-custom-template"),
    ).not.toThrow();
  });

  it("内置模板正文仅含白名单占位符", () => {
    const db = openMemoryDatabase();
    seedDefaultTemplates(db);
    const rows = db.select().from(notificationTemplates).all();
    const allowed = [
      "{{task_id}}",
      "{{source_agent}}",
      "{{result_status}}",
      "{{finished_at}}",
      "{{result_summary}}",
    ];
    for (const row of rows) {
      const placeholders = row.body.match(/\{\{[^}]+\}\}/g) ?? [];
      for (const p of placeholders) {
        expect(allowed).toContain(p);
      }
    }
  });
});
