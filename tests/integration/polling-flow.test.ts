import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ingestTaskEndEvent } from "../../src/core/event-pipeline.js";
import { PollingScheduler } from "../../src/pollers/scheduler.js";
import { GenericFileAdapter } from "../../src/pollers/generic-file.js";
import { AgentStatusError } from "../../src/pollers/adapter.js";
import type { ChannelAdapter } from "../../src/channels/adapter.js";
import { BlobCipher } from "../../src/storage/crypto.js";
import { InMemorySecretStore } from "../../src/storage/secret-store.js";
import { openMemoryDatabase } from "../../src/storage/db.js";
import { ChannelRepository } from "../../src/storage/channel-repository.js";
import { TemplateRepository } from "../../src/storage/template-repository.js";
import { seedDefaultTemplates } from "../../src/storage/seed.js";
import { notificationRecords } from "../../src/storage/schema.js";

/**
 * T048：巡查流集成测试（Red 先行）。
 * - 巡查检测到状态迁移触发与钩子一致的管线
 * - 钩子 + 巡查双通道先后命中同一任务仅一轮通知（SC-003）
 * - 无法读取状态返回明确错误不静默
 * - 重启（新调度器实例）后对离线期间已结束任务补检并仅通知一次
 */
function makePipelineDeps() {
  const db = openMemoryDatabase();
  seedDefaultTemplates(db);
  const channels = new ChannelRepository(db, new BlobCipher(new InMemorySecretStore().getMainKey()));
  const templates = new TemplateRepository(db);
  const ch = channels.create({
    type: "feishu",
    name: "群",
    credentials: { webhookUrl: "https://x.example/hook/abc123" },
  });
  channels.setEnabled(ch.id, true);
  const sent: number[] = [];
  const getAdapter = (): ChannelAdapter => ({
    type: "feishu",
    send: async () => {
      sent.push(1);
      return { ok: true };
    },
  });
  return {
    db,
    channels,
    templates,
    getAdapter,
    config: { cooldownMinutes: 10 },
    dispatchOptions: { maxAttempts: 1, retryDelayMs: 1 },
    sentCount: () => sent.length,
  };
}

function makeScheduler(deps: ReturnType<typeof makePipelineDeps>, adapters: [GenericFileAdapter, ...GenericFileAdapter[]]) {
  const errors: Error[] = [];
  const scheduler = new PollingScheduler({
    adapters,
    ingest: (payload, trigger) => ingestTaskEndEvent(deps, payload, { trigger }),
    intervalMs: 10,
    cooldownMinutes: 10,
    onError: (error) => errors.push(error),
  });
  return { scheduler, errors };
}

describe("polling flow / 巡查流集成（T048）", () => {
  it("状态迁移触发与钩子一致的管线（running → completed）", async () => {
    const deps = makePipelineDeps();
    const dir = mkdtempSync(join(tmpdir(), "notice-poll-"));
    try {
      const file = join(dir, "demo-status.txt");
      writeFileSync(file, "step running\n", "utf8");
      const adapter = new GenericFileAdapter({ path: file, completionPattern: "status=completed", sourceName: "demo" });
      const { scheduler } = makeScheduler(deps, [adapter]);

      await scheduler.scanOnce(); // 基线：running，不通知
      expect(deps.sentCount()).toBe(0);

      appendFileSync(file, "status=completed all tests passed\n", "utf8");
      const notifications = await scheduler.scanOnce(); // 迁移 → 通知
      expect(notifications).toHaveLength(1);
      expect(notifications[0]?.deduplicated).toBe(false);
      expect(deps.sentCount()).toBe(1);
      const records = deps.db.select().from(notificationRecords).all();
      expect(records).toHaveLength(1);
      expect(records[0]?.status).toBe("sent");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("钩子 + 巡查双通道先后命中同一任务仅一轮通知（SC-003）", async () => {
    const deps = makePipelineDeps();
    const dir = mkdtempSync(join(tmpdir(), "notice-poll2-"));
    try {
      const file = join(dir, "demo-status.txt");
      writeFileSync(file, "step running\n", "utf8");
      const adapter = new GenericFileAdapter({ path: file, completionPattern: "status=completed", sourceName: "demo" });
      const { scheduler } = makeScheduler(deps, [adapter]);

      await scheduler.scanOnce(); // 基线 running
      // 钩子先到（同一 source/taskId）
      await ingestTaskEndEvent(
        deps,
        { schemaVersion: 1, source: "generic:demo", taskId: "demo-status.txt", result: "success" },
        { trigger: "hook" },
      );
      expect(deps.sentCount()).toBe(1);

      appendFileSync(file, "status=completed done\n", "utf8");
      const notifications = await scheduler.scanOnce(); // 巡查后到 → 去重
      expect(notifications).toHaveLength(1);
      expect(notifications[0]?.deduplicated).toBe(true);
      expect(deps.sentCount()).toBe(1); // 仅一轮通知
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("无法读取状态 → 明确报错不静默，且不影响其他适配器", async () => {
    const deps = makePipelineDeps();
    const dir = mkdtempSync(join(tmpdir(), "notice-poll3-"));
    try {
      const missing = join(dir, "missing.txt");
      const okFile = join(dir, "ok.txt");
      writeFileSync(okFile, "status=completed\n", "utf8");
      const bad = new GenericFileAdapter({ path: missing, completionPattern: "x", sourceName: "bad" });
      const ok = new GenericFileAdapter({ path: okFile, completionPattern: "status=completed", sourceName: "ok" });
      const { scheduler, errors } = makeScheduler(deps, [bad, ok]);

      const notifications = await scheduler.scanOnce();
      expect(errors.length).toBeGreaterThanOrEqual(1);
      expect(errors[0]).toBeInstanceOf(AgentStatusError);
      expect(errors[0]?.message).toContain(missing); // 明确指出不可读路径
      expect(notifications).toHaveLength(1); // ok 适配器正常补检
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("重启（新调度器）后对离线期间已结束任务补检并仅通知一次", async () => {
    const deps = makePipelineDeps();
    const dir = mkdtempSync(join(tmpdir(), "notice-poll4-"));
    try {
      const file = join(dir, "demo-status.txt");
      writeFileSync(file, "step running\n", "utf8");
      const adapter = new GenericFileAdapter({ path: file, completionPattern: "status=completed", sourceName: "demo" });
      const first = makeScheduler(deps, [adapter]);
      await first.scheduler.scanOnce(); // 基线 running
      appendFileSync(file, "status=completed done\n", "utf8");
      await first.scheduler.scanOnce(); // 迁移 → 通知一轮
      expect(deps.sentCount()).toBe(1);

      // 模拟 serve 重启：全新调度器（内存状态清空），文件已完成
      const restarted = makeScheduler(deps, [adapter]);
      const notifications = await restarted.scheduler.scanOnce(); // 基线补检
      expect(notifications).toHaveLength(1);
      expect(notifications[0]?.deduplicated).toBe(true); // 冷却窗口内仅通知一次
      expect(deps.sentCount()).toBe(1); // 零新通知
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
