import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { CHANNEL_TYPES, RESULT_STATUSES, TRIGGER_TYPES } from "../storage/schema.js";
import { EventValidationError } from "../core/event-pipeline.js";
import { redactSensitive } from "../core/logger.js";
import { McpToolValidationError } from "./tools/send-notification.js";

/**
 * MCP stdio 服务端（T055，contracts/mcp-tools.md / research.md R3/R9）：
 * 白名单仅暴露 send_notification 与 report_task_end 两个工具（最小暴露）。
 * 采用低层 Server + 手写 JSON Schema：契约错误码由处理器保证
 * （VALIDATION_FAILED / INTERNAL），Schema 与契约逐字段一致。
 */
export interface McpServerDeps {
  ingestTaskEnd: (payload: unknown) => Promise<{ eventId: string; deduplicated: boolean }>;
  sendNotification: (params: unknown) => Promise<{
    delivered: string[];
    failed: Array<{ channel: string; errorCode: string }>;
  }>;
}

const SEND_NOTIFICATION_SCHEMA = {
  type: "object" as const,
  required: ["schemaVersion", "message"],
  additionalProperties: false,
  properties: {
    schemaVersion: { type: "integer", description: "负载结构版本，当前 1" },
    message: { type: "string", minLength: 1, maxLength: 2000, description: "通知正文" },
    title: { type: "string", maxLength: 100, description: "标题（可选）" },
    channels: {
      type: "array",
      items: { type: "string", enum: [...CHANNEL_TYPES] },
      description: "目标渠道类型数组（缺省发送全部已启用渠道）",
    },
  },
};

const REPORT_TASK_END_SCHEMA = {
  type: "object" as const,
  required: ["schemaVersion", "source", "taskId"],
  additionalProperties: true,
  properties: {
    schemaVersion: { type: "integer", description: "负载结构版本，当前 1" },
    source: { type: "string", maxLength: 64, description: "来源智能体标识" },
    taskId: { type: "string", maxLength: 256, description: "任务/会话标识" },
    finishedAt: { type: "string", description: "ISO 8601 结束时间（缺省取接收时间）" },
    result: { type: "string", enum: [...RESULT_STATUSES], description: "任务结果" },
    resultSummary: { type: "string", maxLength: 500, description: "结束概要" },
    trigger: { type: "string", enum: [...TRIGGER_TYPES], description: "固定为 mcp（入参值被覆盖）" },
  },
};

const TOOL_DEFS = [
  {
    name: "send_notification",
    description: "发送一条即时通知（不关联任务结束事件），返回逐渠道投递结果",
    inputSchema: SEND_NOTIFICATION_SCHEMA,
  },
  {
    name: "report_task_end",
    description: "上报任务结束事件，走与本地钩子一致的通知管线（trigger 固定为 mcp）",
    inputSchema: REPORT_TASK_END_SCHEMA,
  },
];

export function createMcpServer(deps: McpServerDeps, serverInfo = { name: "notice", version: "0.1.0" }): Server {
  const server = new Server(serverInfo, { capabilities: { tools: {} } });

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOL_DEFS }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const name = request.params.name;
    const args = (request.params.arguments ?? {}) as Record<string, unknown>;
    try {
      if (name === "send_notification") {
        const result = await deps.sendNotification(args);
        return textResult(JSON.stringify(result));
      }
      if (name === "report_task_end") {
        // trigger 固定为 mcp：调用方传入值被覆盖（contracts/mcp-tools.md）
        const { trigger: _ignored, ...payload } = args;
        void _ignored;
        const result = await deps.ingestTaskEnd(payload);
        return textResult(JSON.stringify(result));
      }
      return errorResult("VALIDATION_FAILED", [`未知工具：${name}`]);
    } catch (cause) {
      if (cause instanceof EventValidationError) {
        return errorResult("VALIDATION_FAILED", cause.details);
      }
      if (cause instanceof McpToolValidationError) {
        return errorResult("VALIDATION_FAILED", cause.details);
      }
      // INTERNAL：脱敏摘要，不含堆栈与原始负载回显
      return errorResult("INTERNAL", [
        redactSensitive(cause instanceof Error ? cause.message : "未知错误").slice(0, 200),
      ]);
    }
  });

  return server;
}

function textResult(text: string) {
  return { content: [{ type: "text" as const, text }] };
}

function errorResult(error: string, details: string[]) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify({ error, details }) }],
    isError: true,
  };
}
