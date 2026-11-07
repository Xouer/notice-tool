#!/usr/bin/env node
import { Command, CommanderError } from "commander";
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { Readable } from "node:stream";
import { loadConfig, type NoticeConfig } from "../config/loader.js";
import { openFileDatabase, type NoticeDatabase } from "../storage/db.js";
import { seedDefaultTemplates } from "../storage/seed.js";
import { ChannelRepository } from "../storage/channel-repository.js";
import { TemplateRepository } from "../storage/template-repository.js";
import { BlobCipher } from "../storage/crypto.js";
import { InMemorySecretStore, type SecretStore } from "../storage/secret-store.js";
import { DpapiSecretStore } from "../storage/secret-store.dpapi.js";
import { isPlatformSupported } from "@primno/dpapi";
import { redactSensitive } from "../core/logger.js";
import { TemplateError } from "../core/template.js";
import { ChannelConfigError } from "../channels/channel-config.js";
import { EventValidationError } from "../core/event-pipeline.js";
import { getAdapter } from "../channels/index.js";
import type { TriggerType } from "../storage/schema.js";
import { ingestTaskEndEvent, type IngestResult } from "../core/event-pipeline.js";
import { registerChannelCommands } from "./channel.js";
import { registerTemplateCommands } from "./template.js";
import { registerHookCommand } from "./hook.js";
import { registerServeCommand } from "./serve.js";
import { registerWatchCommand } from "./watch.js";
import { registerMcpCommand } from "./mcp.js";
import { registerHistoryCommands } from "./history.js";
import type { WizardIO } from "./wizard-io.js";
import { CliFailure } from "./cli-failure.js";

/**
 * CLI 根入口（T026/T040/T043/T044/T045）：commander 程序、全局参数 --config/--json、
 * 退出码契约 0/1/2/3（contracts/cli.md）。
 * mcp/watch 子命令在后续任务（T053/T058）注册。
 */
export const VERSION = "0.1.0";

export { CliFailure };

export interface CliRunOptions {
  dataDir?: string;
  out?: (s: string) => void;
  err?: (s: string) => void;
  /** stdin 注入接缝（notice hook 读取负载）。 */
  stdin?: Readable;
  /** 向导 IO 注入接缝（T012，测试用；未注入时按需构造真实终端 IO）。 */
  wizardIO?: WizardIO;
}

export interface CliContext {
  dataDir: string;
  json: boolean;
  configPath?: string;
  out: (s: string) => void;
  err: (s: string) => void;
  stdin?: Readable;
  /** 交互式配置向导 IO（channel add 分派使用；测试注入接缝）。 */
  wizardIO?: WizardIO;
}

/** 数据目录：NOTICE_DATA_DIR 环境变量优先（测试接缝），否则 %APPDATA%/notice-tool。 */
export function defaultDataDir(): string {
  if (process.env.NOTICE_DATA_DIR !== undefined && process.env.NOTICE_DATA_DIR !== "") {
    return process.env.NOTICE_DATA_DIR;
  }
  const base = process.env.APPDATA ?? join(homedir(), ".config");
  return join(base, "notice-tool");
}

function defaultConfig(): NoticeConfig {
  return loadConfig({});
}

/** 初始化数据目录（幂等）：目录 + config.json + 数据库迁移 + 默认模板。 */
export function ensureInitialized(ctx: CliContext): void {
  mkdirSync(ctx.dataDir, { recursive: true });
  const configPath = ctx.configPath ?? join(ctx.dataDir, "config.json");
  if (!existsSync(configPath)) {
    writeFileSync(configPath, `${JSON.stringify(defaultConfig(), null, 2)}\n`, "utf8");
  }
}

interface OpenedStore {
  db: NoticeDatabase;
  repo: ChannelRepository;
  templates: TemplateRepository;
  close: () => void;
}

export type { OpenedStore };

/** 构建统一事件接入管线入口（CLI/HTTP 共用，T041）。 */
export function createIngest(
  store: OpenedStore,
  ctx: CliContext,
  dispatchOptions?: { maxAttempts?: number; retryDelayMs?: number },
): (payload: unknown, trigger: TriggerType) => Promise<IngestResult> {
  return (payload, trigger) =>
    ingestTaskEndEvent(
      {
        db: store.db,
        channels: store.repo,
        templates: store.templates,
        getAdapter,
        config: { cooldownMinutes: loadCliConfig(ctx).dedup.cooldownMinutes },
        dispatchOptions,
      },
      payload,
      { trigger },
    );
}

function loadCliConfig(ctx: CliContext): NoticeConfig {
  const configPath = ctx.configPath ?? join(ctx.dataDir, "config.json");
  if (!existsSync(configPath)) {
    return loadConfig({});
  }
  try {
    return loadConfig(readFileSync(configPath, "utf8"), (message) => ctx.err(`${message}\n`));
  } catch (cause) {
    throw new CliFailure(
      `配置文件无效：${cause instanceof Error ? cause.message : String(cause)}`,
      3,
    );
  }
}

/**
 * 创建主密钥托管：Windows 用 DPAPI（CurrentUser 边界，密钥加密落盘 dataDir/secret.key）；
 * 其他平台回退内存实现（进程退出即失效，仅测试/开发用）。
 */
function createSecretStore(ctx: CliContext): SecretStore {
  if (isPlatformSupported) {
    return new DpapiSecretStore(join(ctx.dataDir, "secret.key"));
  }
  ctx.err("警告：当前平台不支持 DPAPI，主密钥仅驻留内存，凭据跨进程不可解密。\n");
  return new InMemorySecretStore();
}

function openStore(ctx: CliContext): OpenedStore {
  ensureInitialized(ctx);
  try {
    const db = openFileDatabase(join(ctx.dataDir, "notice.db"));
    seedDefaultTemplates(db);
    const cipher = new BlobCipher(createSecretStore(ctx).getMainKey());
    return {
      db,
      repo: new ChannelRepository(db, cipher),
      templates: new TemplateRepository(db),
      close: () => {
        try {
          db.$client.close();
        } catch {
          // 已关闭
        }
      },
    };
  } catch (cause) {
    throw new CliFailure(
      `本地存储不可用：${cause instanceof Error ? cause.message : String(cause)}`,
      3,
    );
  }
}

export async function runCli(argv: string[], opts: CliRunOptions = {}): Promise<number> {
  const out = opts.out ?? ((s: string) => process.stdout.write(s));
  const err = opts.err ?? ((s: string) => process.stderr.write(s));

  let globalJson = false;
  let globalConfigPath: string | undefined;

  const program = new Command();
  program
    .name("notice")
    .description("notice — 本地常驻的智能体任务完成通知工具")
    .version(VERSION)
    .configureOutput({ writeOut: (s) => out(s), writeErr: (s) => err(s) })
    .exitOverride()
    .option("--config <path>", "指定配置文件路径")
    .option("--json", "输出机器可读 JSON");

  program.hook("preAction", (thisCommand) => {
    const opts = thisCommand.opts() as { json?: boolean; config?: string };
    globalJson = opts.json === true;
    globalConfigPath = opts.config;
  });

  const makeContext = (): CliContext => ({
    dataDir: opts.dataDir ?? defaultDataDir(),
    json: globalJson,
    configPath: globalConfigPath,
    out,
    err,
    stdin: opts.stdin,
    wizardIO: opts.wizardIO,
  });

  program
    .command("init")
    .description("初始化用户数据目录、数据库与默认模板")
    .action(() => {
      const ctx = makeContext();
      ensureInitialized(ctx);
      const store = openStore(ctx);
      store.close();
      if (ctx.json) {
        out(`${JSON.stringify({ dataDir: ctx.dataDir })}\n`);
      } else {
        out(`已初始化：${ctx.dataDir}（数据库与默认模板就绪）\n`);
      }
    });

  registerChannelCommands(program, makeContext, openStore);
  registerTemplateCommands(program, makeContext, openStore);
  registerHookCommand(program, makeContext, openStore);
  registerServeCommand(program, makeContext, openStore);
  registerWatchCommand(program, makeContext, openStore);
  registerMcpCommand(program, makeContext, openStore);
  registerHistoryCommands(program, makeContext, openStore);

  try {
    await program.parseAsync(argv, { from: "user" });
    return 0;
  } catch (cause) {
    if (cause instanceof CommanderError) {
      if (cause.exitCode === 0) return 0; // help / version
      return 2; // 用法错误 → 输入校验失败
    }
    if (cause instanceof EventValidationError) {
      err(
        `${JSON.stringify({ error: "VALIDATION_FAILED", details: cause.details })}\n`,
      );
      return 2;
    }
    if (cause instanceof CliFailure) {
      if (cause.message !== "") {
        err(`${cause.message}\n`);
      }
      return cause.exitCode;
    }
    if (cause instanceof ChannelConfigError) {
      err(`输入校验失败：${cause.message}\n`);
      return 2;
    }
    if (cause instanceof TemplateError) {
      err(`输入校验失败：${cause.message}\n`);
      return 2;
    }
    if (cause instanceof Error && cause.name === "SqliteError") {
      err(`本地存储异常：${redactSensitive(cause.message)}\n`);
      return 3;
    }
    err(`执行失败：${redactSensitive(cause instanceof Error ? cause.message : String(cause))}\n`);
    return 1;
  }
}

// 直接执行（bin）时运行真实 CLI。
// Windows 下 npm link 生成符号链接：argv[1] 为链接路径而 import.meta.url 为真实路径，
// 两侧均经 realpath 归一后再比较（否则全局命令静默不执行）。
if (process.argv[1] !== undefined) {
  try {
    const invoked = pathToFileURL(realpathSync(process.argv[1])).href;
    const self = pathToFileURL(realpathSync(fileURLToPath(import.meta.url))).href;
    if (invoked === self) {
      process.exitCode = await runCli(process.argv.slice(2));
    }
  } catch {
    // 路径解析失败（如文件不存在）→ 非 CLI 直执行场景，保持静默
  }
}
