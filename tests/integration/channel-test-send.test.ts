import { createServer, type IncomingMessage, type Server } from "node:http";
import net from "node:net";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runCli } from "../../src/cli/index.js";

/**
 * T018：add → test send 集成测试（Red 先行）。
 * - 本地假 HTTP 服务承接 Webhook 负载与 SMTP 假服务器
 * - add 即加密入库、test 送达
 * - 无效 Webhook 返回 AUTH_INVALID / NETWORK_UNREACHABLE 分类且不崩溃
 */
const WEBHOOK =
  "https://open.feishu.example/open-apis/bot/v2/hook/0d1e2f3a4b5c6d7e8f9a0b1c";

let dataDir: string;
const closers: Array<() => void> = [];

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), "notice-e2e-"));
});

afterEach(() => {
  for (const close of closers.splice(0)) {
    try {
      close();
    } catch {
      // ignore
    }
  }
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

function listenHttp(
  handler: (req: IncomingMessage, body: string, res: { json: (code: number, obj: unknown) => void }) => void,
): Promise<number> {
  const server: Server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c as Buffer));
    req.on("end", () => {
      handler(req, Buffer.concat(chunks).toString("utf8"), {
        json: (code, obj) => {
          res.statusCode = code;
          res.setHeader("content-type", "application/json");
          res.end(JSON.stringify(obj));
        },
      });
    });
  });
  closers.push(() => server.close());
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      resolve(typeof addr === "object" && addr !== null ? addr.port : 0);
    });
  });
}

/** 极简 SMTP 假服务器（接收 DATA 正文供断言）。 */
function listenFakeSmtp(received: string[]): Promise<number> {
  const server = net.createServer((socket) => {
    socket.write("220 fake.local ESMTP\r\n");
    let inData = false;
    socket.on("data", (chunk) => {
      for (const rawLine of chunk.toString().split("\r\n")) {
        const line = rawLine.trim();
        if (line.length === 0) continue;
        if (inData) {
          if (line === ".") {
            inData = false;
            socket.write("250 queued\r\n");
          } else {
            received.push(line);
          }
          continue;
        }
        const cmd = line.toUpperCase();
        if (cmd.startsWith("EHLO")) {
          socket.write("250-fake.local\r\n250-SIZE 10485760\r\n250 AUTH PLAIN LOGIN\r\n");
        } else if (cmd.startsWith("AUTH")) {
          socket.write("235 ok\r\n");
        } else if (cmd.startsWith("MAIL FROM") || cmd.startsWith("RCPT TO")) {
          socket.write("250 ok\r\n");
        } else if (cmd.startsWith("DATA")) {
          inData = true;
          socket.write("354 go\r\n");
        } else if (cmd.startsWith("QUIT")) {
          socket.write("221 bye\r\n");
          socket.end();
        } else {
          socket.write("250 ok\r\n");
        }
      }
    });
  });
  closers.push(() => server.close());
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      resolve(typeof addr === "object" && addr !== null ? addr.port : 0);
    });
  });
}

describe("channel add → test send / 渠道添加与测试发送（T018）", () => {
  it("add 即加密入库：数据库 credentials_blob 不含明文", async () => {
    const { code } = await cli([
      "channel",
      "add",
      "feishu",
      "--name",
      "e2e",
      "--webhook-url",
      WEBHOOK,
    ]);
    expect(code).toBe(0);
    // CLI 进程逻辑内已关闭连接；此处直接读取数据库文件
    const raw = readFileSync(join(dataDir, "notice.db"));
    expect(raw.toString("latin1")).not.toContain("0d1e2f3a4b5c6d7e8f9a0b1c");
    expect(raw.toString("latin1")).not.toContain("open.feishu.example");
  });

  it("test 送达假 HTTP 服务（feishu 文本负载），并自动启用渠道", async () => {
    const captured: Array<Record<string, unknown>> = [];
    const port = await listenHttp((_req, body, res) => {
      captured.push(JSON.parse(body) as Record<string, unknown>);
      res.json(200, { code: 0 });
    });
    await cli(["channel", "add", "feishu", "--name", "e2e", "--webhook-url", `http://127.0.0.1:${port}/hook/abc`]);
    const { code, out } = await cli(["channel", "test", "e2e"]);
    expect(code).toBe(0);
    expect(out).toContain("成功");
    expect(captured).toHaveLength(1);
    expect(captured[0]?.msg_type).toBe("text");
    expect(String((captured[0]?.content as { text?: string })?.text).length).toBeGreaterThan(0);

    const listed = JSON.parse(
      (await cli(["channel", "list", "--json"])).out.trim(),
    ) as { channels: Array<{ enabled: boolean }> };
    expect(listed.channels[0]?.enabled).toBe(true); // 测试发送通过后启用（data-model 状态机）
  });

  it("无效 Webhook（连接拒绝）→ NETWORK_UNREACHABLE，退出码 1，不崩溃", async () => {
    await cli(["channel", "add", "feishu", "--name", "bad", "--webhook-url", "http://127.0.0.1:1/hook/x"]);
    const { code, out, errOut } = await cli(["channel", "test", "bad"]);
    expect(code).toBe(1);
    expect(`${out}${errOut}`).toContain("NETWORK_UNREACHABLE");
  });

  it("凭据被拒（HTTP 401）→ AUTH_INVALID", async () => {
    const port = await listenHttp((_req, _body, res) => {
      res.json(401, { error: "unauthorized" });
    });
    await cli(["channel", "add", "feishu", "--name", "rejected", "--webhook-url", `http://127.0.0.1:${port}/hook/xyz`]);
    const { code, out, errOut } = await cli(["channel", "test", "rejected"]);
    expect(code).toBe(1);
    expect(`${out}${errOut}`).toContain("AUTH_INVALID");
    // 错误信息不含原始响应体（脱敏）
    expect(`${out}${errOut}`).not.toContain("unauthorized");
  });

  it("email 渠道经 SMTP 假服务器送达", async () => {
    const received: string[] = [];
    const port = await listenFakeSmtp(received);
    await cli([
      "channel",
      "add",
      "email",
      "--name",
      "邮箱",
      "--smtp-host",
      "127.0.0.1",
      "--smtp-port",
      String(port),
      "--username",
      "notifier@notice.local",
      "--auth-code",
      "smtp-auth-123456",
      "--from",
      "notifier@notice.local",
      "--to",
      "user@notice.local",
    ]);
    const { code, out } = await cli(["channel", "test", "邮箱"]);
    expect(code).toBe(0);
    expect(out).toContain("成功");
    const joined = received.join("\n");
    expect(joined).toContain("user@notice.local"); // RCPT TO 收件地址
  });
});
