import { describe, expect, it } from "vitest";
import {
  PLACEHOLDERS,
  TemplateError,
  renderTemplate,
  validateTemplateBody,
} from "../../src/core/template.js";

/**
 * T027：模板渲染器单元测试（Red 先行）。
 * 白名单占位符；未知占位符保存/渲染即报错；正文 ≤ 2000 字符（data-model.md）。
 */
const VALUES = {
  task_id: "task-001",
  source_agent: "claude-code",
  result_status: "success",
  finished_at: "2026-11-07T10:30:00.000Z",
  result_summary: "修复登录页样式",
};

describe("template renderer / 模板渲染器（T027）", () => {
  it("白名单常量恰好五个占位符", () => {
    expect([...PLACEHOLDERS]).toEqual([
      "task_id",
      "source_agent",
      "result_status",
      "finished_at",
      "result_summary",
    ]);
  });

  it("五个白名单占位符全部替换", () => {
    const body =
      "任务 {{task_id}}（{{source_agent}}）{{result_status}} @ {{finished_at}}：{{result_summary}}";
    const out = renderTemplate(body, VALUES);
    expect(out).toBe(
      "任务 task-001（claude-code）success @ 2026-11-07T10:30:00.000Z：修复登录页样式",
    );
    expect(out).not.toContain("{{");
  });

  it("未知占位符渲染即报错", () => {
    expect(() => renderTemplate("hi {{foo}}", VALUES)).toThrow(TemplateError);
    expect(() => renderTemplate("{{task_id}} {{evil}}", VALUES)).toThrow(TemplateError);
  });

  it("未知占位符校验即报错（保存路径复用）", () => {
    expect(() => validateTemplateBody("{{unknown_one}}")).toThrow(TemplateError);
    expect(() => validateTemplateBody("{{task_id}}")).not.toThrow();
  });

  it("正文 ≤ 2000 字符约束", () => {
    expect(() => validateTemplateBody("x".repeat(2001))).toThrow(TemplateError);
    expect(() => validateTemplateBody("x".repeat(2000))).not.toThrow();
  });

  it("无占位符纯文本合法", () => {
    expect(renderTemplate("纯文本通知", VALUES)).toBe("纯文本通知");
  });
});
