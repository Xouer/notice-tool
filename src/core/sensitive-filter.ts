/**
 * 敏感内容过滤（支撑 T041/T033，contracts/hook-receiver.md + data-model.md）：
 * resultSummary 在落库/渲染前过滤密钥/令牌样式模式并截断至 500 字符；
 * raw_payload_ref 仅存脱敏摘要。
 */
const SUMMARY_MAX_LENGTH = 500;

const SENSITIVE_PATTERNS: RegExp[] = [
  /\bsk-[A-Za-z0-9_-]{8,}/g, // OpenAI 风格密钥
  /\bghp_[A-Za-z0-9]{16,}/g, // GitHub token
  /\bAKIA[0-9A-Z]{12,}/g, // AWS AccessKey
  /\bBearer\s+[A-Za-z0-9-_.~+/]+=*/gi, // Bearer 凭据
  /\b(?:token|secret|password|passwd|api_?key|access_?key|auth)[-_=][^\s&"',;）)]{4,}/gi, // 键值对
  /\b[A-Fa-f0-9]{20,}\b/g, // 长十六进制串
  /\b[A-Za-z0-9+/]{32,}={0,2}\b/g, // 长 base64 串
];

const REDACTED = "[REDACTED]";

/** 过滤敏感模式并截断；空值返回 undefined。 */
export function filterSensitiveSummary(
  summary: string | undefined,
  maxLength: number = SUMMARY_MAX_LENGTH,
): string | undefined {
  if (summary === undefined || summary.trim().length === 0) {
    return undefined;
  }
  let text = summary;
  for (const pattern of SENSITIVE_PATTERNS) {
    text = text.replace(pattern, REDACTED);
  }
  if (text.length > maxLength) {
    text = text.slice(0, maxLength);
  }
  return text;
}
