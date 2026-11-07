import Fastify, { type FastifyError, type FastifyInstance } from "fastify";
import {
  RESULT_STATUSES,
  TRIGGER_TYPES,
  type TriggerType,
} from "../storage/schema.js";
import type { IngestResult } from "../core/event-pipeline.js";
import { EventValidationError } from "../core/event-pipeline.js";
import { redactSensitive } from "../core/logger.js";

/**
 * Fastify 钩子服务（T042，contracts/hook-receiver.md 入口二）：
 * POST /v1/hooks/task-completed，仅绑定回环地址；
 * JSON Schema 内建校验（FR-013），响应 202/400/429/500。
 */
export interface HookServerDeps {
  ingest: (payload: unknown, trigger: TriggerType) => Promise<IngestResult>;
}

export interface HookServerOptions {
  /** 来源级限流器；返回 false → 429 RATE_LIMITED（FR-013 防滥用）。 */
  rateLimiter?: (source: string) => boolean;
}

const PAYLOAD_SCHEMA = {
  type: "object",
  required: ["schemaVersion", "source", "taskId"],
  additionalProperties: true,
  properties: {
    schemaVersion: { type: "integer", const: 1 },
    source: { type: "string", minLength: 1, maxLength: 64 },
    taskId: { type: "string", minLength: 1, maxLength: 256 },
    finishedAt: { type: "string" },
    result: { type: "string", enum: [...RESULT_STATUSES] },
    resultSummary: { type: "string", maxLength: 500 },
    trigger: { type: "string", enum: [...TRIGGER_TYPES] },
  },
} as const;

/** 创建钩子 HTTP 服务（测试经 inject() 免网络注入；运行时 listen 在回环地址）。 */
export async function createHookServer(
  deps: HookServerDeps,
  options: HookServerOptions = {},
): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });

  app.setErrorHandler((error: FastifyError, _request, reply) => {
    if (error.validation !== undefined) {
      return reply.code(400).send({
        error: "VALIDATION_FAILED",
        details: error.validation.map((v) => String(v.message ?? v.instancePath)),
      });
    }
    return reply.code(500).send({
      error: "INTERNAL",
      details: redactSensitive(error.message ?? "未知错误").slice(0, 200),
    });
  });

  app.post("/v1/hooks/task-completed", { schema: { body: PAYLOAD_SCHEMA } }, async (request, reply) => {
    const body = request.body as Record<string, unknown>;
    if (options.rateLimiter !== undefined && !options.rateLimiter(String(body.source))) {
      return reply.code(429).send({ error: "RATE_LIMITED", retryAfterMs: 60_000 });
    }
    try {
      const result = await deps.ingest(body, "hook");
      return reply.code(202).send({
        eventId: result.eventId,
        deduplicated: result.deduplicated,
      });
    } catch (cause) {
      if (cause instanceof EventValidationError) {
        return reply.code(400).send({ error: "VALIDATION_FAILED", details: cause.details });
      }
      throw cause;
    }
  });

  await app.ready();
  return app;
}
