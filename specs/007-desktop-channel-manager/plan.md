# Implementation Plan/实施计划: Desktop Channel Manager/桌面渠道管理工具

**Branch**: `007-desktop-channel-manager` | **Date**: 2026-11-08 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/007-desktop-channel-manager/spec.md`

## Summary/概述

为现有命令行工具新增 Windows 桌面端：Electron 主进程复用现有仓储、渠道适配器、DPAPI 凭据保护与服务运行时，React 渲染进程提供简约的首页、注册信息与通知渠道页面。技术调研（research.md）确认 Electron 45 + React 19 + Vite 8 是最小可行组合；Tauri 因无法复用 Node 模块而被否决。

核心改动：

1. 从 `src/cli/serve.ts` 提取 `ServiceRuntime`，CLI 与桌面共用；hook server 新增只读 `GET /health` 识别外部服务。
2. 新增 `ChannelController`，直接复用 `ChannelRepository`、`validateChannelInput`、`getAdapter().send` 与测试成功自动启用语义。
3. 新增只读 `AgentRegistrationReader`，读取 CodeBuddy/Claude Code/Codex CLI 配置与通知历史。
4. 新增 Electron 主进程/Preload/React 渲染进程，托盘最小化与显式退出由主进程管理。

无数据库迁移、无 CLI 参数变更、无现有端点破坏性变更。

## Technical Context/技术上下文

**Language/Version**: TypeScript ~5.9 / Node.js ≥22（Electron 45 内置 Node 24）

**Primary Dependencies**: Electron ^45.2.3、React ^19、Vite ^8.1、electron-vite、Fastify（现有）、better-sqlite3 + drizzle（现有）、@primno/dpapi（现有）、Vitest（现有）

**Storage**: 复用 `%APPDATA%/notice-tool/notice.db` 与 `secret.key`；无 schema 变更，WAL 支持与外部 `notice serve` 并发读取

**Testing**: Vitest + @testing-library/react + jsdom；主进程逻辑以 fake IPC/适配器注入测试

**Target Platform**: Windows 10+ 单用户桌面；macOS/Linux 不在首期

**Project Type**: 桌面应用（Electron main + preload + renderer）与现有 CLI 共存

**Performance Goals**: 本地 IPC 列表/状态读取 p95 <200ms；服务状态变化广播 <200ms；测试操作 30s 超时；桌面应用冷启动 <3s（开发机）

**Constraints**: 渲染进程 sandbox、contextIsolation；HTTP 仅回环；无远端管理；凭据不进入渲染进程与日志；UI 不引入重型组件库

**Scale/Scope**: 3 个页面、6 个用户故事、20 条功能需求、约 10 个新增源码模块与对应测试

## Constitution Check/宪法检查

_GATE: Must pass before Phase 0 research. Re-check after Phase 1 design._

| 原则            | 结论 | 说明                                                                                                        |
| --------------- | ---- | ----------------------------------------------------------------------------------------------------------- |
| I 简单设计      | 通过 | 复用现有 Node/TS 模块；Electron 是满足托盘与本机复用的最简方案；拒绝 Tauri 双运行时、子进程守护与 UI 组件库 |
| II 测试先行     | 通过 | 每个模块先写失败测试再实现；见“测试策略”                                                                    |
| III API 兼容性  | 通过 | CLI 参数与 schema 不变；仅新增可选 `GET /health`；`notice serve` 行为保持                                   |
| IV 安全审查     | 通过 | 见“安全审查”节；渲染进程零 Node 权限，凭据只在主进程瞬时解密                                                |
| V 代码审查      | 通过 | 合入前非作者审查，覆盖宪法与双语标题检查                                                                    |
| VI 中英双语标题 | 通过 | plan/research/data-model/contracts/quickstart 标题均双语                                                    |

**Phase 1 复检**：ServiceRuntime、IPC 契约与注册探测器均为内聚新增模块；未引入第二套存储或并行服务机制，上述结论维持。

## Security Review/安全审查（宪法 IV 必需）

- **数据类型**：渠道凭据、接收目标、智能体注册配置、服务状态、通知历史结果。
- **信任边界**：渲染进程为不可信 UI 层，仅能调用 preload 白名单 IPC；主进程是唯一信任边界；外部智能体配置文件为只读输入。
- **访问主体**：当前 Windows 本机用户；无远程访问、多用户或团队共享。
- **最小权限**：渲染进程 `sandbox: true`、`nodeIntegration: false`；注册探测器只读取三个约定路径；服务仍仅监听 127.0.0.1。
- **敏感数据**：明文凭据只存在于保存/测试瞬时内存；列表与表单回显使用掩码；错误与日志经现有脱敏；renderer state 不保留敏感值。
- **失效与撤销**：停止服务暂停本地通知处理；修改可替换凭据；测试失败不隐式禁用或清除配置。
- **内容安全**：窗口禁用远程内容，启用 CSP；不加载外部站点。

## Test Strategy/测试策略（宪法 II：先 Red 后 Green）

1. **单元测试（先行编写）**
   - `service-runtime.test.ts`：状态机、重复启动/停止、外部服务探测、失败回滚；Fastify 用随机端口与 fake health 探测。
   - `channel-controller.test.ts`：新增校验、部分更新三态、敏感字段不回显、测试锁、成功自动启用与失败保持状态；`openMemoryDatabase` + fake adapter。
   - `registration-reader.test.ts`：虚构配置文件覆盖未注册/有效/无效/读取失败与最近信号。
   - `hook-server-health.test.ts`：`GET /health` 兼容性。
   - Renderer 组件测试：首页状态、渠道表单校验与摘要、注册列表、空状态。
2. **集成测试**
   - IPC handler 测试：fake `ipcMain/ipcRenderer`，验证通道白名单、错误封装与脱敏。
   - 服务生命周期：start → status → stop → refresh；外部端口占用降级。
   - 渠道端到端：新增 → 测试成功 → 自动启用；修改失败零写入。
3. **验收测试**：按 quickstart.md 执行托盘、服务与渠道实测，核对 SC-001~SC-008。
4. **门槛**：全部 Vitest 通过、lint/format 通过、安全抽查零凭据泄露。

## Project Structure/项目结构

### Documentation (this feature)/文档（本功能）

```text
specs/007-desktop-channel-manager/
├── plan.md                        # 本文件（/speckit.plan 输出）
├── research.md                    # 框架与复用调研
├── data-model.md                  # 逻辑模型与 IPC DTO
├── quickstart.md                  # 手动验证指南
├── contracts/
│   ├── service-runtime.md         # 服务运行时与健康端点
│   ├── desktop-ipc.md             # IPC 通道与安全模型
│   └── registration-reader.md     # 注册信息只读探测
├── checklists/
│   └── requirements.md            # 规格质量清单（16/16 通过）
└── tasks.md                       # /speckit.tasks 输出（本阶段不创建）
```

### Source Code (repository root)/源代码（仓库根目录）

```text
src/
├── core/
│   └── service-runtime.ts          # 新增：CLI/GUI 共用服务运行时
├── hookserver/
│   └── server.ts                   # 修改：新增 GET /health
├── registration/
│   └── reader.ts                   # 新增：智能体注册只读探测器
├── desktop/
│   ├── main/
│   │   ├── index.ts                # 新增：Electron 应用生命周期
│   │   ├── window.ts               # 新增：主窗口与安全配置
│   │   ├── tray.ts                 # 新增：托盘、恢复、退出确认
│   │   ├── ipc.ts                  # 新增：IPC 通道注册与白名单
│   │   └── channel-controller.ts   # 新增：渠道 GUI 业务封装
│   ├── preload/
│   │   └── index.ts                # 新增：contextBridge API
│   └── renderer/
│       ├── App.tsx                 # 新增：导航与路由
│       ├── pages/
│       │   ├── HomePage.tsx        # 新增：服务与摘要
│       │   ├── ChannelsPage.tsx    # 新增：列表与表单
│       │   └── RegistrationPage.tsx# 新增：注册信息
│       ├── components/             # 新增：状态徽标、表单控件
│       └── styles/                 # 新增：简约设计令牌与布局
├── cli/
│   └── serve.ts                    # 修改：改为调用 ServiceRuntime
└── （channels/storage/core/config 现有模块全部复用，不改）

tests/
├── unit/
│   ├── service-runtime.test.ts
│   ├── channel-controller.test.ts
│   ├── registration-reader.test.ts
│   ├── hook-server-health.test.ts
│   └── renderer/*.test.tsx
└── integration/
    ├── desktop-ipc.test.ts
    ├── desktop-service-lifecycle.test.ts
    └── desktop-channel-flow.test.ts
```

**Structure Decision**: 保持单仓库单 package，新增 `src/desktop` 与 `src/registration` 两个内聚目录；业务复用层不复制 CLI action，测试沿用现有 unit/integration 分层。新增 `desktop:dev`、`desktop:build`、`desktop:package` npm scripts。

## Execution Order/执行顺序

1. 建立桌面构建与测试骨架（依赖、scripts、tsconfig 分区）。
2. 先写 `ServiceRuntime` 与 `/health` 测试，再实现并改造 `notice serve`。
3. 先写 `ChannelController` 测试，再实现新增/修改/测试与防重复锁。
4. 先写 `RegistrationReader` 测试，再实现只读探测。
5. 实现 preload/IPC 契约与错误封装，配套集成测试。
6. 实现 React 页面、表单与状态展示，配套组件测试。
7. 实现窗口、托盘与退出确认，完成 quickstart 验收与打包脚本。

## Compatibility & Rollout/兼容性与发布

- 现有 `notice` CLI、HTTP 钩子端点、MCP、配置文件与数据库全部向后兼容。
- `/health` 为可选新增端点，旧版本外部服务探测降级为“外部运行中（状态未知）”。
- 桌面应用与 CLI 共享同一数据目录；并发访问依赖 SQLite WAL，不做数据复制。
- 打包产物独立于 `dist/cli`，不改变 npm bin 入口。

## Complexity Tracking/复杂度记录

无宪法违规项，无需复杂度豁免。Electron 体积代价已在 research.md 与宪法 I 检查中论证为满足需求的最低复杂度选择。
