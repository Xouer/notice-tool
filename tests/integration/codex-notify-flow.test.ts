import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCli } from "../../src/cli/index.js";
import { openFileDatabase } from "../../src/storage/db.js";
import { ingestTaskEndEvent } from "../../src/core/event-pipeline.js";
import { mapCodexNotifyPayload } from "../../src/cli/hook.js";
import type { ChannelAdapter, SendOutcome, SendPayload } from "../../src/channels/adapter.js";
import { BlobCipher } from "../../src/storage/crypto.js";
import { InMemorySecretStore } from "../../src/storage/secret-store.js";
import { ChannelRepository } from "../../src/storage/channel-repository.js";
import { TemplateRepository } from "../../src/storage/template-repository.js";
import { seedDefaultTemplates } from "../../src/storage/seed.js";
import { notificationRecords, taskEvents, type ChannelType } from "../../src/storage/schema.js";

/**
 * T010：Codex notify 端到端集成（Red 先行，US2）。
 * 路径一：runCli 模拟 Codex notify 调用（argv JSON）→ 数据库落库来源/触发方式正确；
 * 路径二：映射产物 → 统一管线 → 假渠道适配器分发 → sent 记录 + 历史可追溯。
 */
const codexFixture = {
  type: "agent-turn-complete",
  "thread-id": "fixture-thread-codex-e2e-0001",
  "last-assistant-message": "fixture：E2E 虚构任务完成",
  input_messages: ["fixture：E2E 输入"],
  cwd: "C:\\fake\\project",
};

class FakeAdapter implements ChannelAdapter {
  readonly sends: SendPayload[] = [];
  constructor(
    readonly type: ChannelType,
    private readonly respond: () => SendOutcome,
  ) {}
  async   send(payload: SendPayload, _credentials: Record<string, unknown>): Promise<SendOutcome> {
    this.sends.push(payload);
    return this.respond();
  }
}

describe("codex notify flow / Codex notify 端到端（T010，US2）", () => {
  let dataDir: string;

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), "notice-codex-e2e-"));
  });

  afterEach(() => {
    rmSync(dataDir, { recursive: true, force: true });
  });

  it("runCli 模拟 notify 调用 → task_events 落库 source_agent=codex-cli, trigger=hook", async () => {
    const code = await runCli(
      ["hook", "--source", "codex-cli", "--payload-argv", JSON.stringify(codexFixture)],
      { dataDir, out: () => {}, err: () => {} },
    );
    expect(code).toBe(0);
    const db = openFileDatabase(join(dataDir, "notice.db"));
    try {
      const events = db.select().from(taskEvents).all();
      expect(events).toHaveLength(1);
      expect(events[0]?.sourceAgent).toBe("codex-cli");
      expect(events[0]?.taskId).toBe("fixture-thread-codex-e2e-0001");
      expect(events[0]?.triggerType).toBe("hook");
    } finally {
      db.$client.close();
    }
  });

  it("映射产物 → 管线 → 假渠道：sent 记录且历史含来源与触发方式；重复上报零通知", async () => {
    const db = openFileDatabase(":memory:");
    seedDefaultTemplates(db);
    const cipher = new BlobCipher(new InMemorySecretStore().getMainKey());
    const channels = new ChannelRepository(db, cipher);
    const templates = new TemplateRepository(db);
    const row = channels.create({ type: "feishu", name: "假飞书", credentials: { webhookUrl: "https://x.example/hook" } });
    channels.setEnabled(row.id, true);
    const fake = new FakeAdapter("feishu", () => ({ ok: true }));

    const mapped = mapCodexNotifyPayload(codexFixture);
    expect(mapped.status).toBe("mapped");
    if (mapped.status !== "mapped") return;

    const deps = {
      db,
      channels,
      templates,
      getAdapter: (): ChannelAdapter => fake,
      config: { cooldownMinutes: 10 },
      dispatchOptions: { maxAttempts: 1, retryDelayMs: 1 },
    };
    const first = await ingestTaskEndEvent(deps, mapped.payload, { trigger: "hook" });
    expect(first.records).toHaveLength(1);
    expect(first.records[0]?.status).toBe("sent");
    expect(fake.sends).toHaveLength(1);
    expect(fake.sends[0]?.message).toContain("codex-cli");

    const second = await ingestTaskEndEvent(deps, mapped.payload, { trigger: "polling" });
    expect(second.deduplicated).toBe(true);
    expect(second.records).toHaveLength(0);
    expect(fake.sends).toHaveLength(1);

    const events = db.select().from(taskEvents).all();
    expect(events.map((e) => e.sourceAgent)).toEqual(["codex-cli", "codex-cli"]);
    expect(new Set(events.map((e) => e.triggerType))).toEqual(new Set(["hook", "polling"]));
    const sent = db.select().from(notificationRecords).all();
    expect(sent).toHaveLength(1);
    expect(sent[0]?.status).toBe("sent");
    db.$client.close();
  });

  it("敏感摘要过滤：通知与历史均不泄漏", async () => {
    const db = openFileDatabase(":memory:");
    seedDefaultTemplates(db);
    const cipher = new BlobCipher(new InMemorySecretStore().getMainKey());
    const channels = new ChannelRepository(db, cipher);
    const templates = new TemplateRepository(db);
    const row = channels.create({ type: "feishu", name: "假飞书-2", credentials: { webhookUrl: "https://x.example/hook" } });
    channels.setEnabled(row.id, true);
    const fake = new FakeAdapter("feishu", () => ({ ok: true }));

    const mapped = mapCodexNotifyPayload({
      ...codexFixture,
      "thread-id": "fixture-thread-codex-e2e-0002",
      "last-assistant-message": "fixture：部署完成 sk-proj-fake-secret-1234567890",
    });
    expect(mapped.status).toBe("mapped");
    if (mapped.status !== "mapped") return;

    await ingestTaskEndEvent(
      {
        db,
        channels,
        templates,
        getAdapter: () => fake,
        config: { cooldownMinutes: 10 },
        dispatchOptions: { maxAttempts: 1, retryDelayMs: 1 },
      },
      mapped.payload,
      { trigger: "hook" },
    );
    const secret = "sk-proj-fake-secret-1234567890";
    expect(fake.sends[0]?.message).not.toContain(secret);
    const event = db.select().from(taskEvents).get();
    expect(event?.rawPayloadRef).not.toContain(secret);
    db.$client.close();
  });
});
