import { randomBytes } from "node:crypto";

/**
 * SecretStore 接口与内存实现 / Interface + in-memory implementation.
 *
 * 主密钥（32 字节）用于 AES-256-GCM 凭据密文（research.md R2）：
 * - 密钥不落明文文件、不入日志、不随导出
 * - 平台实现隔离（Windows DPAPI 见 secret-store.dpapi.ts；macOS/Linux 为扩展位）
 * - 内存实现供测试与无 DPAPI 环境回退
 */
export interface SecretStore {
  /** 获取主密钥（32 字节）；首次调用时生成并托管。 */
  getMainKey(): Buffer;
}

/** 内存实现：密钥仅驻留进程内存，进程退出即消失（测试与回退用）。 */
export class InMemorySecretStore implements SecretStore {
  #key: Buffer | undefined;

  getMainKey(): Buffer {
    this.#key ??= randomBytes(32);
    return this.#key;
  }
}
