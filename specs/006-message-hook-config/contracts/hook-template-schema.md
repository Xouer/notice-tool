# Hook Template Schema Contract/钩子模板 Schema 契约

**Feature/功能**: Cross-Platform Message Hook Configuration/跨平台消息钩子配置

**Date/日期**: 2026-11-08

## Format/格式

- NoticeTool 内置模板定义与实例状态均使用 **JSON**。
- Codex CLI 目标文件按其原生要求生成 TOML；该转换由适配器完成，不影响本 schema。

## Template Definition Schema/模板定义 Schema

```json
{
  "id": "windows-codebuddy",
  "platform": "windows",
  "agent": "codebuddy",
  "version": "1",
  "eventName": "Stop",
  "configTarget": {
    "kind": "user",
    "path": "~/.codebuddy/settings.json"
  },
  "defaultContent": {
    "hooks": {
      "Stop": [
        {
          "hooks": [
            {
              "type": "command",
              "command": "notice hook --source codebuddy"
            }
          ]
        }
      ]
    }
  }
}
```

## Template Instance Schema/模板实例 Schema

```json
{
  "templateId": "windows-codebuddy",
  "platform": "windows",
  "agent": "codebuddy",
  "enabled": false,
  "customContent": null,
  "lastValidationResult": {
    "status": "not_validated",
    "failureCategory": null,
    "message": null,
    "timestamp": null
  }
}
```

## Validation Rules/校验规则

- `id` 必须唯一且由 `platform-agent` 组成。
- `platform` 只能为 `linux`、`macos`、`windows`。
- `agent` 只能为 `codebuddy`、`claude-code`、`codex-cli`。
- `enabled` 只能通过用户操作变更，默认为 `false`。
- `customContent` 若存在，必须与 `defaultContent` 结构兼容。
- `lastValidationResult.status` 只能为 `valid`、`invalid`、`not_validated`。
