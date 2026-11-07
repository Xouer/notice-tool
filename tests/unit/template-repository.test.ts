import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { TemplateRepository } from "../../src/storage/template-repository.js";
import { BuiltinTemplateError, seedDefaultTemplates } from "../../src/storage/seed.js";
import { TemplateError } from "../../src/core/template.js";
import { openMemoryDatabase } from "../../src/storage/db.js";
import {
  notificationRecords,
  taskEvents,
} from "../../src/storage/schema.js";

/**
 * T032：模板仓储校验单元测试（Red 先行）。
 * 未知占位符保存即拒绝、正文 ≤2000、每渠道至多一个 is_default、内置模板不可删除。
 */
function makeRepos() {
  const db = openMemoryDatabase();
  seedDefaultTemplates(db);
  return { db, templates: new TemplateRepository(db) };
}

describe("template repository / 模板仓储（T032）", () => {
  it("未知占位符保存即拒绝", () => {
    const { templates } = makeRepos();
    expect(() =>
      templates.create({ name: "bad", channelType: "feishu", body: "hi {{foo}}" }),
    ).toThrow(TemplateError);
  });

  it("正文超 2000 字符拒绝", () => {
    const { templates } = makeRepos();
    expect(() =>
      templates.create({ name: "long", channelType: null, body: "x".repeat(2001) }),
    ).toThrow(TemplateError);
  });

  it("创建自定义模板成功且非默认非内置", () => {
    const { templates } = makeRepos();
    const t = templates.create({
      name: "my-tpl",
      channelType: "feishu",
      body: "{{task_id}} 已完成",
    });
    expect(t.name).toBe("my-tpl");
    expect(t.isDefault).toBe(false);
    expect(t.isBuiltin).toBe(false);
  });

  it("每渠道至多一个 is_default（setDefault 互斥）", () => {
    const { templates } = makeRepos();
    const a = templates.create({ name: "fa", channelType: "feishu", body: "{{task_id}}" });
    templates.setDefault(a.id);
    expect(templates.get(a.id)?.isDefault).toBe(true);
    const b = templates.create({ name: "fb", channelType: "feishu", body: "{{task_id}}!" });
    templates.setDefault(b.id);
    expect(templates.get(b.id)?.isDefault).toBe(true);
    expect(templates.get(a.id)?.isDefault).toBe(false);
  });

  it("通用默认同样互斥（含内置 default-generic）", () => {
    const { templates } = makeRepos();
    const g = templates.create({ name: "my-generic", channelType: null, body: "{{task_id}}" });
    templates.setDefault(g.id);
    expect(templates.get(g.id)?.isDefault).toBe(true);
    expect(templates.findByName("default-generic")?.isDefault).toBe(false);
  });

  it("内置模板不可删除", () => {
    const { templates } = makeRepos();
    const builtin = templates.findByName("default-feishu");
    expect(builtin).toBeDefined();
    expect(() => templates.remove(builtin!.id)).toThrow(BuiltinTemplateError);
  });

  it("非内置模板可删除且历史记录引用置空", () => {
    const { db, templates } = makeRepos();
    const t = templates.create({ name: "del-me", channelType: null, body: "{{task_id}}" });
    const now = new Date();
    const eventId = randomUUID();
    db.insert(taskEvents)
      .values({
        id: eventId,
        sourceAgent: "demo",
        taskId: "t",
        finishedAt: now,
        resultStatus: "success",
        triggerType: "hook",
        receivedAt: now,
        notifyStatus: "dispatched",
      })
      .run();
    db.insert(notificationRecords)
      .values({
        id: randomUUID(),
        eventId,
        templateId: t.id,
        status: "sent",
        attempts: 1,
        createdAt: now,
        updatedAt: now,
      })
      .run();
    templates.remove(t.id);
    expect(templates.get(t.id)).toBeUndefined();
    const record = db.select().from(notificationRecords).get();
    expect(record?.templateId).toBeNull();
  });
});
