import { CHANNEL_TYPES, type ChannelType } from "../storage/schema.js";
import { validateChannelInput } from "../channels/channel-config.js";
import type { StepResult, WizardIO } from "./wizard-io.js";

/**
 * T004：交互式配置向导引擎（US1）+ 字段目录（US3 全渠道）。
 * 纯状态机：仅依赖 WizardIO 抽象，不接触真实终端与数据库（contracts/wizard.md）；
 * 字段目录驱动各渠道步骤，轻量即时校验定位到字段（FR-005）；
 * save 产物经既有 validateChannelInput 终验，与命令行标志方式完全等价（FR-009）。
 * 导航：任一步 "b" 返回上一步（保留已输入值）、"0"/Ctrl+C 取消（FR-007）。
 */

export type WizardOutcome =
  | {
      action: "save";
      type: ChannelType;
      name: string;
      credentials: Record<string, unknown>;
    }
  | { action: "cancel" };

export interface WizardSeed {
  /** 命令行已给出合法 type 时预选，跳过第 1 步（research R2）。 */
  type?: ChannelType;
  /** 已有值（如 --name / 校验失败重入），回退保留语义的基础。 */
  values?: Record<string, string>;
  /**
   * 向导模式（004 update 向导预留；缺省 "add"）：update 时调用方负责预填语义。
   * 仅类型声明（可选新增，向后兼容）；行为由调用方与 seed.values 驱动。
   */
  mode?: "add" | "update";
  /** update 模式下的当前渠道值预填来源（004 调用方契约）。 */
  current?: { name: string; credentials: Record<string, unknown> };
}

export interface FieldSpec {
  key: string;
  label: string;
  /** 含义 + 格式示例/前缀 + 获取方法（FR-004；文案对照 README 与 002 quickstart 固化，T005）。 */
  hint: string;
  /** 敏感输入：走 askSecret 掩码，不回显明文（FR-010）。 */
  secret?: boolean;
  /** 可选项：留空跳过（不入凭据）或取默认值。 */
  optional?: boolean;
  /** 选择型字段：转编号菜单。 */
  kind?: "choice";
  choice?: readonly string[];
  /** 数值字段：入库前转 number（如 smtpPort）。 */
  numeric?: boolean;
  /** 跳过时使用的默认值（摘要标注"默认生成"）。 */
  default?: string;
  /** 轻量即时校验（FR-005）：返回错误文案或 undefined。 */
  lightCheck?: (v: string) => string | undefined;
  /** 选择型字段的逐选项专属说明（缺省回退 hint）。 */
  choiceHints?: Record<string, string>;
}

interface ModeSpec {
  /** 凭据中的 mode 值；"" 表示该渠道无连接方式字段（dingtalk/email）。 */
  key: string;
  label: string;
  hint: string;
  recommended?: boolean;
  fields: FieldSpec[];
}

const nonEmpty =
  (label: string) =>
  (v: string): string | undefined =>
    v.length === 0 ? `${label}不能为空` : undefined;

const urlCheck =
  (label: string) =>
  (v: string): string | undefined => {
    let parsed: URL;
    try {
      parsed = new URL(v);
    } catch {
      return `${label}不是合法 URL（须以 http/https 开头）`;
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return `${label}仅支持 http/https URL`;
    }
    return undefined;
  };

const intCheck =
  (label: string) =>
  (v: string): string | undefined =>
    /^\d+$/.test(v) ? undefined : `${label}必须为整数`;

const NAME_FIELD: FieldSpec = {
  key: "name",
  label: "渠道名称",
  hint: "用于识别渠道（可留空，默认生成 类型-时间戳）",
  optional: true,
};

export const TYPE_LABELS: Record<ChannelType, string> = {
  feishu: "飞书",
  dingtalk: "钉钉",
  email: "邮箱",
  wechat: "微信",
  qq: "QQ",
};

export const TYPE_HINTS: Record<ChannelType, string> = {
  feishu: "通过飞书自建应用或群机器人发送通知",
  dingtalk: "通过钉钉群机器人 Webhook 发送通知",
  email: "通过 SMTP 邮箱发送通知",
  wechat: "通过企业微信群机器人或 Server酱/PushPlus 推送",
  qq: "通过 QQ 官方机器人或 PushPlus 推送",
};

/** 字段目录：8 个 type×mode 组合，与 validateChannelInput 各分支字段集一一对应（contracts/wizard.md 速览表）。 */
export const MODES: Record<ChannelType, ModeSpec[]> = {
  feishu: [
    {
      key: "app",
      label: "应用凭证",
      hint: "使用自建应用 App ID / App Secret，免建群与群机器人",
      recommended: true,
      fields: [
        NAME_FIELD,
        {
          key: "appId",
          label: "App ID",
          hint: "自建应用 App ID（cli_ 开头）；在飞书开放平台 open.feishu.cn 创建企业自建应用后，于应用详情页获取",
        },
        {
          key: "appSecret",
          label: "App Secret",
          hint: "自建应用 App Secret，与 App ID 同页获取；输入不回显明文，请妥善保管",
          secret: true,
        },
        {
          key: "receiveIdType",
          label: "接收目标类型",
          hint: "按接收目标选择类型（各选项含义见菜单说明）",
          kind: "choice",
          choice: ["chat_id", "open_id", "user_id", "union_id", "email"],
          choiceHints: {
            chat_id: "发到群：群会话 ID（oc_ 开头，把应用机器人加入群后获取）",
            open_id: "发到个人：本应用下的 Open ID（ou_ 开头；其他应用的会报 cross app）",
            user_id: "发到个人：租户内用户 ID（u_ 开头，需开通对应权限）",
            union_id: "发到个人：同一开发者下跨应用通用（on_ 开头，推荐）",
            email: "发到邮箱：用户在飞书绑定的邮箱地址",
          },
        },
        {
          key: "receiveId",
          label: "接收目标 ID",
          hint: "群会话 ID 以 oc_ 开头（把应用机器人加入目标群后获取）；个人用户为 ou_ 开头的 Open ID；注意：应用需创建版本并发布后权限才生效",
        },
      ],
    },
    {
      key: "webhook",
      label: "群机器人 Webhook",
      hint: "使用群自定义机器人 Webhook 地址（旧方式，需先把机器人加入群）",
      fields: [
        NAME_FIELD,
        {
          key: "webhookUrl",
          label: "Webhook 地址",
          hint: "https://open.feishu.cn/open-apis/bot/v2/hook/ 开头；在群设置-群机器人中添加自定义机器人后复制",
        },
      ],
    },
  ],
  dingtalk: [
    {
      key: "",
      label: "Webhook",
      hint: "钉钉群自定义机器人",
      fields: [
        NAME_FIELD,
        {
          key: "webhookUrl",
          label: "Webhook 地址",
          hint: "钉钉群机器人 Webhook 地址；在群设置-智能群助手添加自定义机器人后复制",
        },
        {
          key: "secret",
          label: "加签密钥",
          hint: "SEC 开头（可选）；仅机器人安全设置选择加签时填写，输入不回显明文",
          secret: true,
          optional: true,
        },
      ],
    },
  ],
  email: [
    {
      key: "",
      label: "SMTP",
      hint: "SMTP 邮箱发送",
      fields: [
        NAME_FIELD,
        {
          key: "smtpHost",
          label: "SMTP 主机",
          hint: "SMTP 服务器地址，如 smtp.qq.com / smtp.163.com（见邮箱服务商帮助文档）",
        },
        {
          key: "smtpPort",
          label: "SMTP 端口",
          hint: "SSL 端口通常为 465；直接回车使用默认 465",
          optional: true,
          default: "465",
          numeric: true,
        },
        {
          key: "username",
          label: "SMTP 用户名",
          hint: "登录用户名（可选），通常为发件邮箱地址",
          optional: true,
        },
        {
          key: "authCode",
          label: "SMTP 授权码",
          hint: "在邮箱设置中开启 SMTP 服务后生成的授权码（非登录密码）；输入不回显明文",
          secret: true,
        },
        {
          key: "from",
          label: "发件地址",
          hint: "发件邮箱地址（可选），通常与登录用户名相同",
          optional: true,
        },
        {
          key: "to",
          label: "收件地址",
          hint: "收件邮箱地址（须包含 @）；通知将发送到该地址",
        },
      ],
    },
  ],
  wechat: [
    {
      key: "webhook",
      label: "企业微信群机器人",
      hint: "企业微信群机器人 Webhook 地址",
      fields: [
        NAME_FIELD,
        {
          key: "webhookUrl",
          label: "Webhook 地址",
          hint: "企业微信群机器人 Webhook 地址；在群设置-群机器人中添加后复制",
        },
      ],
    },
    {
      key: "push",
      label: "推送服务",
      hint: "Server酱 / PushPlus 推送到微信",
      fields: [
        NAME_FIELD,
        {
          key: "service",
          label: "推送服务",
          hint: "serverchan=Server酱；pushplus=PushPlus",
          kind: "choice",
          choice: ["serverchan", "pushplus"],
        },
        {
          key: "pushKey",
          label: "推送密钥",
          hint: "Server酱 SendKey 或 PushPlus token；在对应服务官网获取，输入不回显明文",
          secret: true,
        },
      ],
    },
  ],
  qq: [
    {
      key: "official",
      label: "官方机器人",
      hint: "QQ 官方机器人 AppID 凭证",
      fields: [
        NAME_FIELD,
        {
          key: "appId",
          label: "App ID",
          hint: "QQ 机器人 AppID；在 QQ 开放平台机器人管理页获取",
        },
        {
          key: "appSecret",
          label: "App Secret",
          hint: "QQ 机器人 App Secret；输入不回显明文，请妥善保管",
          secret: true,
        },
        {
          key: "endpoint",
          label: "消息接口地址",
          hint: "机器人消息接口的完整 URL（http/https）",
        },
      ],
    },
    {
      key: "push",
      label: "推送服务",
      hint: "PushPlus 推送到微信/QQ",
      fields: [
        NAME_FIELD,
        {
          key: "pushKey",
          label: "推送密钥",
          hint: "PushPlus token；在 pushplus.plus 官网获取，输入不回显明文",
          secret: true,
        },
      ],
    },
  ],
};

/** 轻量即时校验绑定（FR-005）：URL/整数/非空，规则与 validateChannelInput 对应分支一致。 */
for (const modes of Object.values(MODES)) {
  for (const mode of modes) {
    for (const field of mode.fields) {
      if (field.key === "name" || field.kind === "choice") continue;
      if (field.key.endsWith("Url") || field.key === "endpoint") {
        field.lightCheck = urlCheck(field.label);
      } else if (field.numeric) {
        field.lightCheck = intCheck(field.label);
      } else {
        field.lightCheck = nonEmpty(field.label);
      }
    }
  }
}

/** 默认渠道名：{type}-{YYYYMMDD-HHmmss}（本地时间）。 */
export function defaultChannelName(type: ChannelType, now: Date = new Date()): string {
  const p = (n: number): string => String(n).padStart(2, "0");
  return `${type}-${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}`;
}

function maskValue(field: FieldSpec, value: string | undefined): string {
  if (value === undefined || value === "") return "（未填写）";
  return field.secret ? "***" : value;
}

export async function runWizard(io: WizardIO, seed: WizardSeed = {}): Promise<WizardOutcome> {
  // ── 004-US3：update 模式（类型锁定 + 当前值预填 + 敏感项"已设置"语义）──
  const isUpdate = seed.mode === "update";
  const values: Record<string, string> = {};
  if (isUpdate && seed.current !== undefined) {
    values.name = seed.current.name;
    for (const [k, v] of Object.entries(seed.current.credentials)) {
      if (k === "schemaVersion" || v === null || typeof v === "object") continue;
      values[k] = String(v);
    }
  }
  for (const [k, v] of Object.entries(seed.values ?? {})) values[k] = v;
  const defaults: string[] = [];
  const cleared = new Set<string>(); // update 模式：用户显式清除（-）的可选字段
  let type: ChannelType | undefined = seed.type;

  for (;;) {
    // ── 第 1 步：选择输入类型（FR-002）；update 模式类型锁定，由 seed.type 跳过 ──
    if (type === undefined) {
      const r = await io.choose(
        "选择输入类型",
        CHANNEL_TYPES.map((t) => ({ label: t, hint: TYPE_HINTS[t] })),
      );
      if (r.kind === "cancel") return { action: "cancel" };
      if (r.kind === "back") continue; // 第 1 步无上一步，重新选择
      type = CHANNEL_TYPES[r.value];
    }
    const currentType = type as ChannelType; // 上方分支保证已定义

    const modes = MODES[currentType];
    // update 模式：当前方式排在首位（预选语义），提示"当前值"
    const orderedModes =
      isUpdate && modes.length > 1
        ? [...modes].sort((a, b) =>
            a.key === String(values.mode ?? "") ? -1 : b.key === String(values.mode ?? "") ? 1 : 0,
          )
        : modes;
    let mode: ModeSpec;

    // ── 第 2 步：选择输入方式（FR-003；单方式渠道跳过）──
    if (orderedModes.length > 1) {
      const r = await io.choose(
        `选择输入方式（${TYPE_LABELS[currentType]}）`,
        orderedModes.map((m) => ({
          label: m.key,
          hint: `${m.recommended ? "推荐：" : ""}${m.label}：${m.hint}${
            isUpdate && m.key === String(values.mode ?? "") ? "（当前值，可改选）" : ""
          }`,
        })),
      );
      if (r.kind === "cancel") return { action: "cancel" };
      if (r.kind === "back") {
        type = undefined; // 返回第 1 步
        continue;
      }
      mode = orderedModes[r.value]!;
    } else {
      mode = orderedModes[0]!;
    }

    // ── 第 3 步：逐项输入值（FR-004/FR-005/FR-007）──
    const fields = mode.fields;
    let i = 0;
    let phase: "fields" | "confirm" = "fields";

    for (;;) {
      if (phase === "fields") {
        if (i >= fields.length) {
          phase = "confirm";
          continue;
        }
        const field = fields[i]!;
        const prev = values[field.key];

        if (field.kind === "choice") {
          const cr = await io.choose(
            `请选择${field.label}`,
            (field.choice ?? []).map((v) => ({
              label: v,
              hint: field.choiceHints?.[v] ?? field.hint,
            })),
          );
          if (cr.kind === "cancel") return { action: "cancel" };
          if (cr.kind === "back") {
            if (i === 0) break; // 回到选择方式/类型
            i -= 1;
            continue;
          }
          values[field.key] = field.choice?.[cr.value] ?? "";
          i += 1;
          continue;
        }

        io.print(`${field.label}：${field.hint}`);
        const keep =
          prev !== undefined ? (isUpdate ? "（已设置，回车保留）" : "（回车保留已输入值）") : "";
        const clearNote = isUpdate && field.optional === true ? "；输入 - 清除该字段" : "";
        const r = await io.ask(
          `请输入${field.label}${field.optional ? "（可留空）" : ""}${keep}${clearNote}`,
          {
            secret: field.secret,
          },
        );
        if (r.kind === "cancel") return { action: "cancel" };
        if (r.kind === "back") {
          if (i === 0) break; // 回到选择方式/类型
          i -= 1;
          continue;
        }
        const raw = r.value.trim();

        if (isUpdate && raw === "-" && field.optional === true) {
          delete values[field.key];
          cleared.add(field.key); // 显式清除（摘要标注"已清除"，保存产物不含该键）
          i += 1;
          continue;
        }
        if (raw === "" && prev !== undefined && prev !== "") {
          i += 1; // 空输入保留已输入值
          continue;
        }
        if (raw === "" && field.default !== undefined) {
          values[field.key] = field.default;
          if (!defaults.includes(field.key)) defaults.push(field.key);
          i += 1;
          continue;
        }
        if (raw === "" && field.optional) {
          delete values[field.key];
          i += 1;
          continue;
        }
        const error = raw === "" ? undefined : field.lightCheck?.(raw);
        if (raw === "" || error !== undefined) {
          io.print(`✗ ${error ?? `${field.label}不能为空`}`);
          continue; // 原地重试，游标不推进（FR-005）
        }
        values[field.key] = field.numeric === true ? String(Number(raw)) : raw;
        i += 1;
        continue;
      }

      // ── 第 4 步：确认摘要（FR-006；敏感值脱敏，SC-005）──
      const nameEmpty = (values.name ?? "").trim() === "";
      io.print("—— 确认摘要（敏感值已脱敏）——");
      io.print(`渠道类型：${TYPE_LABELS[currentType]}（${currentType}）`);
      if (mode.key !== "") {
        io.print(`连接方式：${mode.label}（${mode.key}）`);
      }
      io.print(
        `渠道名称：${nameEmpty ? `${defaultChannelName(currentType)}（默认生成）` : values.name!.trim()}`,
      );
      for (const field of fields) {
        if (field.key === "name") continue;
        if (cleared.has(field.key)) {
          io.print(`${field.label}：（已清除）`);
          continue;
        }
        io.print(`${field.label}：${maskValue(field, values[field.key])}`);
      }
      const cr = await io.choose("确认配置", [
        { label: "确认保存", hint: "写入渠道配置" },
        { label: "返回上一步修改", hint: "回到最后一个字段" },
      ]);
      if (cr.kind === "cancel") return { action: "cancel" };
      if (cr.kind === "value" && cr.value === 0) {
        const name = nameEmpty ? defaultChannelName(currentType) : values.name!.trim();
        const credentials: Record<string, unknown> = {};
        if (mode.key !== "") credentials.mode = mode.key;
        for (const field of fields) {
          if (field.key === "name") continue;
          const v = values[field.key];
          if (v === undefined || v === "") continue;
          credentials[field.key] = field.numeric === true ? Number(v) : v;
        }
        try {
          validateChannelInput(currentType, name, credentials); // 终验：与标志路径同一规则（FR-009）
          return { action: "save", type: currentType, name, credentials };
        } catch (cause) {
          io.print(
            `✗ 配置校验失败：${cause instanceof Error ? cause.message : String(cause)}，请修改后重试`,
          );
          phase = "fields";
          i = fields.length - 1;
          continue;
        }
      }
      // 返回上一步修改
      phase = "fields";
      i = fields.length - 1;
    }
  }
}

// StepResult 仅用于类型收窄提示（未直接引用时避免未使用告警的占位说明）
export type { StepResult };
