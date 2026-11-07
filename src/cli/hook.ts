import type { Command } from "commander";
import type { Readable } from "node:stream";
import { EventValidationError } from "../core/event-pipeline.js";
import { RESULT_STATUSES, type ResultStatus } from "../storage/schema.js";
import { createIngest } from "./index.js";
import { CliFailure } from "./cli-failure.js";
import type { CliContext, OpenedStore } from "./index.js";

/**
 * 005-ai-task-dialog-link：外部产品任务结束负载 → 标准事件负载映射。
 * 可选字段缺失走默认值而非失败（FR-002）；无任务标识（无法去重）整体拒绝（FR-004）。
 * 已知来源（FR-009）：codebuddy / codex-cli / claude-code。
 */
const KNOWN_SOURCES = ["codebuddy", "codex-cli", "claude-code"] as const;
export type KnownSource = (typeof KNOWN_SOURCES)[number];

export function isKnownSource(value: string): value is KnownSource {
  return (KNOWN_SOURCES as readonly string[]).includes(value);
}

/** 映射结果：mapped=标准负载；ignored=非目标事件类型（静默忽略，退出码 0）。 */
export type MappedSourcePayload =
  | { status: "mapped"; payload: Record<string, unknown> }
  | { status: "ignored" };

const SUMMARY_MAX_LENGTH = 500;

function optionalNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function optionalIsoTime(value: unknown): string | undefined {
  const s = optionalNonEmptyString(value);
  if (s === undefined || Number.isNaN(Date.parse(s))) return undefined;
  return s;
}

function optionalResultStatus(value: unknown): ResultStatus | undefined {
  if (typeof value === "string" && (RESULT_STATUSES as readonly string[]).includes(value)) {
    return value as ResultStatus;
  }
  return undefined;
}

function requireTaskId(value: unknown, field: string): string {
  const taskId = optionalNonEmptyString(value);
  if (taskId === undefined) {
    throw new EventValidationError([`缺少必填字段 ${field}`]);
  }
  if (taskId.length > 256) {
    throw new EventValidationError([`字段 ${field} 长度超过上限 256`]);
  }
  return taskId;
}

/**
 * CodeBuddy Stop 钩子负载映射（contracts/dialog-source-integration.md）：
 * session_id → taskId（必填）；result/resultSummary/finishedAt 可选，缺失走默认。
 */
export function mapCodeBuddyStopPayload(raw: unknown): MappedSourcePayload {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new EventValidationError(["负载必须为 JSON 对象"]);
  }
  const body = raw as Record<string, unknown>;
  const taskId = requireTaskId(body.session_id, "session_id");
  const payload: Record<string, unknown> = {
    schemaVersion: 1,
    source: "codebuddy",
    taskId,
    result: optionalResultStatus(body.result) ?? "success",
  };
  const summary = optionalNonEmptyString(body.resultSummary);
  if (summary !== undefined) {
    payload.resultSummary = summary.slice(0, SUMMARY_MAX_LENGTH);
  }
  payload.finishedAt = optionalIsoTime(body.finishedAt) ?? new Date().toISOString();
  return { status: "mapped", payload };
}

/** 按来源分发映射：claude-code 的 Stop 钩子与 CodeBuddy 同形（session_id），共用映射。 */
function mapSourcePayload(source: KnownSource, raw: unknown): MappedSourcePayload {
  switch (source) {
    case "codebuddy":
    case "claude-code":
      return mapCodeBuddyStopPayload(raw);
    case "codex-cli":
      return mapCodexNotifyPayload(raw);
  }
}

/**
 * Codex notify 负载映射（contracts/dialog-source-integration.md）：
 * 仅处理 type=agent-turn-complete（其余静默忽略）；thread-id → taskId（必填）；
 * last-assistant-message → resultSummary（截断至管线 500 上限）；缺省字段走默认值。
 */
export function mapCodexNotifyPayload(raw: unknown): MappedSourcePayload {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new EventValidationError(["负载必须为 JSON 对象"]);
  }
  const body = raw as Record<string, unknown>;
  if (body.type !== "agent-turn-complete") {
    return { status: "ignored" };
  }
  const taskId = requireTaskId(body["thread-id"] ?? body.thread_id, "thread-id");
  const payload: Record<string, unknown> = {
    schemaVersion: 1,
    source: "codex-cli",
    taskId,
    result: optionalResultStatus(body.result) ?? "success",
  };
  const summary = optionalNonEmptyString(body["last-assistant-message"]);
  if (summary !== undefined) {
    payload.resultSummary = summary.slice(0, SUMMARY_MAX_LENGTH);
  }
  payload.finishedAt = optionalIsoTime(body.finishedAt) ?? new Date().toISOString();
  return { status: "mapped", payload };
}

/**
 * CLI stdin 钩子入口（T043，contracts/hook-receiver.md 入口一）：
 * 从标准输入读取 UTF-8 JSON 负载，复用统一管线后退出。
 * 005 扩展：--source 指定外部产品来源（按产品映射负载）；--payload-argv 从 argv 读取
 * （Codex notify 以命令行参数传递事件 JSON）。
 * 退出码：0 成功；2 负载校验失败（stderr 机器可读错误 JSON）；3 本地服务/存储异常。
 */
export function registerHookCommand(
  parent: Command,
  makeContext: () => CliContext,
  openStore: (ctx: CliContext) => OpenedStore,
): void {
  parent
    .command("hook")
    .description("从 stdin 读取任务结束事件 JSON 并触发通知（供智能体钩子注册）")
    .option("--source <name>", "外部产品来源（codebuddy/codex-cli/claude-code），按产品映射负载")
    .option("--payload-argv", "从命令行参数而非 stdin 读取事件 JSON（Codex notify 调用方式）")
    .argument("[args...]", "Codex notify 追加的事件 JSON 参数")
    .action(async (args: string[], opts: { source?: string; payloadArgv?: boolean }) => {
      const ctx = makeContext();
      let raw: string;
      if (opts.payloadArgv === true) {
        const arg = args[args.length - 1];
        if (arg === undefined || arg.trim() === "") {
          ctx.err(
            `${JSON.stringify({ error: "VALIDATION_FAILED", details: ["缺少 argv 负载"] })}\n`,
          );
          throw new CliFailure("", 2);
        }
        raw = arg.trim();
      } else {
        raw = (await readStdin(ctx.stdin)).replace(/^\uFEFF/, "").trim();
      }
      let payload: unknown;
      try {
        payload = JSON.parse(raw);
      } catch {
        const origin = opts.payloadArgv === true ? "argv 负载" : "stdin";
        ctx.err(
          `${JSON.stringify({ error: "VALIDATION_FAILED", details: [`${origin} 不是合法 JSON`] })}\n`,
        );
        throw new CliFailure("", 2);
      }
      let mapped: MappedSourcePayload | undefined;
      if (opts.source !== undefined) {
        if (!isKnownSource(opts.source)) {
          throw new EventValidationError([
            `不支持的 --source 值: ${opts.source}（支持 ${KNOWN_SOURCES.join("/")}）`,
          ]);
        }
        mapped = mapSourcePayload(opts.source, payload);
      }
      if (mapped?.status === "ignored") {
        // 非目标事件类型（contracts：静默忽略，退出码 0），不落库不通知
        return;
      }
      if (mapped?.status === "mapped") {
        payload = mapped.payload;
      }
      const store = openStore(ctx);
      try {
        const result = await createIngest(store, ctx)(payload, "hook");
        const summary = {
          eventId: result.eventId,
          deduplicated: result.deduplicated,
          notified: result.records.length,
          message: result.message,
        };
        if (ctx.json) {
          ctx.out(`${JSON.stringify(summary)}\n`);
        } else if (result.deduplicated) {
          ctx.out(`事件为重复（冷却窗口内），已记录未重复通知：${result.eventId}\n`);
        } else if (result.records.length === 0) {
          ctx.out(`事件已受理：${result.eventId}\n${result.message ?? ""}\n`);
        } else {
          const sent = result.records.filter((r) => r.status === "sent").length;
          const failed = result.records.length - sent;
          ctx.out(
            `事件已受理：${result.eventId}（成功 ${sent} 渠道${failed > 0 ? `，失败 ${failed} 渠道` : ""}）\n`,
          );
        }
      } finally {
        store.close();
      }
    });
}

async function readStdin(injected?: Readable): Promise<string> {
  const stream = injected ?? process.stdin;
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

// EventValidationError 由根入口统一映射退出码 2（机器可读 JSON）
export { EventValidationError };
