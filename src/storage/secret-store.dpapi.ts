import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { randomBytes } from "node:crypto";
import { Dpapi, isPlatformSupported } from "@primno/dpapi";
import type { SecretStore } from "./secret-store.js";

/**
 * Windows DPAPI SecretStore 实现（research.md R2，T010）。
 *
 * 以"当前 Windows 用户"为保护边界托管主密钥：
 * - 首次生成 32 字节随机主密钥 → DPAPI CurrentUser 加密后落盘
 * - 后续读取经 DPAPI 解密还原
 * - 非 Windows 平台构造即抛出明确错误（SecretStore 平台扩展位）
 */
export class DpapiSecretStore implements SecretStore {
  readonly #keyPath: string;

  constructor(keyPath: string) {
    this.#keyPath = keyPath;
  }

  getMainKey(): Buffer {
    if (!isPlatformSupported) {
      throw new Error(
        "DPAPI 仅在 Windows 上可用：请使用平台对应的 SecretStore 实现",
      );
    }
    if (existsSync(this.#keyPath)) {
      const protectedBlob = readFileSync(this.#keyPath);
      return Buffer.from(Dpapi.unprotectData(protectedBlob, null, "CurrentUser"));
    }
    const key = randomBytes(32);
    const protectedBlob = Buffer.from(
      Dpapi.protectData(key, null, "CurrentUser"),
    );
    mkdirSync(dirname(this.#keyPath), { recursive: true });
    writeFileSync(this.#keyPath, protectedBlob, { mode: 0o600 });
    return key;
  }
}
