import type { Command } from "commander";
import { ChannelConfigError, validateChannelInput } from "../channels/channel-config.js";
import { getAdapter } from "../channels/index.js";
import { CHANNEL_TYPES, type ChannelType } from "../storage/schema.js";
import { runWizard } from "./wizard.js";
import { createInteractiveWizardIO } from "./wizard-io.js";
import type { WizardIO } from "./wizard-io.js";
import { CliFailure } from "./cli-failure.js";
import type { CliContext, OpenedStore } from "./index.js";

/**
 * CLI channel 子命令（T026，contracts/cli.md）：
 * add / list / enable / disable / remove / test；退出码 0/1/2/3。
 * 交互式输入以标志位参数（非交互）替代实现，供脚本与测试使用；
 * 凭据在 add 时即时加密入库，所有输出一律掩码（FR-012）。
 */
export function registerChannelCommands(
  parent: Command,
  makeContext: () => CliContext,
  openStore: (ctx: CliContext) => OpenedStore,
): void {
  const channel = parent
    .command("channel")
    .description("管理通知渠道（add/list/enable/disable/remove/test）");

  channel
    .command("add")
    .description(
      "添加渠道（凭据即时加密入库，默认未启用；未提供 type 或凭据标志且为交互终端时进入配置向导）",
    )
    .argument("[type]", "渠道类型：feishu|dingtalk|email|wechat|qq（缺省时进入配置向导）")
    .option("--name <name>", "渠道名称（标志路径必填；向导中可留空自动生成）")
    .option("--webhook-url <url>", "Webhook 地址（feishu webhook 模式/dingtalk/wechat）")
    .option("--secret <secret>", "钉钉加签密钥（可选）")
    .option("--mode <mode>", "连接模式：feishu 为 app|webhook（缺省 webhook）；wechat 为 webhook|push；qq 为 official|push")
    .option("--push-key <key>", "Server酱/PushPlus 推送密钥")
    .option("--service <service>", "推送服务：serverchan|pushplus")
    .option("--receive-id-type <type>", "飞书接收目标类型（--mode app 必填）：chat_id|open_id|user_id|union_id|email")
    .option("--receive-id <id>", "飞书接收目标标识（--mode app 必填），如群会话 ID oc_xxx")
    .option("--smtp-host <host>", "SMTP 主机")
    .option("--smtp-port <port>", "SMTP 端口（默认 465）")
    .option("--username <user>", "SMTP 用户名")
    .option("--auth-code <code>", "SMTP 授权码")
    .option("--from <from>", "发件地址")
    .option("--to <to>", "收件地址")
    .option("--app-id <id>", "QQ / 飞书（--mode app）应用 AppID")
    .option("--app-secret <secret>", "QQ / 飞书（--mode app）应用 AppSecret")
    .option("--endpoint <url>", "QQ 消息接口地址")
    .option("--interactive", "强制进入交互式配置向导")
    .action(
      async (type: string | undefined, opts: Record<string, string | undefined> & { interactive?: boolean }) => {
        const ctx = makeContext();
        const typeKnown =
          type !== undefined && (CHANNEL_TYPES as readonly string[]).includes(type);
        const credentialsComplete = typeKnown && hasRequiredCredentials(type as string, opts);
        // 分派矩阵（contracts/wizard.md）：--interactive 或缺 type/凭据标志 → 向导；其余走既有标志路径
        if (opts.interactive === true || !credentialsComplete) {
          if (ctx.json) {
            throw new CliFailure(
              "--json 模式不支持交互式向导：请补齐命令行标志（notice channel add --help），或去掉 --json 在交互终端运行。",
              2,
            );
          }
          const io = ctx.wizardIO ?? createInteractiveWizardIO();
          if (io === undefined) {
            // 非交互环境回落标志路径：由校验定位缺失标志（002 契约：错误定位到具体字段）
            if (!typeKnown) {
              throw new CliFailure(
                "缺少渠道类型与凭据标志：请在交互终端直接运行 notice channel add 进入配置向导，或补齐标志（notice channel add --help）。",
                2,
              );
            }
            const credentials = buildCredentials(type as string, opts);
            addChannel(ctx, openStore, type as string, opts.name ?? "", credentials);
            return;
          }
          await runChannelWizard(io, ctx, openStore, typeKnown ? (type as ChannelType) : undefined, opts.name);
          return;
        }
        const credentials = buildCredentials(type as string, opts);
        addChannel(ctx, openStore, type as string, opts.name ?? "", credentials);
      },
    );

  channel
    .command("list")
    .description("列出渠道（凭据一律掩码显示）")
    .action(() => {
      const ctx = makeContext();
      const store = openStore(ctx);
      try {
        const rows = store.repo.list().map((row) => ({
          name: row.name,
          type: row.type,
          enabled: row.enabled,
          credentials: row.credentialsSummary,
        }));
        if (ctx.json) {
          ctx.out(`${JSON.stringify({ channels: rows }, null, 2)}\n`);
        } else if (rows.length === 0) {
          ctx.out("暂无渠道。使用 `notice channel add <type>` 添加。\n");
        } else {
          for (const row of rows) {
            ctx.out(
              `${row.name}\t${row.type}\t${row.enabled ? "已启用" : "未启用"}\t${row.credentials}\n`,
            );
          }
        }
      } finally {
        store.close();
      }
    });

  for (const [sub, enabled] of [
    ["enable", true],
    ["disable", false],
  ] as const) {
    channel
      .command(sub)
      .description(`${enabled ? "启用" : "禁用"}渠道`)
      .argument("<name>", "渠道名称")
      .action((name: string) => {
        const ctx = makeContext();
        const store = openStore(ctx);
        try {
          const row = findRow(store, name);
          store.repo.setEnabled(row.id, enabled);
          ctx.out(
            `${ctx.json ? `${JSON.stringify({ name: row.name, enabled })}\n` : `已${enabled ? "启用" : "禁用"}：${row.name}\n`}`,
          );
        } finally {
          store.close();
        }
      });
  }

  channel
    .command("remove")
    .description("删除渠道并物理清除其凭据（历史通知记录保留）")
    .argument("<name>", "渠道名称")
    .action((name: string) => {
      const ctx = makeContext();
      const store = openStore(ctx);
      try {
        const row = findRow(store, name);
        store.repo.remove(row.id);
        ctx.out(
          ctx.json
            ? `${JSON.stringify({ removed: row.name })}\n`
            : `已删除：${row.name}（凭据已清除，历史通知记录保留）\n`,
        );
      } finally {
        store.close();
      }
    });

  channel
    .command("test")
    .description("发送测试消息并显示结果（成功后自动启用）")
    .argument("<name>", "渠道名称")
    .option("--message <text>", "自定义测试消息")
    .action(async (name: string, opts: { message?: string }) => {
      const ctx = makeContext();
      const store = openStore(ctx);
      try {
        const row = findRow(store, name);
        const credentials = store.repo.getCredentials(row.id);
        const adapter = getAdapter(row.type);
        const outcome = await adapter.send({
          title: "notice 测试消息",
          message: opts.message ?? "这是一条来自 notice 的测试消息。",
        }, credentials);
        if (outcome.ok) {
          // 测试发送通过 → 启用（data-model.md 状态机：draft → enabled）
          store.repo.setEnabled(row.id, true);
          ctx.out(
            ctx.json
              ? `${JSON.stringify({ ok: true, name: row.name, enabled: true })}\n`
              : `测试发送成功：${row.name}（已自动启用）\n`,
          );
        } else {
          const failureMessage = `测试发送失败 [${outcome.errorCode}] ${outcome.message}`;
          if (ctx.json) {
            ctx.out(
              `${JSON.stringify({ ok: false, name: row.name, errorCode: outcome.errorCode, message: outcome.message })}\n`,
            );
          }
          throw new CliFailure(failureMessage, 1);
        }
      } finally {
        store.close();
      }
    });
}

function findRow(store: OpenedStore, name: string) {
  const row = store.repo.findByName(name);
  if (row === undefined) {
    throw new CliFailure(`未找到渠道：${name}（使用 \`notice channel list\` 查看）`, 2);
  }
  return row;
}

/** 创建渠道并按 --json/人读两种形态输出（标志路径与向导路径共用）。 */
function addChannel(
  ctx: CliContext,
  openStore: (ctx: CliContext) => OpenedStore,
  type: string,
  name: string,
  credentials: Record<string, unknown>,
): void {
  const store = openStore(ctx);
  try {
    const row = store.repo.create({ type, name, credentials });
    if (ctx.json) {
      ctx.out(
        `${JSON.stringify({
          channel: { name: row.name, type: row.type, enabled: row.enabled },
        })}\n`,
      );
    } else {
      ctx.out(
        `渠道已添加：${row.name}（${row.type}）。凭据已加密入库，当前未启用；测试发送成功后自动启用。\n`,
      );
    }
  } finally {
    store.close();
  }
}

/**
 * 判断标志位是否已齐备该渠道的必填凭据（contracts/wizard.md 分派矩阵）。
 * 仅用于决定"走标志路径还是向导"；最终合法性仍由 buildCredentials/validateChannelInput 校验。
 */
function hasRequiredCredentials(
  type: string,
  opts: Record<string, string | undefined>,
): boolean {
  switch (type) {
    case "feishu":
      if (opts.mode === "app") {
        return !!(opts.appId && opts.appSecret && opts.receiveIdType && opts.receiveId);
      }
      return opts.webhookUrl !== undefined; // mode 缺省按 webhook（既有语义）
    case "dingtalk":
      return opts.webhookUrl !== undefined;
    case "email":
      return !!(opts.smtpHost && opts.authCode && opts.to);
    case "wechat":
      if (opts.mode === "push") return opts.pushKey !== undefined;
      if (opts.mode === "webhook") return opts.webhookUrl !== undefined;
      return false;
    case "qq":
      if (opts.mode === "official") {
        return !!(opts.appId && opts.appSecret && opts.endpoint);
      }
      if (opts.mode === "push") return opts.pushKey !== undefined;
      return false;
    default:
      return false;
  }
}

/**
 * T011：交互式配置向导入口（US1–US3）。
 * - 非 TTY（且无注入 IO）→ 退出码 2 并指引标志方式（FR-008）
 * - --json → 拒绝向导并指引补齐标志（research R8，stdout 保持纯 JSON）
 * - 引擎 save → validateChannelInput 终验（等价性 FR-009）→ 重名检测（R7）→ repo.create 唯一写入点（SC-003）
 */
async function runChannelWizard(
  io: WizardIO,
  ctx: CliContext,
  openStore: (ctx: CliContext) => OpenedStore,
  seedType: ChannelType | undefined,
  nameFlag: string | undefined,
): Promise<void> {
  const values: Record<string, string> = {};
  if (nameFlag !== undefined && nameFlag.trim() !== "") values.name = nameFlag.trim();
  for (;;) {
    const outcome = await runWizard(io, { type: seedType, values });
    if (outcome.action === "cancel") {
      ctx.out("已取消，未做任何更改。\n");
      return;
    }
    const store = openStore(ctx);
    try {
      // 重名检测（R7）：改名 / 显式覆盖 / 取消，不静默覆盖
      let finalName = outcome.name;
      let overwriteId: string | undefined;
      let rewalk = false;
      for (;;) {
        const existing = store.repo.findByName(finalName);
        if (existing === undefined) break;
        const choice = await io.choose(`渠道名称"${finalName}"已存在`, [
          { label: "重新输入名称", hint: "保留当前凭据，仅更换渠道名称" },
          { label: "覆盖既有渠道", hint: `删除现有"${finalName}"并以当前输入替换（不可恢复）` },
        ]);
        if (choice.kind === "cancel") {
          ctx.out("已取消，未做任何更改。\n");
          return;
        }
        if (choice.kind === "back") {
          rewalk = true;
          break;
        }
        if (choice.value === 0) {
          const renamed = await io.ask("请输入新的渠道名称");
          if (renamed.kind !== "value" || renamed.value.trim() === "") {
            io.print("✗ 名称不能为空，请重试");
            continue;
          }
          finalName = renamed.value.trim();
          continue;
        }
        overwriteId = existing.id; // 显式选择覆盖即确认
        break;
      }
      if (rewalk) {
        values.name = finalName;
        continue;
      }
      try {
        validateChannelInput(outcome.type, finalName, outcome.credentials);
      } catch (cause) {
        io.print(
          `✗ 配置校验失败：${cause instanceof Error ? cause.message : String(cause)}，请修改后重试`,
        );
        values.name = finalName;
        continue;
      }
      if (overwriteId !== undefined) store.repo.remove(overwriteId);
      const row = store.repo.create({
        type: outcome.type,
        name: finalName,
        credentials: outcome.credentials,
      });
      ctx.out(
        `渠道已添加：${row.name}（${row.type}）。凭据已加密入库，当前未启用；测试发送成功后自动启用。\n`,
      );
      return;
    } finally {
      store.close();
    }
  }
}

/** 从 CLI 标志位组装凭据对象（缺失字段由 validateChannelInput 给出明确错误）。 */
function buildCredentials(
  type: string,
  opts: Record<string, string | undefined>,
): Record<string, unknown> {
  const credentials: Record<string, unknown> = {};
  const put = (key: string, value: string | undefined): void => {
    if (value !== undefined) credentials[key] = value;
  };
  put("webhookUrl", opts.webhookUrl);
  put("secret", opts.secret);
  put("mode", opts.mode);
  put("receiveIdType", opts.receiveIdType);
  put("receiveId", opts.receiveId);
  put("pushKey", opts.pushKey);
  put("service", opts.service);
  put("smtpHost", opts.smtpHost);
  if (opts.smtpPort !== undefined) {
    const port = Number(opts.smtpPort);
    if (!Number.isInteger(port)) {
      throw new ChannelConfigError("--smtp-port 必须为整数");
    }
    credentials.smtpPort = port;
  }
  put("username", opts.username);
  put("authCode", opts.authCode);
  put("from", opts.from);
  put("to", opts.to);
  put("appId", opts.appId);
  put("appSecret", opts.appSecret);
  put("endpoint", opts.endpoint);
  // 尽早校验（add 动作中也由仓储层再校验一次）
  validateChannelInput(type, opts.name ?? "", credentials);
  return credentials;
}
