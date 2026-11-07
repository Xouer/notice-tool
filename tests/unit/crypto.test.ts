import { describe, expect, it } from "vitest";
import { BlobCipher, maskSecret } from "../../src/storage/crypto.js";
import { InMemorySecretStore } from "../../src/storage/secret-store.js";

/**
 * T005：AES-256-GCM 密文往返单元测试（Red 先行）。
 * - 加解密往返
 * - 篡改密文检测失败
 * - 掩码函数输出不含明文凭据
 */
describe("AES-256-GCM blob cipher / 凭据密文（T005）", () => {
  const secretStore = new InMemorySecretStore();

  it("主密钥为 32 字节且稳定（同实例重复获取）", () => {
    const key = secretStore.getMainKey();
    expect(key).toBeInstanceOf(Buffer);
    expect(key).toHaveLength(32);
    expect(secretStore.getMainKey().equals(key)).toBe(true);
  });

  it("加解密往返：Webhook 地址等敏感凭据", () => {
    const cipher = new BlobCipher(secretStore.getMainKey());
    const webhookUrl =
      "https://open.feishu.cn/open-apis/bot/v2/hook/0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a";
    const blob = cipher.seal(webhookUrl);
    expect(typeof blob).toBe("string");
    expect(blob).not.toContain("feishu");
    expect(cipher.unseal(blob)).toBe(webhookUrl);
  });

  it("同一明文两次加密产生不同密文（随机 IV）", () => {
    const cipher = new BlobCipher(secretStore.getMainKey());
    expect(cipher.seal("same-secret")).not.toBe(cipher.seal("same-secret"));
  });

  it("篡改密文被检测并拒绝", () => {
    const cipher = new BlobCipher(secretStore.getMainKey());
    const blob = cipher.seal("top-secret-credential");
    const raw = Buffer.from(blob, "base64");
    raw[raw.length - 1] ^= 0xff; // 翻转最后一个字节（认证标签位）
    expect(() => cipher.unseal(raw.toString("base64"))).toThrow();
  });

  it("篡改密文体（非标签位）同样被拒绝", () => {
    const cipher = new BlobCipher(secretStore.getMainKey());
    const blob = cipher.seal("top-secret-credential");
    const raw = Buffer.from(blob, "base64");
    raw[13] ^= 0x01; // 密文体首字节（IV 12 字节之后）
    expect(() => cipher.unseal(raw.toString("base64"))).toThrow();
  });

  it("错误密钥解密失败", () => {
    const right = new BlobCipher(secretStore.getMainKey());
    const wrong = new BlobCipher(new InMemorySecretStore().getMainKey());
    expect(() => wrong.unseal(right.seal("secret"))).toThrow();
  });

  it("非 32 字节主密钥拒绝构造", () => {
    expect(() => new BlobCipher(Buffer.alloc(16))).toThrow();
  });
});

describe("maskSecret / 凭据掩码（T005）", () => {
  it("长凭据掩码输出不含明文", () => {
    const webhookUrl =
      "https://open.feishu.cn/open-apis/bot/v2/hook/0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a";
    const masked = maskSecret(webhookUrl);
    expect(masked).not.toContain("0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a");
    expect(masked).not.toBe(webhookUrl);
  });

  it("短凭据（≤8 字符）完全掩码", () => {
    expect(maskSecret("abc12345")).toBe("***");
    expect(maskSecret("")).toBe("***");
  });

  it("SMTP 授权码掩码不含明文", () => {
    const authCode = "SMTP-AUTH-CODE-1928374655463728";
    const masked = maskSecret(authCode);
    expect(masked).not.toContain("1928374655463728");
    expect(masked).not.toBe(authCode);
  });
});
