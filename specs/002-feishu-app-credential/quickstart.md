# Quickstart: Feishu App Credential Channel/快速开始：飞书应用凭证通道

**Feature**: [spec.md](spec.md) | **Plan**: [plan.md](plan.md) | **Date**: 2026-11-07

面向最终用户的端到端验证指南（对应 spec SC-101"≤ 5 分钟完成配置 → 测试送达"）。

## 第一步：在飞书开放平台准备应用（约 3 分钟）

1. 打开[飞书开放平台开发者后台](https://open.feishu.cn/app)，创建一个**企业自建应用**，获得 `App ID`（`cli_` 开头）与 `App Secret`。
2. 在应用"权限管理"中开通**以应用身份发消息**（`im:message` 发送相关）权限。
3. （若发往群）把应用机器人加入目标群；（若发往个人）确认自己在应用可用范围内。
4. 在"版本管理与发布"中**创建版本并发布**（未发布版本时权限不生效——常见失败原因，spec 边界情况已覆盖）。
5. （发往群时）在群的会话设置中获取/复制群会话 ID（`oc_` 开头），或在开放平台"API 调试台"用接口查询。

## 第二步：配置渠道（约 1 分钟）

```bash
# 已有环境可直接跳过 init
notice init

# 以应用凭证添加飞书渠道
notice channel add feishu --name my-feishu --mode app \
  --app-id <你的AppID> --app-secret "<你的AppSecret>" \
  --receive-id-type chat_id --receive-id <群会话ID或用户标识>
```

- 想发给自己（个人）：`--receive-id-type open_id` 并填你的 `ou_` 开头 Open ID。
- 凭据即时加密入库；`notice channel list` 中只显示掩码摘要。

## 第三步：测试发送并验证（约 1 分钟）

```bash
notice channel test my-feishu
```

- 成功：目标会话收到"notice 测试消息"，CLI 显示成功且渠道自动启用。
- 失败：按提示分类排查——
  - `AUTH_INVALID` + "权限"指引 → 回开放平台开通 `im:message` 权限并发布版本；
  - `CONTENT_REJECTED` + "不在会话"指引 → 把应用机器人加入群，或核对 `--receive-id` 与类型；
  - 凭证错误 → 核对 `App ID` / `App Secret`。

## 第四步：端到端验收（任务完成通知）

1. 启动常驻服务：`notice serve`。
2. 在智能体中注册任务结束钩子指向本工具（或用 `notice hook` 模拟一次事件）。
3. 验证：任务结束时，飞书目标会话收到完成通知（含任务标识、结束时间、结果概要）；`notice history` 有对应记录。
4. 验证"恰好一次"：钩子 + 巡查同开，同一任务只收到一轮通知。

## 开发者验证（本地测试）

```bash
npm test          # 全量测试：含 002 新增单元/集成用例 + 001 Webhook 回归（全绿 = SC-104）
npm run build     # 类型检查 + 构建
```

集成测试不访问真实开放平台——通过本地假服务模拟令牌与消息接口（含各错误分类与令牌中途失效自动重取场景）。
