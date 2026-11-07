import { defineConfig } from "drizzle-kit";

/**
 * drizzle-kit 迁移生成配置 / Migration generation config.
 * 产物输出至 drizzle/ 并入库审查（data-model.md 兼容性与迁移章节）。
 * 注意：此 url 仅供 drizzle-kit CLI 使用；运行时数据库由 src/storage/db.ts
 * 以用户数据目录路径或 :memory: 打开。
 */
export default defineConfig({
  dialect: "sqlite",
  schema: "./src/storage/schema.ts",
  out: "./drizzle",
});
