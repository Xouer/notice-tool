import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

/**
 * 008：来源 Stop 事件身份助手。
 * 显式 ID 优先；其次用有界转录终态记录的稳定标识生成不可逆散列；
 * 均不可得时按本次调用降级，优先保证真实 Stop 不漏通知。
 */
const TRANSCRIPT_TAIL_BYTES = 64 * 1024;
const MAX_EVENT_KEY_LENGTH = 512;

export interface TerminalTranscriptIdentity {
  identity: string;
}

export interface ResolvedStopIdentity {
  eventKey: string;
  degraded: boolean;
  warning?: string;
}

/** 将稳定来源标识转换为不透明、有界的事件键。 */
export function createStableEventKey(namespace: string): string {
  const digest = createHash("sha256").update(namespace).digest("hex");
  return `sha256:${digest}`;
}

/** 无稳定身份时的降级事件键；仅代表本次调用，不承诺识别后续重报。 */
export function createDegradedEventKey(): string {
  return `degraded:${randomUUID()}`;
}

/** 生成不含完整路径、正文或原始负载的降级提示。 */
export function degradedIdentityWarning(): string {
  return "无法获得来源稳定事件身份：本次按新 Stop 受理以避免漏报，同一事件重复上报可能无法精确去重";
}

/** 读取转录尾部最后一个 result 记录的稳定标识；不返回路径或正文。 */
export function readTerminalTranscriptIdentity(
  transcriptPath: string,
): TerminalTranscriptIdentity | undefined {
  try {
    const buffer = readFileSync(transcriptPath);
    if (buffer.length === 0) return undefined;
    const tail = buffer.subarray(Math.max(0, buffer.length - TRANSCRIPT_TAIL_BYTES));
    const lines = tail
      .toString("utf8")
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    for (let index = lines.length - 1; index >= 0; index -= 1) {
      const line = lines[index]!;
      try {
        const parsed = JSON.parse(line) as Record<string, unknown>;
        if (parsed.type !== "result") continue;
        const uuid = typeof parsed.uuid === "string" ? parsed.uuid : undefined;
        const timestamp = typeof parsed.timestamp === "string" ? parsed.timestamp : undefined;
        const identity = uuid ?? timestamp ?? `line:${index}`;
        return { identity };
      } catch {
        continue;
      }
    }
  } catch {
    return undefined;
  }
  return undefined;
}

/** 统一解析来源 Stop 身份：显式键优先，稳定标识其次，最后降级。 */
export function resolveStopEventKey(options: {
  source: string;
  taskId: string;
  explicitEventKey?: unknown;
  stableIdentity?: string | undefined;
  transcriptPath?: string | undefined;
  onDegraded?: (message: string) => void;
}): ResolvedStopIdentity {
  if (
    typeof options.explicitEventKey === "string" &&
    options.explicitEventKey.trim().length > 0 &&
    options.explicitEventKey.length <= MAX_EVENT_KEY_LENGTH
  ) {
    return { eventKey: options.explicitEventKey, degraded: false };
  }

  const terminal =
    options.stableIdentity !== undefined
      ? { identity: options.stableIdentity }
      : readTerminalTranscriptIdentity(options.transcriptPath ?? "");
  if (terminal !== undefined) {
    return {
      eventKey: createStableEventKey(`${options.source}:${options.taskId}:${terminal.identity}`),
      degraded: false,
    };
  }

  const eventKey = createDegradedEventKey();
  const warning = degradedIdentityWarning();
  options.onDegraded?.(warning);
  return { eventKey, degraded: true, warning };
}

export { MAX_EVENT_KEY_LENGTH };
