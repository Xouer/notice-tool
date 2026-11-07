import type { ChannelType } from "../storage/schema.js";
import type { ChannelAdapter } from "./adapter.js";
import { FeishuAdapter } from "./feishu.js";
import { DingTalkAdapter } from "./dingtalk.js";
import { EmailAdapter } from "./email.js";
import { WeChatAdapter } from "./wechat.js";
import { QqAdapter } from "./qq.js";

/** 渠道类型 → 适配器注册表（适配器无状态，按需实例化）。 */
const REGISTRY: Record<ChannelType, () => ChannelAdapter> = {
  feishu: () => new FeishuAdapter(),
  dingtalk: () => new DingTalkAdapter(),
  email: () => new EmailAdapter(),
  wechat: () => new WeChatAdapter(),
  qq: () => new QqAdapter(),
};

export function getAdapter(type: ChannelType): ChannelAdapter {
  return REGISTRY[type]();
}
