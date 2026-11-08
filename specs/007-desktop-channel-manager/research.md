# Research/技术调研: Desktop Channel Manager/桌面渠道管理工具

**Date**: 2026-11-08 | **Feature**: [spec.md](spec.md)

## Research Questions/调研问题

1. 桌面端框架如何选择，才能同时满足 Windows 系统托盘、简约界面与现有 TypeScript/Node 代码复用？
2. 现有服务、渠道配置、凭据加密与智能体接入能力中，哪些模块可直接复用，哪些必须新增？
3. 服务启停与外部 `notice serve` 进程并存时，桌面端如何保证状态真实？
4. “注册信息”在当前代码库中的真实来源是什么，能否只读展示而不实现 006 的模板写入功能？

## Existing Code Inventory/现有代码盘点

- **服务运行时**：`src/cli/serve.ts` 组合 `createHookServer`（Fastify，仅 127.0.0.1）、保留清理定时器与 `PollingScheduler`；当前仅响应 SIGINT/SIGTERM，无 start/stop/status 管理入口。
- **渠道能力**：`src/storage/channel-repository.ts` 提供 create/list/update/rename/setEnabled/getCredentials；`src/channels/channel-config.ts` 提供校验与 `summarizeCredentials` 掩码；`src/channels/index.ts` 的 `getAdapter(type).send` 可直接用于测试发送；测试成功自动启用逻辑目前位于 `src/cli/channel.ts` 的 test action。
- **凭据保护**：`src/storage/crypto.ts`（AES-256-GCM）与 `src/storage/secret-store.dpapi.ts`（Windows DPAPI）可直接在桌面主进程复用。
- **事件与历史**：`src/cli/index.ts` 的 `openStore/createIngest` 是 CLI、HTTP 与巡检共用的管线入口；`notification_records` 可支撑注册信息的“最近接入信号”。
- **注册信息**：当前没有实现 006 规格的钩子模板写入；`src/cli/hook.ts` 仅包含来源映射，巡检适配器仅读取智能体会话目录。桌面端只能新增只读注册探测器。
- **存储与配置**：`src/storage/schema.ts` 与 `%APPDATA%/notice-tool/config.json` 已具备共享基础，WAL 模式支持 GUI 与外部服务进程并发读取。

结论：除服务运行时管理、桌面进程与注册探测器外，其余能力全部复用，不引入第二套配置或数据库。

## Desktop Framework Research/桌面框架调研

### Electron/Electron

- 2026-11-05 稳定版为 Electron 45.2.3，内置 Chromium 156 与 Node.js 24，满足项目 Node ≥22 约束。
- 优点：主进程可直接 `import` 现有 TypeScript 编译产物与 `better-sqlite3`，无需跨语言边界；系统托盘、单实例、contextBridge 安全模型成熟；`electron-vite` 支持 Vite 8 与主进程/渲染进程分离构建。
- 代价：安装包与内存占用高于 Tauri；本功能为本地单用户工具，目标机器为开发机，可接受。

### Tauri 2/Tauri 2

- 2026 年稳定线为 Tauri 2.12，安装包 <10MB、内存占用低，Windows 使用 WebView2 与原生托盘。
- 否决原因：后端为 Rust，现有 `better-sqlite3`、DPAPI、Fastify、巡检调度器均无法直接复用，必须引入 Rust 工具链或 Node sidecar 进程；跨进程共享数据库与凭据会显著增加复杂度，违反宪法原则 I。

### Browser UI/Browser UI

- 否决原因：浏览器页面无法访问系统托盘、DPAPI 与本地服务生命周期，且凭据 IPC 缺乏隔离模型。

## Architecture Decision/架构决策

- **框架**：Electron 45 + React 19 + Vite 8 + electron-vite；渲染进程仅 UI，主进程承载业务复用模块。
- **服务模型**：从 `src/cli/serve.ts` 提取可复用 `ServiceRuntime`，GUI 与 CLI 共用；GUI 内嵌运行时，不新增独立守护进程。
- **状态真实性**：hook server 新增只读 `GET /health`（向后兼容），GUI 启动/刷新前探测回环端口，识别外部 `notice serve` 并显示“外部运行中”。
- **注册信息**：新增只读 `AgentRegistrationReader`，读取 CodeBuddy/Claude Code/Codex CLI 配置文件与通知历史，不写入钩子配置。
- **UI 风格**：自研轻量 CSS 设计令牌（左侧导航、卡片、状态徽标），不引入重型组件库。

## Alternatives Considered/备选方案与否决理由

| 方案                             | 结论 | 理由                                                                                            |
| -------------------------------- | ---- | ----------------------------------------------------------------------------------------------- |
| Tauri 2 + Rust 后端              | 否决 | 无法复用现有 Node 模块，需双运行时或重写，复杂度不成比例                                        |
| Electron + 子进程 `notice serve` | 否决 | 进程打包与生命周期复杂，需额外通信协议；内嵌 ServiceRuntime 更简单                              |
| 独立 Web 管理端 + 浏览器         | 否决 | 无托盘与本机凭据访问，不满足 FR-005 与安全边界                                                  |
| 复用 CLI action 层               | 否决 | action 层混合参数解析、IO 与业务，GUI 直接复用会带入 stdin/输出耦合；改用 Repository/Adapter 层 |
| 引入 UI 组件库                   | 否决 | 三个页面 + 表单可用轻量 CSS 完成，避免视觉与依赖膨胀                                            |

## Open Items/实现阶段待验证项

1. CodeBuddy 全局与项目级 `settings.json` 的实际优先级与字段形态，以真实环境 fixture 固化。
2. Claude Code `~/.claude/settings.json` 与项目级配置同时存在时的读取顺序，注册探测器需给出明确优先级。
3. 外部服务占用回环端口但 `/health` 不可用（旧版本）时的降级展示：端口占用视为“外部运行中（状态未知）”，不得误报可停止。
