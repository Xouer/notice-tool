import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { HookConfigError, type FailureCategory } from "./types.js";

/**
 * 配置文件安全读写（006-T017）：
 * - 读取：文件不存在返回 undefined；权限/IO 错误分类抛 HookConfigError
 * - 写入：临时文件 + rename 原子替换，失败清理临时文件并抛错
 * - 错误信息脱敏：不暴露完整敏感路径
 */

function categoryFor(cause: unknown): FailureCategory {
  if (cause instanceof HookConfigError) return cause.category;
  const code = (cause as { code?: string } | null)?.code;
  if (code === "ENOENT") return "missing_target";
  if (code === "EACCES" || code === "EPERM" || code === "EROFS") {
    return "permission_denied";
  }
  return "unknown";
}

/** 读取配置文件原文；不存在返回 undefined；失败抛 HookConfigError。 */
export function readConfigFile(path: string): string | undefined {
  try {
    return readFileSync(path, "utf8");
  } catch (cause) {
    if ((cause as { code?: string } | null)?.code === "ENOENT") {
      return undefined;
    }
    const category = categoryFor(cause);
    throw new HookConfigError(
      category === "permission_denied" ? "目标配置文件不可读（权限不足）" : "读取目标配置文件失败",
      category,
    );
  }
}

/** 原子写入：写临时文件后 rename；失败清理临时文件。 */
export function writeConfigFileAtomic(path: string, content: string): void {
  try {
    mkdirSync(dirname(path), { recursive: true });
  } catch (cause) {
    throw new HookConfigError("无法创建目标配置目录（权限不足）", categoryFor(cause));
  }
  const tmp = join(dirname(path), `.${basename(path)}.${process.pid}.${Date.now()}.tmp`);
  try {
    writeFileSync(tmp, content, "utf8");
    renameSync(tmp, path);
  } catch (cause) {
    try {
      rmSync(tmp, { force: true });
    } catch {
      // 清理失败不影响主错误
    }
    const category = categoryFor(cause);
    throw new HookConfigError(
      category === "permission_denied" ? "目标配置文件不可写（权限不足）" : "写入目标配置文件失败",
      category,
    );
  }
}
