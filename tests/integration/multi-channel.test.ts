import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { afterEach, beforeEach } from "vitest";
import { runCli } from "../../src/cli/index.js";
import { ingestTaskEndEvent } from "../../src/core/event-pipeline.js";
import type { ChannelAdapter, SendOutcome, SendPayload } from "../../src/channels/adapter.js";
import { BlobCipher } from "../../src/storage/crypto.js";
import { InMemorySecretStore } from "../../src/storage/secret-store.js";
import { openMemoryDatabase, openFileDatabase } from "../../src/storage/db.js";
import { ChannelRepository } from "../../src/storage/channel-repository.js";
import { TemplateRepository } from "../../src/storage/template-repository.js";
import { seedDefaultTemplates } from "../../src/storage/seed.js";
import {
  notificationChannels,
  notificationRecords,
  type ChannelType,
} from "../../src/storage/schema.js";

/**
 * 004-T007：同类型多条配置行为测试（US2）。
 * 引用 contracts/update.md「同类型多条配置行为」与 data-model.md 不变量 1/2：
 * - 同 type 不同 name 添加成功，list 独立掩码摘要（FR-009/SC-003）
 * - 对 A 的 enable/disable/remove/update 不影响 B（FR-010）
 * - 分发：同 type 两条 enabled 渠道各产生一条记录，单条失败不阻断（FR-011）
 * - 同 type 同名 add 报错含指引（FR-012）；跨 type 同名合法
 */

const WEBHOOK = "https://open.feishu.example/open-apis/bot/v2/hook/0d1e2f3a4b5c6d7e8f9a0b1c";
const OTHER_HOOK = "https://open.feishu.example/open-apis/bot/v2/hook/other0123456789abcdef";

// ── Part A：CLI 层（runCli + 临时数据目录）──

let dataDir: string;
beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), "notice-multi-cli-"));
});
afterEach(() => {
  rmSync(dataDir, { recursive: true, force: true });
});

function cli(argv: string[]) {
  let out = "";
  let errOut = "";
  return runCli(argv, {
    dataDir,
    out: (s) => {
      out += s;
    },
    err: (s) => {
      errOut += s;
    },
  }).then((code) => ({ code, out, errOut }));
}

async function listJson(): Promise<{
  channels: Array<{ name: string; type: string; enabled: boolean; credentials: string }>;
}> {
  const r = await cli(["channel", "list", "--json"]);
  return JSON.parse(r.out.trim());
}

describe("same-type multi-config CLI/同类型多条 CLI（US2）", () => {
  it("同 type 不同名添加成功，list 展示两条独立记录（FR-009/SC-003）", async () => {
    const a = await cli([
      "channel",
      "add",
      "email",
      "--name",
      "mail-a",
      "--smtp-host",
      "smtp.qq.com",
      "--auth-code",
      "code-a",
      "--to",
      "a@example.com",
    ]);
    const b = await cli([
      "channel",
      "add",
      "email",
      "--name",
      "mail-b",
      "--smtp-host",
      "smtp.163.com",
      "--auth-code",
      "code-b",
      "--to",
      "b@example.com",
    ]);
    expect(a.code).toBe(0);
    expect(b.code).toBe(0);
    const listed = await listJson();
    expect(listed.channels).toHaveLength(2);
    expect(new Set(listed.channels.map((c) => c.type))).toEqual(new Set(["email"]));
    expect(listed.channels[0]!.credentials).not.toBe(listed.channels[1]!.credentials);
  });

  it("对 A 执行 enable/disable/update 不影响 B（FR-010，不变量 1）", async () => {
    await cli(["channel", "add", "dingtalk", "--name", "ch-a", "--webhook-url", WEBHOOK]);
    await cli(["channel", "add", "dingtalk", "--name", "ch-b", "--webhook-url", OTHER_HOOK]);

    await cli(["channel", "enable", "ch-a"]);
    await cli(["channel", "disable", "ch-a"]);
    await cli(["channel", "update", "ch-a", "--webhook-url", OTHER_HOOK]);

    const listed = await listJson();
    const b = listed.channels.find((c) => c.name === "ch-b")!;
    expect(b.enabled).toBe(false); // 未被动过
  });

  it("对 A remove 不影响 B（FR-010）", async () => {
    await cli(["channel", "add", "dingtalk", "--name", "ch-a", "--webhook-url", WEBHOOK]);
    await cli(["channel", "add", "dingtalk", "--name", "ch-b", "--webhook-url", OTHER_HOOK]);
    const r = await cli(["channel", "remove", "ch-a"]);
    expect(r.code).toBe(0);
    const listed = await listJson();
    expect(listed.channels.map((c) => c.name)).toEqual(["ch-b"]);
  });

  it("同 type 同名 add 报错并给出指引（FR-012）", async () => {
    await cli(["channel", "add", "dingtalk", "--name", "dd", "--webhook-url", WEBHOOK]);
    const r = await cli([
      "channel",
      "add",
      "dingtalk",
      "--name",
      "dd",
      "--webhook-url",
      OTHER_HOOK,
    ]);
    expect(r.code).toBe(2);
    expect(r.errOut).toContain("同名渠道已存在");
    expect(r.errOut).toContain("notice channel update"); // 指引修改既有渠道
  });

  it("不同 type 之间同名添加合法（FR-009）", async () => {
    await cli(["channel", "add", "dingtalk", "--name", "shared", "--webhook-url", WEBHOOK]);
    const r = await cli([
      "channel",
      "add",
      "email",
      "--name",
      "shared",
      "--smtp-host",
      "smtp.qq.com",
      "--auth-code",
      "c",
      "--to",
      "a@b.c",
    ]);
    expect(r.code).toBe(0);
    const listed = await listJson();
    expect(listed.channels.filter((c) => c.name === "shared")).toHaveLength(2);
  });
});

// ── Part B：分发层（:memory: 库 + 假适配器，同 003/T031 模式）──

class QueueAdapter implements ChannelAdapter {
  readonly type = "feishu" as ChannelType;
  readonly sends: SendPayload[] = [];
  constructor(private readonly respond: (call: number) => SendOutcome) {}
  async send(payload: SendPayload): Promise<SendOutcome> {
    this.sends.push(payload);
    return this.respond(this.sends.length);
  }
}

function makePipelineSetup() {
  const db = openMemoryDatabase();
  seedDefaultTemplates(db);
  const channels = new ChannelRepository(
    db,
    new BlobCipher(new InMemorySecretStore().getMainKey()),
  );
  const templates = new TemplateRepository(db);
  for (const name of ["feishu-a", "feishu-b"]) {
    const row = channels.create({
      type: "feishu",
      name,
      credentials: { webhookUrl: `https://x.example/${name}` },
    });
    channels.setEnabled(row.id, true);
  }
  const payload = {
    schemaVersion: 1,
    source: "claude-code",
    taskId: "task-multi",
    result: "success",
  };
  const ingest = (respond: (call: number) => SendOutcome, notifyChannels?: string[]) => {
    // 共享适配器实例：两次 send 调用共用同一计数器（feishu-a 先、feishu-b 后）
    const adapter = new QueueAdapter(respond);
    return ingestTaskEndEvent(
      {
        db,
        channels,
        templates,
        getAdapter: () => adapter,
        config: { cooldownMinutes: 10, channels: notifyChannels },
        dispatchOptions: { maxAttempts: 1, retryDelayMs: 1 },
      },
      payload,
      { trigger: "hook" },
    );
  };
  return { db, channels, ingest };
}

describe("same-type multi-config dispatch/同类型多条分发（US2，FR-011）", () => {
  it("同 type 两条 enabled 渠道各产生一条独立记录（不变量 2）", async () => {
    const { db, ingest } = makePipelineSetup();
    const result = await ingest(() => ({ ok: true }));
    expect(result.records).toHaveLength(2);
    const records = db.select().from(notificationRecords).all();
    expect(records).toHaveLength(2);
    expect(new Set(records.map((r) => r.channelId)).size).toBe(2); // channel_id 各自独立
    expect(new Set(records.map((r) => r.status))).toEqual(new Set(["sent"]));
  });

  it("单条失败不阻断其余同 type 渠道（不变量 2）", async () => {
    const { db, ingest } = makePipelineSetup();
    // 第一次发送失败（feishu-a），第二次成功（feishu-b）
    const result = await ingest((call) =>
      call === 1
        ? { ok: false, errorCode: "NETWORK_UNREACHABLE", message: "网络失败" }
        : { ok: true },
    );
    const records = db.select().from(notificationRecords).all();
    expect(records).toHaveLength(2);
    const statuses = new Set(records.map((r) => r.status));
    expect(statuses.has("failed")).toBe(true);
    expect(statuses.has("sent")).toBe(true);
    const failed = records.find((r) => r.status === "failed")!;
    expect(failed.lastErrorCode).toBe("NETWORK_UNREACHABLE");
    void result;
  });
});

describe("notify.channels 指定渠道分发/按配置过滤（US2）", () => {
  it("config.channels 指定单个渠道时仅该渠道收到通知", async () => {
    const { db, ingest } = makePipelineSetup();
    const result = await ingest(() => ({ ok: true }), ["feishu-b"]);
    expect(result.records).toHaveLength(1);
    expect(result.records[0]!.channelName).toBe("feishu-b");
    const records = db.select().from(notificationRecords).all();
    expect(records).toHaveLength(1);
  });

  it("config.channels 指定多个渠道时仅命中渠道收到通知", async () => {
    const { ingest } = makePipelineSetup();
    const result = await ingest(() => ({ ok: true }), ["feishu-a", "feishu-b"]);
    expect(result.records.map((r) => r.channelName).sort()).toEqual(["feishu-a", "feishu-b"]);
  });

  it("config.channels 含未匹配名称时仅命中部分渠道", async () => {
    const { ingest } = makePipelineSetup();
    const result = await ingest(() => ({ ok: true }), ["feishu-a", "不存在的渠道"]);
    expect(result.records).toHaveLength(1);
    expect(result.records[0]!.channelName).toBe("feishu-a");
  });

  it("config.channels 为空数组时全量分发（向后兼容）", async () => {
    const { ingest } = makePipelineSetup();
    const result = await ingest(() => ({ ok: true }), []);
    expect(result.records).toHaveLength(2);
  });
});

// ── Part C：hook --channels 命令行覆盖（settings.json 直接指定渠道场景）──

describe("hook --channels CLI 覆盖/命令行指定渠道", () => {
  let dataDir: string;
  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), "notice-hook-channels-"));
  });
  afterEach(() => {
    rmSync(dataDir, { recursive: true, force: true });
  });

  function cli(argv: string[], stdin?: Readable) {
    let out = "";
    let errOut = "";
    return runCli(argv, {
      dataDir,
      stdin,
      out: (s) => {
        out += s;
      },
      err: (s) => {
        errOut += s;
      },
    }).then((code) => ({ code, out, errOut }));
  }

  async function recordChannelNames(): Promise<string[]> {
    const db = openFileDatabase(join(dataDir, "notice.db"));
    try {
      const channels = new Map(
        db.select().from(notificationChannels).all().map((c) => [c.id, c.name]),
      );
      return db
        .select()
        .from(notificationRecords)
        .all()
        .map((r) => channels.get(r.channelId ?? "") ?? "(unknown)");
    } finally {
      db.$client.close();
    }
  }

  it("--channels 指定单渠道时仅该渠道产生通知记录（优先于 config.json）", async () => {
    await cli(["channel", "add", "dingtalk", "--name", "ch-a", "--webhook-url", WEBHOOK]);
    await cli(["channel", "add", "dingtalk", "--name", "ch-b", "--webhook-url", OTHER_HOOK]);
    await cli(["channel", "enable", "ch-a"]);
    await cli(["channel", "enable", "ch-b"]);
    // 写入 config.json 指向 ch-b，验证命令行 --channels ch-a 优先
    writeFileSync(
      join(dataDir, "config.json"),
      JSON.stringify({ notify: { channels: ["ch-b"] } }),
      "utf8",
    );
    const r = await cli(
      ["hook", "--source", "codebuddy", "--channels", "ch-a"],
      Readable.from([
        Buffer.from(
          JSON.stringify({ session_id: "fixture-channels-0001", result: "success" }),
        ),
      ]),
    );
    expect(r.code).toBe(0);
    expect(r.out).toContain("1 渠道");
    expect(await recordChannelNames()).toEqual(["ch-a"]);
  });

  it("--channels 未提供时回落 config.json 的 notify.channels", async () => {
    await cli(["channel", "add", "dingtalk", "--name", "ch-a", "--webhook-url", WEBHOOK]);
    await cli(["channel", "add", "dingtalk", "--name", "ch-b", "--webhook-url", OTHER_HOOK]);
    await cli(["channel", "enable", "ch-a"]);
    await cli(["channel", "enable", "ch-b"]);
    writeFileSync(
      join(dataDir, "config.json"),
      JSON.stringify({ notify: { channels: ["ch-b"] } }),
      "utf8",
    );
    const r = await cli(
      ["hook", "--source", "codebuddy"],
      Readable.from([
        Buffer.from(
          JSON.stringify({ session_id: "fixture-channels-0002", result: "success" }),
        ),
      ]),
    );
    expect(r.code).toBe(0);
    expect(await recordChannelNames()).toEqual(["ch-b"]);
  });

  it("--channels 重复参数指定多渠道时各渠道均产生记录", async () => {
    await cli(["channel", "add", "dingtalk", "--name", "ch-a", "--webhook-url", WEBHOOK]);
    await cli(["channel", "add", "dingtalk", "--name", "ch-b", "--webhook-url", OTHER_HOOK]);
    await cli(["channel", "enable", "ch-a"]);
    await cli(["channel", "enable", "ch-b"]);
    const r = await cli(
      ["hook", "--source", "codebuddy", "--channels", "ch-a", "--channels", "ch-b"],
      Readable.from([
        Buffer.from(
          JSON.stringify({ session_id: "fixture-channels-0004", result: "success" }),
        ),
      ]),
    );
    expect(r.code).toBe(0);
    expect(await recordChannelNames().then((n) => n.sort())).toEqual(["ch-a", "ch-b"]);
  });

  it("--channels 值含残留引号时剥离后匹配（跨 shell 传参健壮性）", async () => {
    await cli(["channel", "add", "dingtalk", "--name", "ch-a", "--webhook-url", WEBHOOK]);
    await cli(["channel", "enable", "ch-a"]);
    const r = await cli(
      ["hook", "--source", "codebuddy", "--channels", '"ch-a"'],
      Readable.from([
        Buffer.from(
          JSON.stringify({ session_id: "fixture-channels-0005", result: "success" }),
        ),
      ]),
    );
    expect(r.code).toBe(0);
    expect(await recordChannelNames()).toEqual(["ch-a"]);
  });

  it("--channels 空格分隔多渠道时各渠道均产生记录（PowerShell 逗号转空格场景）", async () => {
    await cli(["channel", "add", "dingtalk", "--name", "ch-a", "--webhook-url", WEBHOOK]);
    await cli(["channel", "add", "dingtalk", "--name", "ch-b", "--webhook-url", OTHER_HOOK]);
    await cli(["channel", "enable", "ch-a"]);
    await cli(["channel", "enable", "ch-b"]);
    const r = await cli(
      ["hook", "--source", "codebuddy", "--channels", "ch-a ch-b"],
      Readable.from([
        Buffer.from(
          JSON.stringify({ session_id: "fixture-channels-0006", result: "success" }),
        ),
      ]),
    );
    expect(r.code).toBe(0);
    expect(await recordChannelNames().then((n) => n.sort())).toEqual(["ch-a", "ch-b"]);
  });

  it("--channels 仅有分隔符 → 退出码 2 且错误信息含 --channels", async () => {
    const r = await cli(
      ["hook", "--source", "codebuddy", "--channels", " , "],
      Readable.from([
        Buffer.from(
          JSON.stringify({ session_id: "fixture-channels-0003", result: "success" }),
        ),
      ]),
    );
    expect(r.code).toBe(2);
    expect(r.errOut).toContain("--channels");
  });
});
