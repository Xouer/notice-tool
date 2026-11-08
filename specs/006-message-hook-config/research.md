# Research/技术调研: Configuration Format Selection/配置格式选型

**Feature/功能**: Cross-Platform Message Hook Configuration/跨平台消息钩子配置

**Date/日期**: 2026-11-08

## Decision/结论

选择 **JSON** 作为 NoticeTool 钩子配置模板与用户可查看配置的统一格式；Codex CLI 目标文件仍按其原生要求生成 TOML，但 NoticeTool 内部模板定义、状态持久化与导出内容均使用 JSON。

## Rationale/理由

- **原生契合度最高**：CodeBuddy 与 Claude Code 的 hooks 均存储在 `settings.json` 中，结构为 JSON；Codex CLI 虽使用 TOML，但其不在本次二选一范围内，且可由 JSON 模板生成 TOML 片段。
- **与现有项目一致**：NoticeTool 自身配置加载器已基于 JSON（`config.json`），沿用 JSON 可复用校验、错误分类与默认值合并逻辑，不引入新解析器。
- **跨平台可靠性**：JSON 无缩进歧义，Windows 换行与编码处理更稳定，适合本工具三类桌面系统目标。
- **可验证性更强**：JSON 便于用现有类型系统与单元测试直接建模，模板 schema、启停状态与错误信息可被严格校验。
- **最小依赖**：无需新增 YAML 解析依赖，符合项目“简单设计”原则。

## Alternatives Considered/备选方案

- **YAML**: 更适合手写和注释，但需要引入解析依赖，存在缩进与多行字符串歧义，且与 CodeBuddy、Claude Code 原生 JSON 配置不匹配；本功能配置由工具生成和管理，人工编辑优势不明显。
- **TOML**: Codex CLI 原生使用，但 CodeBuddy 与 Claude Code 不支持，且会迫使项目维护两套配置格式；仅作为 Codex 适配器的输出格式保留。

## Evidence/依据

| 目标 | 原生配置格式 | 官方依据 |
|------|--------------|----------|
| CodeBuddy | JSON（`~/.codebuddy/settings.json` 等） | CodeBuddy Hook 参考指南 |
| Claude Code | JSON（`~/.claude/settings.json` 等） | Claude Code Hooks Reference |
| Codex CLI | TOML（`~/.codex/config.toml`） | Codex CLI Configuration Reference |

## Open Questions/待确认事项

无。已确认 JSON 为本功能的统一配置格式；Codex 的 TOML 输出属于适配细节，不改变总体选型。
