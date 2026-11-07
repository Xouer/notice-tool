import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * AES-256-GCM 凭据密文（T011，data-model.md 安全要点）。
 *
 * - 主密钥来自 SecretStore（32 字节）
 * - 密文结构：base64( IV[12] | ciphertext | authTag[16] )
 * - 明文仅发送瞬间驻留内存，不缓存不落日志
 * - 错误信息一律脱敏：不回显明文与密文内容
 */
const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12;
const TAG_BYTES = 16;
const KEY_BYTES = 32;

export class BlobCipher {
  readonly #key: Buffer;

  constructor(mainKey: Buffer) {
    if (mainKey.length !== KEY_BYTES) {
      throw new Error(`主密钥必须为 ${KEY_BYTES} 字节（AES-256）`);
    }
    this.#key = mainKey;
  }

  /** 加密封串 / Seal plaintext to opaque base64 blob. */
  seal(plaintext: string): string {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv(ALGORITHM, this.#key, iv);
    const ciphertext = Buffer.concat([
      cipher.update(plaintext, "utf8"),
      cipher.final(),
    ]);
    const tag = cipher.getAuthTag();
    return Buffer.concat([iv, ciphertext, tag]).toString("base64");
  }

  /** 解密封串；篡改或密钥不匹配时抛出（错误信息脱敏）。 */
  unseal(blob: string): string {
    const raw = Buffer.from(blob, "base64");
    if (raw.length <= IV_BYTES + TAG_BYTES) {
      throw new Error("密文长度非法");
    }
    const iv = raw.subarray(0, IV_BYTES);
    const tag = raw.subarray(raw.length - TAG_BYTES);
    const ciphertext = raw.subarray(IV_BYTES, raw.length - TAG_BYTES);
    const decipher = createDecipheriv(ALGORITHM, this.#key, iv);
    decipher.setAuthTag(tag);
    try {
      return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString(
        "utf8",
      );
    } catch {
      throw new Error("密文解密失败（数据被篡改或密钥不匹配）");
    }
  }
}

/**
 * 凭据掩码 / Credential masking（FR-012）。
 * 短凭据完全掩码；长凭据仅保留首尾各 4 字符用于辨认。
 */
export function maskSecret(value: string): string {
  if (value.length <= 8) {
    return "***";
  }
  return `${value.slice(0, 4)}****${value.slice(-4)}`;
}
