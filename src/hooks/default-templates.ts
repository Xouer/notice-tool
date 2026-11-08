import { join } from "node:path";
import {
  HOOK_AGENTS,
  HOOK_PLATFORMS,
  type HookAgent,
  type HookPlatform,
  type HookTemplateId,
} from "./types.js";

/**
 * 内置钩子模板定义（006-T006）。
 * 三平台 × 三智能体共九种；配置路径基于用户主目录注入（测试可控）。
 */

export interface HookTemplateDefinition {
  id: HookTemplateId;
  platform: HookPlatform;
  agent: HookAgent;
  version: string;
  /** 目标事件：JSON 智能体为 "Stop"，Codex 为 "notify"。 */
  eventName: string;
  /** 目标配置文件格式：JSON 或 TOML。 */
  kind: "json" | "toml";
  /** 目标配置文件绝对路径。 */
  configPath: string;
  /** 注册进智能体配置的命令行（notice 子命令）。 */
  command: string[];
}

export const AGENT_LABELS: Readonly<Record<HookAgent, string>> = {
  codebuddy: "CodeBuddy",
  "claude-code": "Claude Code",
  "codex-cli": "Codex CLI",
};

export const PLATFORM_LABELS: Readonly<Record<HookPlatform, string>> = {
  linux: "Linux",
  macos: "macOS",
  windows: "Windows",
};

function jsonDef(
  platform: HookPlatform,
  agent: HookAgent,
  home: string,
  relDir: string,
  command: string[],
): HookTemplateDefinition {
  return {
    id: `${platform}-${agent}`,
    platform,
    agent,
    version: "1",
    eventName: "Stop",
    kind: "json",
    configPath: join(home, relDir, "settings.json"),
    command,
  };
}

function tomlDef(platform: HookPlatform, home: string): HookTemplateDefinition {
  return {
    id: `${platform}-codex-cli`,
    platform,
    agent: "codex-cli",
    version: "1",
    eventName: "notify",
    kind: "toml",
    configPath: join(home, ".codex", "config.toml"),
    command: ["notice", "hook", "--source", "codex-cli", "--payload-argv"],
  };
}

/** 构造九种内置模板（home 为主目录，测试注入）。 */
export function buildHookTemplates(home: string): HookTemplateDefinition[] {
  const defs: HookTemplateDefinition[] = [];
  for (const platform of HOOK_PLATFORMS) {
    defs.push(
      jsonDef(platform, "codebuddy", home, ".codebuddy", [
        "notice",
        "hook",
        "--source",
        "codebuddy",
      ]),
      jsonDef(platform, "claude-code", home, ".claude", [
        "notice",
        "hook",
        "--source",
        "claude-code",
      ]),
      tomlDef(platform, home),
    );
  }
  return defs;
}

export function findHookTemplate(
  templates: readonly HookTemplateDefinition[],
  id: string,
): HookTemplateDefinition | undefined {
  return templates.find((t) => t.id === id);
}

/** 智能体配置目录（安装痕迹检测用，FR-013）。 */
export function agentConfigDir(home: string, agent: HookAgent): string {
  switch (agent) {
    case "codebuddy":
      return join(home, ".codebuddy");
    case "claude-code":
      return join(home, ".claude");
    case "codex-cli":
      return join(home, ".codex");
  }
}

/** 供校验/展示：合法 id 组合集合。 */
export const KNOWN_TEMPLATE_IDS: ReadonlySet<string> = new Set(
  HOOK_PLATFORMS.flatMap((platform) => HOOK_AGENTS.map((agent) => `${platform}-${agent}`)),
);
