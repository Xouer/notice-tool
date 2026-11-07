import { afterAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  migrateDatabase,
  openFileDatabase,
  openMemoryDatabase,
  type NoticeDatabase,
} from "../../src/storage/db.js";

/**
 * T006：数据库引导单元测试（Red 先行）。
 * - :memory: 建库执行迁移
 * - 文件库开启 WAL
 * - 迁移可重复执行（幂等）
 */
const tmpDir = mkdtempSync(join(tmpdir(), "notice-db-test-"));
const openedDbs: NoticeDatabase[] = [];

function track(db: NoticeDatabase): NoticeDatabase {
  openedDbs.push(db);
  return db;
}

afterAll(() => {
  // 先关闭全部连接（释放 Windows 下 WAL/-shm 句柄）再清理临时目录
  for (const db of openedDbs) {
    try {
      db.$client.close();
    } catch {
      // 已关闭则忽略
    }
  }
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("database bootstrap / 数据库引导（T006）", () => {
  it(":memory: 建库执行迁移并创建四张实体表", () => {
    const db = track(openMemoryDatabase());
    const tables = db.$client
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all()
      .map((row) => String(row.name));
    expect(tables).toContain("notification_channels");
    expect(tables).toContain("task_events");
    expect(tables).toContain("notification_records");
    expect(tables).toContain("notification_templates");
  });

  it("文件库开启 WAL 日志模式", () => {
    const dbPath = join(tmpDir, "wal-test.db");
    const db = track(openFileDatabase(dbPath));
    expect(db.$client.pragma("journal_mode", { simple: true })).toBe("wal");
  });

  it("迁移可重复执行（幂等）", () => {
    const dbPath = join(tmpDir, "idempotent-test.db");
    track(openFileDatabase(dbPath)); // 首次打开即迁移
    const db = track(openFileDatabase(dbPath)); // 再次打开
    expect(() => migrateDatabase(db)).not.toThrow(); // 显式重复执行
    const count = db.$client
      .prepare("SELECT count(*) AS n FROM sqlite_master WHERE type = 'table'")
      .get();
    expect(Number(count.n)).toBeGreaterThan(4); // 四实体表 + 迁移元数据表
  });

  it("重复打开文件库不重复建表", () => {
    const dbPath = join(tmpDir, "reopen-test.db");
    track(openFileDatabase(dbPath));
    const db2 = track(openFileDatabase(dbPath));
    const templates = db2.$client
      .prepare("SELECT count(*) AS n FROM notification_templates")
      .get();
    expect(Number(templates.n)).toBe(0); // 未 seed 前为空
  });
});
