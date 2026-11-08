import { randomUUID } from "node:crypto";
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
      "{{title}}",
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

const OLD_BODY = [
  "【任务完成通知】",
  "任务 {{task_id}}（来源 {{source_agent}}）已结束",
  "结果：{{result_status}}",
  "结束时间：{{finished_at}}",
  "概要：{{result_summary}}",
].join("\n");

describe("default template migration / 默认模板升级（T017）", () => {
  it("新默认模板含 {{title}} 且结构固定（标题 → 任务 → 结果 → 时间 → 概要）", () => {
    const db = openMemoryDatabase();
    seedDefaultTemplates(db);
    const generic = db
      .select()
      .from(notificationTemplates)
      .where(eq(notificationTemplates.name, "default-generic"))
      .get();
    expect(generic).toBeDefined();
    const lines = generic!.body.split("\n");
    expect(lines[0]).toBe("【任务完成通知】");
    expect(lines[1]).toBe("标题：{{title}}");
    expect(lines[2]).toBe("任务 {{task_id}}（来源 {{source_agent}}）已结束");
    expect(lines[3]).toBe("结果：{{result_status}}");
    expect(lines[4]).toBe("结束时间：{{finished_at}}");
    expect(lines[5]).toBe("概要：{{result_summary}}");
  });

  it("存量旧内置正文被升级为新正文", () => {
    const db = openMemoryDatabase();
    const now = new Date();
    // 预置一个旧内置默认模板
    db.insert(notificationTemplates)
      .values({
        id: randomUUID(),
        name: "default-generic",
        channelType: null,
        body: OLD_BODY,
        isDefault: true,
        isBuiltin: true,
        createdAt: now,
        updatedAt: now,
      })
      .run();
    seedDefaultTemplates(db);
    const generic = db
      .select()
      .from(notificationTemplates)
      .where(eq(notificationTemplates.name, "default-generic"))
      .get();
    expect(generic!.body).toContain("标题：{{title}}");
    expect(generic!.body).not.toBe(OLD_BODY);
  });

  it("用户自定义正文（≠旧内置正文）不被覆盖", () => {
    const db = openMemoryDatabase();
    const now = new Date();
    const custom = "自定义模板 {{task_id}} 完成";
    db.insert(notificationTemplates)
      .values({
        id: randomUUID(),
        name: "default-generic",
        channelType: null,
        body: custom,
        isDefault: true,
        isBuiltin: true,
        createdAt: now,
        updatedAt: now,
      })
      .run();
    seedDefaultTemplates(db);
    const generic = db
      .select()
      .from(notificationTemplates)
      .where(eq(notificationTemplates.name, "default-generic"))
      .get();
    expect(generic!.body).toBe(custom);
  });
});
