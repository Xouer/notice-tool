// T062 性能验证脚本 / Performance validation (plan.md 性能目标).
// 用法：先 `npm run build`，再 `node scripts/perf-check.mjs`
import { performance } from "node:perf_hooks";
import { createServer } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCli } from "../dist/cli/index.js";
import { purgeExpiredHistory } from "../dist/core/retention.js";

const results = [];

// 1) 钩子受理 → 通知完成（≤5s）：本地假 HTTP 渠道端到端
const server = createServer((_req, res) => {
  res.statusCode = 200;
  res.end(JSON.stringify({ code: 0 }));
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const port = server.address().port;
const dataDir = mkdtempSync(join(tmpdir(), "notice-perf-"));
const collector = () => {
  let out = "";
  return [(x) => (out += x)];
};
const [outW] = collector();
await runCli(["channel", "add", "feishu", "--name", "perf", "--webhook-url", `http://127.0.0.1:${port}/hook/x`], { dataDir, out: outW, err: outW });
await runCli(["channel", "enable", "perf"], { dataDir, out: outW, err: outW });
const t0 = performance.now();
await runCli(["hook"], { dataDir, out: outW, err: outW, stdin: (await import("node:stream")).Readable.from([Buffer.from(JSON.stringify({ schemaVersion: 1, source: "perf", taskId: "t-1" }))]) });
const hookLatencyMs = performance.now() - t0;
results.push(["钩子受理→通知完成（≤5000ms）", `${hookLatencyMs.toFixed(1)}ms`, hookLatencyMs <= 5000]);

// 2) 历史分页查询（<200ms）：灌入 2 万事件与记录
{
  const { openFileDatabase } = await import("../dist/storage/db.js");
  const db = openFileDatabase(join(dataDir, "notice.db"));
  const now = Date.now();
  const insertEvents = db.$client.prepare(
    "INSERT INTO task_events (id, source_agent, task_id, finished_at, result_status, trigger_type, raw_payload_ref, received_at, notify_status) VALUES (?, ?, ?, ?, 'success', 'hook', NULL, ?, 'dispatched')",
  );
  const insertRecords = db.$client.prepare(
    "INSERT INTO notification_records (id, event_id, channel_id, status, attempts, created_at, updated_at) VALUES (?, ?, (SELECT id FROM notification_channels LIMIT 1), 'sent', 1, ?, ?)",
  );
  const tx = db.$client.transaction((n) => {
    for (let i = 0; i < n; i++) {
      const eid = `evt-${i}`;
      const ts = now - i * 1000;
      insertEvents.run(eid, "perf", `task-${i}`, ts, ts);
      insertRecords.run(`rec-${i}`, eid, ts, ts);
    }
  });
  tx(20000);
  const histStart = performance.now();
  await runCli(["history", "--limit", "20", "--json"], { dataDir, out: outW, err: outW });
  const histMs = performance.now() - histStart;
  results.push(["历史分页查询 20k 条（<200ms）", `${histMs.toFixed(1)}ms（含 CLI 开销）`, histMs <= 200]);

  // 4) 清理 20k 过期记录耗时（辅助观测）
  const purgeStart = performance.now();
  const r = purgeExpiredHistory(db, 0);
  results.push(["清理 20k 过期历史", `${(performance.now() - purgeStart).toFixed(1)}ms（删 ${r.eventsDeleted} 事件）`, true]);
  db.$client.close();
}

// 3) 常驻内存（<150MB）：见最终报告——serve 进程实测与受限堆验证
const rssMb = process.memoryUsage().rss / 1024 / 1024;
results.push(["本脚本进程 RSS（参考值）", `${rssMb.toFixed(1)}MB`, true]);

server.close();
rmSync(dataDir, { recursive: true, force: true });

let failed = false;
for (const [name, value, pass] of results) {
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}: ${value}`);
  if (!pass) failed = true;
}
process.exit(failed ? 1 : 0);
