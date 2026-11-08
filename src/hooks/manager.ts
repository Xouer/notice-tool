import { homedir } from "node:os";
import { readConfigFile, writeConfigFileAtomic } from "./config-file-writer.js";
import {
  buildHookTemplates,
  findHookTemplate,
  type HookTemplateDefinition,
} from "./default-templates.js";
import type { HookConfigAdapter } from "./adapter.js";
import { jsonSettingsAdapter } from "./json-settings.js";
import { codexConfigAdapter } from "./codex-config.js";
import type { HookAgent, HookPlatform, HookTemplateId, ValidationStatus } from "./types.js";
import { HookConfigError, isHookAgent, isHookPlatform } from "./types.js";
import type { HookTemplateRepository } from "../storage/hook-template-repository.js";

/**
 * 钩子配置编排（006-US1/US2/US3）：
 * list/show（只读）、enable（合并写入 + 状态持久化）、disable（移除 + 状态）、validate。
 * 主目录可注入，便于测试与跨平台路径。
 */

export interface TemplateView {
  id: HookTemplateId;
  platform: HookPlatform;
  agent: HookAgent;
  version: string;
  eventName: string;
  kind: "json" | "toml";
  configPath: string;
  command: string[];
  enabled: boolean;
  lastValidationStatus: ValidationStatus;
  lastValidationMessage: string | null;
  lastValidationAt: Date | null;
}

export interface ManagerOptions {
  homeDir?: string;
  repository: HookTemplateRepository;
}

export class HookConfigManager {
  readonly #home: string;
  readonly #repository: HookTemplateRepository;

  constructor(options: ManagerOptions) {
    this.#home = options.homeDir ?? homedir();
    this.#repository = options.repository;
  }

  templates(): HookTemplateDefinition[] {
    return buildHookTemplates(this.#home);
  }

  private requireTemplate(id: string): HookTemplateDefinition {
    const def = findHookTemplate(this.templates(), id);
    if (def === undefined) {
      throw new HookConfigError(
        `未知模板：${id}（使用 \`notice hook-config list\` 查看可用模板）`,
        "not_found",
      );
    }
    return def;
  }

  private adapterFor(def: HookTemplateDefinition): HookConfigAdapter {
    return def.kind === "toml" ? codexConfigAdapter : jsonSettingsAdapter;
  }

  /** 列表：九种内置模板 + 实例状态（未实例化派生为"不启动"）。 */
  list(filter?: { platform?: string; agent?: string }): TemplateView[] {
    const instances = this.#repository.list();
    const views: TemplateView[] = [];
    for (const def of this.templates()) {
      if (filter?.platform !== undefined && !isHookPlatform(filter.platform)) {
        throw new HookConfigError(
          `无效 --platform：${filter.platform}（支持 linux/macos/windows）`,
          "not_found",
        );
      }
      if (filter?.platform !== undefined && def.platform !== filter.platform) continue;
      if (filter?.agent !== undefined && !isHookAgent(filter.agent)) {
        throw new HookConfigError(
          `无效 --agent：${filter.agent}（支持 codebuddy/claude-code/codex-cli）`,
          "not_found",
        );
      }
      if (filter?.agent !== undefined && def.agent !== filter.agent) continue;
      const instance = instances.find((i) => i.templateId === def.id);
      views.push({
        id: def.id,
        platform: def.platform,
        agent: def.agent,
        version: def.version,
        eventName: def.eventName,
        kind: def.kind,
        configPath: def.configPath,
        command: def.command,
        enabled: instance?.enabled ?? false,
        lastValidationStatus: instance?.lastValidationStatus ?? "not_validated",
        lastValidationMessage: instance?.lastValidationMessage ?? null,
        lastValidationAt: instance?.lastValidationAt ?? null,
      });
    }
    return views;
  }

  show(id: string): TemplateView {
    const def = this.requireTemplate(id);
    const instance = this.#repository.get(def.id);
    return {
      id: def.id,
      platform: def.platform,
      agent: def.agent,
      version: def.version,
      eventName: def.eventName,
      kind: def.kind,
      configPath: def.configPath,
      command: def.command,
      enabled: instance?.enabled ?? false,
      lastValidationStatus: instance?.lastValidationStatus ?? "not_validated",
      lastValidationMessage: instance?.lastValidationMessage ?? null,
      lastValidationAt: instance?.lastValidationAt ?? null,
    };
  }

  /** 启用：冲突需确认；原子写入成功后才持久化"已启动"。 */
  enable(
    id: string,
    opts: { confirm: boolean },
  ): { templateId: string; enabled: boolean; alreadyPresent: boolean } {
    const def = this.requireTemplate(id);
    const adapter = this.adapterFor(def);
    const existing = readConfigFile(def.configPath);
    const merged = adapter.merge(existing, def);
    if (merged.conflict && !opts.confirm) {
      throw new HookConfigError(
        `目标配置已存在其他钩子（${def.configPath}）：合并会影响既有配置，请先核对后加 --confirm 覆盖`,
        "conflict",
      );
    }
    if (!merged.alreadyPresent) {
      writeConfigFileAtomic(def.configPath, merged.content);
    }
    this.#repository.upsert({
      templateId: def.id,
      platform: def.platform,
      agent: def.agent,
      enabled: true,
    });
    return { templateId: def.id, enabled: true, alreadyPresent: merged.alreadyPresent };
  }

  /** 停用：仅移除本工具写入的钩子；幂等。 */
  disable(id: string): { templateId: string; enabled: boolean; removed: boolean } {
    const def = this.requireTemplate(id);
    const adapter = this.adapterFor(def);
    const existing = readConfigFile(def.configPath);
    let removed = false;
    if (existing !== undefined) {
      const result = adapter.remove(existing, def);
      if (result.content !== undefined && result.removed) {
        writeConfigFileAtomic(def.configPath, result.content);
        removed = true;
      }
    }
    this.#repository.setEnabled(def.id, false);
    return { templateId: def.id, enabled: false, removed };
  }

  /** 校验目标配置当前是否包含本工具钩子，并持久化验证结果。 */
  validate(id: string): { templateId: string; status: ValidationStatus; message: string | null } {
    const def = this.requireTemplate(id);
    const adapter = this.adapterFor(def);
    const existing = readConfigFile(def.configPath);
    let status: ValidationStatus;
    let message: string | null;
    if (existing === undefined) {
      status = "invalid";
      message = `目标配置文件不存在：${def.configPath}（尚未启用）`;
    } else {
      try {
        const ok = adapter.contains(existing, def);
        status = ok ? "valid" : "invalid";
        message = ok ? null : "目标配置中未找到本工具的钩子（可能已被外部修改或移除）";
      } catch (cause) {
        if (cause instanceof HookConfigError && cause.category === "invalid_content") {
          status = "invalid";
          message = cause.message;
        } else {
          throw cause;
        }
      }
    }
    this.#repository.upsert({
      templateId: def.id,
      platform: def.platform,
      agent: def.agent,
    });
    this.#repository.setValidation(def.id, status, message);
    return { templateId: def.id, status, message };
  }
}
