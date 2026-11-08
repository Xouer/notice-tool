import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { desc, eq } from "drizzle-orm";
import { readConfigFile, writeConfigFileAtomic } from "./config-file-writer.js";
import {
  agentConfigDir,
  buildHookTemplates,
  findHookTemplate,
  type HookTemplateDefinition,
} from "./default-templates.js";
import type { HookConfigAdapter } from "./adapter.js";
import { jsonSettingsAdapter } from "./json-settings.js";
import { codexConfigAdapter } from "./codex-config.js";
import type { HookAgent, HookPlatform, HookTemplateId, ValidationStatus } from "./types.js";
import { HookConfigError, currentPlatform, isHookAgent, isHookPlatform } from "./types.js";
import type { HookTemplateRepository } from "../storage/hook-template-repository.js";
import type { NoticeDatabase } from "../storage/db.js";
import { notificationRecords, taskEvents } from "../storage/schema.js";

/**
 * 钩子配置编排（006-US1/US2/US3 + FR-013/FR-014/FR-015）：
 * list/show（只读，含平台匹配与安装状态）、enable/disable（合并写入 + 状态持久化）、
 * validate（含平台适用性）、status（四类可观测诊断）。
 * 主目录、平台、安装检测与数据库均可注入，便于测试与跨平台路径。
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
  /** 模板平台是否匹配当前系统（FR-013）。 */
  platformMatches: boolean;
  /** 目标智能体是否检测到安装痕迹（FR-013）。 */
  installed: boolean;
  /** 实例采用的模板版本是否落后于内置版本（FR-014）。 */
  versionMismatch: boolean;
  lastValidationStatus: ValidationStatus;
  lastValidationMessage: string | null;
  lastValidationAt: Date | null;
}

export interface StatusResult {
  templateId: string;
  enabled: boolean;
  platformMatches: boolean;
  installed: boolean;
  hookValid: ValidationStatus;
  recentEvent: { found: boolean; finishedAt: string | null; notifyStatus: string | null };
  recentNotification: { found: boolean; status: string | null };
}

export interface ManagerOptions {
  homeDir?: string;
  repository: HookTemplateRepository;
  /** 诊断（status）与平台查询依赖；未提供时 status 返回事件/通知未知。 */
  db?: NoticeDatabase;
  /** 当前平台；默认取自 process.platform。 */
  platform?: HookPlatform;
  /** 智能体安装检测注入；默认按配置目录存在性判定。 */
  isInstalled?: (agent: HookAgent) => boolean;
}

export class HookConfigManager {
  readonly #home: string;
  readonly #repository: HookTemplateRepository;
  readonly #db: NoticeDatabase | undefined;
  readonly #platform: HookPlatform;
  readonly #isInstalled: ((agent: HookAgent) => boolean) | undefined;

  constructor(options: ManagerOptions) {
    this.#home = options.homeDir ?? homedir();
    this.#repository = options.repository;
    this.#db = options.db;
    this.#platform = options.platform ?? currentPlatform();
    this.#isInstalled = options.isInstalled;
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

  private isInstalledFor(def: HookTemplateDefinition): boolean {
    if (this.#isInstalled !== undefined) {
      return this.#isInstalled(def.agent);
    }
    return existsSync(agentConfigDir(this.#home, def.agent));
  }

  private toView(
    def: HookTemplateDefinition,
    instance?: ReturnType<HookTemplateRepository["get"]>,
  ): TemplateView {
    const templateVersion = instance?.templateVersion ?? null;
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
      platformMatches: def.platform === this.#platform,
      installed: this.isInstalledFor(def),
      versionMismatch: templateVersion !== null && templateVersion !== def.version,
      lastValidationStatus: instance?.lastValidationStatus ?? "not_validated",
      lastValidationMessage: instance?.lastValidationMessage ?? null,
      lastValidationAt: instance?.lastValidationAt ?? null,
    };
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
      views.push(this.toView(def, instance));
    }
    return views;
  }

  show(id: string): TemplateView {
    const def = this.requireTemplate(id);
    return this.toView(def, this.#repository.get(def.id));
  }

  /** 启用：冲突需确认；原子写入成功后才持久化"已启动"并记录版本。 */
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
      templateVersion: def.version,
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

  /** 校验目标配置当前是否包含本工具钩子，并持久化验证结果（含平台适用性 FR-013）。 */
  validate(id: string): { templateId: string; status: ValidationStatus; message: string | null } {
    const def = this.requireTemplate(id);
    if (def.platform !== this.#platform) {
      const status: ValidationStatus = "invalid";
      const message = `模板适用于 ${def.platform}，当前系统为 ${this.#platform}，请改用对应平台的模板`;
      this.#repository.upsert({
        templateId: def.id,
        platform: def.platform,
        agent: def.agent,
      });
      this.#repository.setValidation(def.id, status, message);
      return { templateId: def.id, status, message };
    }
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

  /** 四类可观测诊断（FR-015）：未启动 / 钩子失效 / 事件未到达 / 通知失败。 */
  status(id: string): StatusResult {
    const def = this.requireTemplate(id);
    const instance = this.#repository.get(def.id);
    const enabled = instance?.enabled ?? false;

    let hookValid: ValidationStatus = "not_validated";
    if (enabled) {
      const existing = readConfigFile(def.configPath);
      if (existing === undefined) {
        hookValid = "invalid";
      } else {
        try {
          hookValid = this.adapterFor(def).contains(existing, def) ? "valid" : "invalid";
        } catch (cause) {
          if (cause instanceof HookConfigError && cause.category === "invalid_content") {
            hookValid = "invalid";
          } else {
            throw cause;
          }
        }
      }
    }

    let recentEvent: StatusResult["recentEvent"] = {
      found: false,
      finishedAt: null,
      notifyStatus: null,
    };
    let recentNotification: StatusResult["recentNotification"] = { found: false, status: null };
    if (this.#db !== undefined) {
      const event = this.#db
        .select()
        .from(taskEvents)
        .where(eq(taskEvents.sourceAgent, def.agent))
        .orderBy(desc(taskEvents.receivedAt))
        .limit(1)
        .get();
      if (event !== undefined) {
        recentEvent = {
          found: true,
          finishedAt: event.finishedAt.toISOString(),
          notifyStatus: event.notifyStatus,
        };
        const record = this.#db
          .select()
          .from(notificationRecords)
          .where(eq(notificationRecords.eventId, event.id))
          .orderBy(desc(notificationRecords.createdAt))
          .limit(1)
          .get();
        if (record !== undefined) {
          recentNotification = { found: true, status: record.status };
        }
      }
    }

    return {
      templateId: def.id,
      enabled,
      platformMatches: def.platform === this.#platform,
      installed: this.isInstalledFor(def),
      hookValid,
      recentEvent,
      recentNotification,
    };
  }
}
