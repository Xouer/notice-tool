import type { Command } from "commander";
import { ChannelConfigError, validateChannelInput } from "../channels/channel-config.js";
import { getAdapter } from "../channels/index.js";
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
    .description("添加渠道（凭据即时加密入库，默认未启用）")
    .argument("<type>", "渠道类型：feishu|dingtalk|email|wechat|qq")
    .requiredOption("--name <name>", "渠道名称")
    .option("--webhook-url <url>", "Webhook 地址（feishu webhook 模式/dingtalk/wechat）")
    .option("--secret <secret>", "钉钉加签密钥（可选）")
    .option("--mode <mode>", "连接模式：feishu 为 app|webhook（缺省 webhook）；wechat 为 webhook|push；qq 为 official|push")
    .option("--push-key <key>", "Server酱/PushPlus 推送密钥")
    .option("--service <service>", "推送服务：serverchan|pushplus")
    .option("--receive-id-type <type>", "飞书接收目标类型（--mode app 必填）：chat_id|open_id|user_id|email")
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
    .action((type: string, opts: Record<string, string | undefined>) => {
      const ctx = makeContext();
      const credentials = buildCredentials(type, opts);
      const store = openStore(ctx);
      try {
        const row = store.repo.create({ type, name: opts.name ?? "", credentials });
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
    });

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
