import { describe, expect, it } from "vitest";
import { runWizard } from "../../src/cli/wizard.js";
import { validateChannelInput } from "../../src/channels/channel-config.js";
import { createFakeWizardIO, type FakeAnswer } from "./helpers/fake-wizard-io.js";

/**
 * T003：向导引擎核心流程单元测试（US1，Red 先行）。
 * 逐条引用 contracts/wizard.md 步骤流与 data-model.md 状态机：
 * 类型菜单 → 方式菜单（预选/单方式跳过）→ 逐字段（secret/choice/轻校验重试）
 * → 脱敏确认摘要 → save 产物经 validateChannelInput 等价（FR-009）→ 取消。
 */

const APP_ID = "cli_a1b2c3d4e5f6";
const APP_SECRET = "feishu-app-secret-9876543210";
const RECEIVE_ID = "oc_1234567890abcdef";
const WEBHOOK = "https://open.feishu.example/open-apis/bot/v2/hook/0d1e2f3a4b5c6d7e8f9a0b1c";

/** 飞书应用凭证全流程应答（含渠道名称）。 */
function feishuAppAnswers(overrides: FakeAnswer[] = []): FakeAnswer[] {
  return [
    { kind: "value", value: 0 }, // 类型：feishu
    { kind: "value", value: 0 }, // 方式：app
    { kind: "value", value: "我的飞书" }, // name
    { kind: "value", value: APP_ID },
    { kind: "value", value: APP_SECRET },
    { kind: "value", value: 0 }, // receiveIdType: chat_id
    { kind: "value", value: RECEIVE_ID },
    { kind: "value", value: 0 }, // 确认保存
    ...overrides,
  ];
}

describe("wizard engine: type & mode steps/类型与方式步骤（T003，US1）", () => {
  it("第 1 步列出全部 5 类渠道且各附用途说明", async () => {
    const io = createFakeWizardIO(feishuAppAnswers());
    await runWizard(io);
    const typeMenu = io.chooseCalls[0];
    expect(typeMenu?.labels).toEqual(["feishu", "dingtalk", "email", "wechat", "qq"]);
    expect(typeMenu?.hints.every((h) => typeof h === "string" && h.length > 0)).toBe(true);
  });

  it("seed 预选类型时跳过第 1 步，直接进入方式菜单", async () => {
    const io = createFakeWizardIO(feishuAppAnswers().slice(1));
    await runWizard(io, { type: "feishu" });
    expect(io.chooseCalls[0]?.labels).toEqual(["app", "webhook"]);
  });

  it("飞书方式菜单列出 app（含推荐标记）与 webhook 及说明", async () => {
    const io = createFakeWizardIO(feishuAppAnswers().slice(1));
    await runWizard(io, { type: "feishu" });
    const modeMenu = io.chooseCalls[0];
    expect(modeMenu?.labels).toEqual(["app", "webhook"]);
    expect(modeMenu?.hints.every((h) => typeof h === "string" && h.length > 0)).toBe(true);
    expect(modeMenu?.hints[0]).toContain("推荐");
  });

  it("单方式渠道（dingtalk/email）跳过方式步骤", async () => {
    const io = createFakeWizardIO([
      { kind: "value", value: "钉钉" },
      { kind: "value", value: WEBHOOK },
      { kind: "value", value: "" }, // secret 可选跳过
      { kind: "value", value: 0 }, // 确认保存
    ]);
    const outcome = await runWizard(io, { type: "dingtalk" });
    // 全程仅确认菜单一次 choose；无方式菜单
    expect(io.chooseCalls).toHaveLength(1);
    expect(outcome).toMatchObject({ action: "save", type: "dingtalk", name: "钉钉" });
  });
});

describe("wizard engine: fields step/逐字段输入（T003，US1）", () => {
  it("飞书 app 模式按目录顺序收集字段；appSecret 走掩码输入；receiveIdType 为枚举选择", async () => {
    const io = createFakeWizardIO(feishuAppAnswers().slice(1)); // seed 预选类型 → 少一条类型应答
    await runWizard(io, { type: "feishu" });
    expect(io.askPrompts.some((p) => p.includes("名称"))).toBe(true);
    expect(io.askPrompts.some((p) => p.includes("App ID"))).toBe(true);
    expect(io.askPrompts.some((p) => p.includes("接收目标 ID"))).toBe(true);
    expect(io.secretPrompts.some((p) => p.includes("App Secret"))).toBe(true);
    const receiveMenu = io.chooseCalls.find((c) => c.prompt.includes("接收目标类型"));
    expect(receiveMenu?.labels).toEqual(["chat_id", "open_id", "user_id", "union_id", "email"]);
    // 每个选项有专属说明（不是重复同一段提示）
    expect(new Set(receiveMenu?.hints ?? []).size).toBe(receiveMenu?.hints.length);
  });

  it("每个字段提示含含义与格式示例（App ID 提示 cli_ 前缀）", async () => {
    const io = createFakeWizardIO(feishuAppAnswers().slice(1));
    await runWizard(io, { type: "feishu" });
    expect(io.printed.some((l) => l.includes("App ID") && l.includes("cli_"))).toBe(true);
    expect(
      io.printed.some((l) => l.includes("接收目标 ID") && (l.includes("oc_") || l.includes("ou_"))),
    ).toBe(true);
  });

  it("轻量校验：空 App ID 提交后原地重试，错误定位到字段且游标不推进", async () => {
    const io = createFakeWizardIO([
      { kind: "value", value: 0 }, // 方式：app（seed 预选类型）
      { kind: "value", value: "x" },
      { kind: "value", value: "" }, // 空 App ID → 校验失败重试
      { kind: "value", value: APP_ID },
      { kind: "value", value: APP_SECRET },
      { kind: "value", value: 0 },
      { kind: "value", value: RECEIVE_ID },
      { kind: "value", value: 0 },
    ]);
    const outcome = await runWizard(io, { type: "feishu" });
    expect(outcome.action).toBe("save");
    if (outcome.action === "save") {
      expect(outcome.credentials).toMatchObject({ appId: APP_ID });
    }
    expect(io.printed.some((l) => l.includes("App ID") && l.includes("不能为空"))).toBe(true);
    expect(io.secretPrompts).toHaveLength(1); // appSecret 仅询问一次
  });

  it("Webhook URL 非法时提示并重试", async () => {
    const io = createFakeWizardIO([
      { kind: "value", value: 1 }, // webhook 模式
      { kind: "value", value: "旧方式" },
      { kind: "value", value: "not-a-url" }, // 非法
      { kind: "value", value: WEBHOOK },
      { kind: "value", value: 0 }, // 确认保存
    ]);
    const outcome = await runWizard(io, { type: "feishu" });
    expect(outcome.action).toBe("save");
    if (outcome.action === "save") {
      expect(outcome.credentials).toMatchObject({ mode: "webhook", webhookUrl: WEBHOOK });
    }
    expect(io.printed.some((l) => l.includes("URL") && l.includes("http"))).toBe(true);
  });
});

describe("wizard engine: confirm & outcome/确认与产物（T003，US1）", () => {
  it("确认摘要展示全部字段且敏感值仅 *** 形式（SC-005）", async () => {
    const io = createFakeWizardIO(feishuAppAnswers().slice(1));
    await runWizard(io, { type: "feishu" });
    const printed = io.printed.join("\n");
    expect(printed).toContain("App ID");
    expect(printed).toContain("App Secret");
    expect(printed).toContain("***");
    expect(printed).not.toContain(APP_SECRET);
  });

  it("save 产物与等价标志命令一致且通过既有校验（FR-009）", async () => {
    const io = createFakeWizardIO(feishuAppAnswers().slice(1));
    const outcome = await runWizard(io, { type: "feishu" });
    expect(outcome.action).toBe("save");
    if (outcome.action !== "save") return;
    expect(outcome.name).toBe("我的飞书");
    const validated = validateChannelInput(outcome.type, outcome.name, outcome.credentials);
    expect(validated.credentials).toMatchObject({
      mode: "app",
      appId: APP_ID,
      appSecret: APP_SECRET,
      receiveIdType: "chat_id",
      receiveId: RECEIVE_ID,
    });
  });

  it("任一步取消（如类型菜单）→ 返回 cancel", async () => {
    const io = createFakeWizardIO([{ kind: "cancel" }]);
    const outcome = await runWizard(io);
    expect(outcome).toEqual({ action: "cancel" });
  });
});

describe("wizard engine: navigation, defaults, cancel（T006，US2）", () => {
  it("字段步骤 back：游标回退且更早字段值保留（appSecret 不重输）", async () => {
    const io = createFakeWizardIO([
      { kind: "value", value: 0 }, // 方式：app
      { kind: "value", value: "n1" }, // name
      { kind: "value", value: APP_ID },
      { kind: "value", value: APP_SECRET },
      { kind: "value", value: 0 }, // receiveIdType: chat_id
      { kind: "back" }, // receiveId 步输入 b → 返回上一步
      { kind: "value", value: 0 }, // receiveIdType 重新选择
      { kind: "value", value: RECEIVE_ID },
      { kind: "value", value: 0 }, // 确认保存
    ]);
    const outcome = await runWizard(io, { type: "feishu" });
    expect(outcome.action).toBe("save");
    if (outcome.action === "save") {
      expect(outcome.credentials).toMatchObject({
        mode: "app",
        appId: APP_ID,
        receiveIdType: "chat_id",
        receiveId: RECEIVE_ID,
      });
    }
    expect(io.secretPrompts).toHaveLength(1); // appSecret 未重输
  });

  it("confirm 选返回上一步修改 → 回到最后一个字段", async () => {
    const io = createFakeWizardIO([
      { kind: "value", value: 0 }, // 方式：app
      { kind: "value", value: "n2" },
      { kind: "value", value: APP_ID },
      { kind: "value", value: APP_SECRET },
      { kind: "value", value: 0 },
      { kind: "value", value: RECEIVE_ID },
      { kind: "value", value: 1 }, // 返回上一步修改
      { kind: "value", value: RECEIVE_ID }, // 重新输入最后字段
      { kind: "value", value: 0 }, // 确认保存
    ]);
    const outcome = await runWizard(io, { type: "feishu" });
    expect(outcome.action).toBe("save");
    if (outcome.action === "save") {
      expect(outcome.credentials).toMatchObject({ receiveId: RECEIVE_ID });
    }
  });

  it("渠道名称留空 → 默认名 {type}-{YYYYMMDD-HHmmss} 且摘要标注默认生成", async () => {
    const io = createFakeWizardIO([
      { kind: "value", value: 0 },
      { kind: "value", value: "" }, // 名称留空
      { kind: "value", value: APP_ID },
      { kind: "value", value: APP_SECRET },
      { kind: "value", value: 0 },
      { kind: "value", value: RECEIVE_ID },
      { kind: "value", value: 0 },
    ]);
    const outcome = await runWizard(io, { type: "feishu" });
    expect(outcome.action).toBe("save");
    if (outcome.action !== "save") return;
    expect(outcome.name).toMatch(/^feishu-\d{8}-\d{6}$/);
    expect(validateChannelInput(outcome.type, outcome.name, outcome.credentials)).toBeDefined();
    expect(io.printed.join("\n")).toContain("默认生成");
  });

  it("敏感输入中途取消 → cancel，草稿不产出", async () => {
    const io = createFakeWizardIO([
      { kind: "value", value: 0 },
      { kind: "value", value: "n3" },
      { kind: "value", value: APP_ID },
      { kind: "cancel" }, // App Secret 输入中途取消
    ]);
    const outcome = await runWizard(io, { type: "feishu" });
    expect(outcome).toEqual({ action: "cancel" });
  });
});

// ── 004-T009：update 模式（US3）──

const CURRENT_FEISHU_APP = {
  name: "my-feishu",
  credentials: {
    mode: "app",
    appId: APP_ID,
    appSecret: APP_SECRET,
    receiveIdType: "chat_id",
    receiveId: RECEIVE_ID,
  },
};

describe("wizard update mode: seed & prefill/update 模式预填（004-T009，US3）", () => {
  it("类型锁定：第 1 步跳过，直接进入方式菜单且当前方式排在首位（预选）", async () => {
    const io = createFakeWizardIO([
      { kind: "value", value: 0 }, // 方式：app（当前值在首位）
      { kind: "value", value: "" }, // name 保留
      { kind: "value", value: "" }, // appId 保留
      { kind: "value", value: "" }, // appSecret 保留
      { kind: "value", value: 0 }, // receiveIdType 保留 chat_id
      { kind: "value", value: "" }, // receiveId 保留
      { kind: "value", value: 0 }, // 确认保存
    ]);
    await runWizard(io, {
      mode: "update",
      type: "feishu",
      current: CURRENT_FEISHU_APP,
    });
    // 类型菜单（同时含 feishu 与 qq）不应出现
    expect(io.chooseCalls.some((c) => c.labels.includes("feishu") && c.labels.includes("qq"))).toBe(
      false,
    );
    const modeMenu = io.chooseCalls[0];
    expect(modeMenu?.labels[0]).toBe("app");
    expect(modeMenu?.hints[0]).toContain("当前");
  });

  it("字段预填：全部回车保留 → 产物与当前凭据一致（经 validateChannelInput 终验等价）", async () => {
    const io = createFakeWizardIO([
      { kind: "value", value: 0 }, // 方式 app
      { kind: "value", value: "" }, // name
      { kind: "value", value: "" }, // appId
      { kind: "value", value: "" }, // appSecret
      { kind: "value", value: 0 }, // receiveIdType
      { kind: "value", value: "" }, // receiveId
      { kind: "value", value: 0 }, // 确认
    ]);
    const outcome = await runWizard(io, {
      mode: "update",
      type: "feishu",
      current: CURRENT_FEISHU_APP,
    });
    expect(outcome.action).toBe("save");
    if (outcome.action !== "save") return;
    expect(outcome.name).toBe("my-feishu");
    expect(outcome.credentials).toMatchObject({
      mode: "app",
      appId: APP_ID,
      appSecret: APP_SECRET,
      receiveIdType: "chat_id",
      receiveId: RECEIVE_ID,
    });
    expect(validateChannelInput(outcome.type, outcome.name, outcome.credentials)).toBeDefined();
  });

  it("敏感字段提示“已设置（回车保留）”；摘要脱敏无明文（SC-004）", async () => {
    const io = createFakeWizardIO([
      { kind: "value", value: 0 },
      { kind: "value", value: "" },
      { kind: "value", value: "" },
      { kind: "value", value: "" },
      { kind: "value", value: 0 },
      { kind: "value", value: "" },
      { kind: "value", value: 0 },
    ]);
    await runWizard(io, { mode: "update", type: "feishu", current: CURRENT_FEISHU_APP });
    expect(io.secretPrompts.some((p) => p.includes("已设置"))).toBe(true);
    const printed = io.printed.join("\n");
    expect(printed).toContain("***");
    expect(printed).not.toContain(APP_SECRET);
  });

  it("可改选连接方式：选 webhook 后按新方式字段集收集，产物为纯净新方式凭据", async () => {
    const io = createFakeWizardIO([
      { kind: "value", value: 1 }, // 改选 webhook
      { kind: "value", value: "" }, // name 保留（my-feishu）
      { kind: "value", value: WEBHOOK }, // webhookUrl（新方式无预填，必填）
      { kind: "value", value: 0 }, // 确认
    ]);
    const outcome = await runWizard(io, {
      mode: "update",
      type: "feishu",
      current: CURRENT_FEISHU_APP,
    });
    expect(outcome.action).toBe("save");
    if (outcome.action !== "save") return;
    expect(outcome.credentials).toEqual({ mode: "webhook", webhookUrl: WEBHOOK });
  });

  it("改名：在名称字段输入新名 → 产物携带新名称", async () => {
    const io = createFakeWizardIO([
      { kind: "value", value: 0 },
      { kind: "value", value: "renamed-feishu" }, // 改名
      { kind: "value", value: "" },
      { kind: "value", value: "" },
      { kind: "value", value: 0 },
      { kind: "value", value: "" },
      { kind: "value", value: 0 },
    ]);
    const outcome = await runWizard(io, {
      mode: "update",
      type: "feishu",
      current: CURRENT_FEISHU_APP,
    });
    expect(outcome.action === "save" && outcome.name).toBe("renamed-feishu");
  });

  it("可选字段清除：输入 - 清除钉钉加签密钥；必填字段无清除提示", async () => {
    const io = createFakeWizardIO([
      { kind: "value", value: "dd" }, // name
      { kind: "value", value: "" }, // webhookUrl 保留
      { kind: "value", value: "-" }, // secret（可选）→ 清除
      { kind: "value", value: 0 }, // 确认
    ]);
    const outcome = await runWizard(io, {
      mode: "update",
      type: "dingtalk",
      current: { name: "dd", credentials: { webhookUrl: WEBHOOK, secret: "SEC-xyz" } },
    });
    expect(outcome.action).toBe("save");
    if (outcome.action !== "save") return;
    expect(outcome.credentials.secret).toBeUndefined();
    expect(outcome.credentials).toMatchObject({ webhookUrl: WEBHOOK });
  });

  it("取消：首步取消 → cancel 且无任何写入语义产物", async () => {
    const io = createFakeWizardIO([{ kind: "cancel" }]);
    const outcome = await runWizard(io, {
      mode: "update",
      type: "feishu",
      current: CURRENT_FEISHU_APP,
    });
    expect(outcome).toEqual({ action: "cancel" });
  });
});
