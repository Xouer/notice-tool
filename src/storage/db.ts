import Database from "better-sqlite3";
import { chmodSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import * as schema from "./schema.js";

/**
 * 数据库连接层（T013，research.md R1）：
 * - 文件库：用户数据目录、WAL、仅当前用户可读
 * - :memory: 测试库：完全隔离、毫秒级启动
 * - 迁移执行器幂等（drizzle 迁移元数据表跟踪）
 */
export type NoticeDatabase = BetterSQLite3Database<typeof schema> & {
  /** 底层 better-sqlite3 连接（drizzle() 工厂附加）。 */
  $client: Database.Database;
};

const MIGRATIONS_FOLDER = fileURLToPath(
  new URL("../../drizzle", import.meta.url),
);

/** 执行未应用的迁移（幂等，可重复调用）。 */
export function migrateDatabase(db: NoticeDatabase): void {
  migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
}

function createDb(sqlite: Database.Database): NoticeDatabase {
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite, { schema });
  migrateDatabase(db);
  return db;
}

/** 打开 :memory: 测试库（含迁移）。 */
export function openMemoryDatabase(): NoticeDatabase {
  return createDb(new Database(":memory:"));
}

/** 打开文件库：WAL 模式 + 迁移 + 仅当前用户可读（POSIX chmod；Windows 依赖用户目录 ACL）。 */
export function openFileDatabase(dbPath: string): NoticeDatabase {
  mkdirSync(dirname(dbPath), { recursive: true });
  const sqlite = new Database(dbPath);
  sqlite.pragma("journal_mode = WAL");
  const db = createDb(sqlite);
  try {
    chmodSync(dbPath, 0o600);
  } catch {
    // Windows 上 chmod 语义有限，忽略（依赖用户数据目录 ACL）
  }
  return db;
}
