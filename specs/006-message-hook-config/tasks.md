---
description: "Task list for Cross-Platform Message Hook Configuration"
---

# Tasks: Cross-Platform Message Hook Configuration/跨平台消息钩子配置

**Input/输入**: Design documents from `specs/006-message-hook-config/`

**Prerequisites/前置条件**: `plan.md`, `spec.md`, `research.md`, `data-model.md`, `contracts/`, `quickstart.md`

**Tests/测试**: Included. The project constitution mandates test-first development.

**Organization/组织**: Tasks are grouped by user story to enable independent implementation and testing.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

## Path Conventions

- **Single project**: `src/`, `tests/` at repository root

---

## Phase 1: Setup (Shared Infrastructure)/阶段 1：搭建（共享基础设施）

**Purpose/目的**: Create the shared module boundary and test fixtures for hook configuration.

- [X] T001 Create shared hook configuration types in `src/hooks/types.ts` (platform, agent, template id, status)
- [X] T002 Create public exports for the hook configuration module in `src/hooks/index.ts`
- [X] T003 [P] Create agent configuration fixtures under `tests/fixtures/hook-config/`

---

## Phase 2: Foundational (Blocking Prerequisites)/阶段 2：基础（阻塞前置）

**Purpose/目的**: Implement the built-in template catalog, persistence model, and command skeleton required by every user story.

**⚠️ CRITICAL/关键**: No user story work can begin until this phase is complete.

- [X] T004 [P] Write failing unit tests for the nine built-in templates in `tests/unit/hook-default-templates.test.ts`
- [X] T005 [P] Write failing unit tests for the template instance repository in `tests/unit/hook-template-repository.test.ts`
- [X] T006 Implement the nine built-in templates in `src/hooks/default-templates.ts`
- [X] T007 Implement the `hook_template_instances` table and repository in `src/storage/schema.ts` and `src/storage/hook-template-repository.ts`
- [X] T008 Implement the manager interface with `list`, `show`, `enable`, `disable`, and `validate` in `src/hooks/manager.ts`
- [X] T009 Register the `hook-config` CLI command skeleton in `src/cli/index.ts` and `src/cli/hook-config.ts`

---

## Phase 3: User Story 1 - View Cross-Platform Default Templates/用户故事 1：查看跨平台默认模板

**Goal/目标**: Users can browse all nine templates and their status without side effects.

**Independent Test/独立测试**: Run `notice hook-config list` and `notice hook-config show <id>`; verify nine templates, correct metadata, and no file changes.

- [X] T010 [P] [US1] Write contract tests for `notice hook-config list` and `show` in `tests/contract/cli-hook-config.test.ts`
- [X] T011 [US1] Implement list and show output with platform and agent filtering in `src/cli/hook-config.ts`
- [X] T012 [US1] Ensure browse-only operations do not modify target configs or persisted state in `src/hooks/manager.ts` and `src/cli/hook-config.ts`

---

## Phase 4: User Story 2 - Enable a Hook and Receive Notifications/用户故事 2：启用钩子并接收通知

**Goal/目标**: Users can enable a template and receive an end-to-end notification after a task ends.

**Independent Test/独立测试**: Enable one template, trigger a simulated task end event, and verify one notification is delivered through an enabled channel.

- [X] T013 [P] [US2] Write failing unit tests for the CodeBuddy config adapter in `tests/unit/hook-config-codebuddy.test.ts`
- [X] T014 [P] [US2] Write failing unit tests for the Claude Code config adapter in `tests/unit/hook-config-claude-code.test.ts`
- [X] T015 [P] [US2] Write failing unit tests for the Codex config adapter in `tests/unit/hook-config-codex.test.ts`
- [X] T016 [P] [US2] Write failing unit tests for the atomic config writer in `tests/unit/hook-config-file-writer.test.ts`
- [X] T017 [US2] Implement atomic config file writing with rollback in `src/hooks/config-file-writer.ts`
- [X] T018 [US2] Implement the CodeBuddy JSON config adapter in `src/hooks/codebuddy-config.ts`
- [X] T019 [US2] Implement the Claude Code JSON config adapter in `src/hooks/claude-code-config.ts`
- [X] T020 [US2] Implement the Codex TOML config adapter in `src/hooks/codex-config.ts`
- [X] T021 [US2] Implement the enable flow with confirmation and validation in `src/hooks/manager.ts` and `src/cli/hook-config.ts`
- [X] T022 [US2] Write the end-to-end notification integration test in `tests/integration/hook-config-flow.test.ts`

---

## Phase 5: User Story 3 - Disable and Manage Hook Templates/用户故事 3：停用并管理钩子模板

**Goal/目标**: Users can safely disable templates, avoid conflicts, and rely on idempotent state changes.

**Independent Test/独立测试**: Enable then disable a template, repeat the operations, and verify no duplicate hooks or unintended config changes.

- [X] T023 [P] [US3] Write failing unit tests for disable and idempotency in `tests/unit/hook-config-codebuddy.test.ts`, `tests/unit/hook-config-claude-code.test.ts`, and `tests/unit/hook-config-codex.test.ts`
- [X] T024 [US3] Implement disable flow and idempotent state transitions in `src/hooks/manager.ts`, `src/hooks/codebuddy-config.ts`, `src/hooks/claude-code-config.ts`, `src/hooks/codex-config.ts`, and `src/cli/hook-config.ts`
- [X] T025 [US3] Implement conflict detection and explicit user confirmation in `src/hooks/manager.ts` and `src/cli/hook-config.ts`
- [X] T026 [US3] Ensure template state persists across application restarts in `src/storage/hook-template-repository.ts`

---

## Phase 6: Polish & Cross-Cutting Concerns/阶段 6：打磨与横切关注点

**Purpose/目的**: Final validation, security review, and documentation consistency.

- [X] T027 Validate bilingual headings and cross-links across `specs/006-message-hook-config/*.md`
- [X] T028 Run the full test suite and lint checks using the scripts in `package.json`
- [X] T029 Review error messages, path masking, and sensitive data handling in `src/hooks/*` and `src/cli/hook-config.ts`

---

## Dependencies/依赖关系

```text
Phase 1 → Phase 2 → Phase 3 (US1)
                   → Phase 4 (US2)
                   → Phase 5 (US3)
Phase 3/4/5 → Phase 6
```

- **User Story 1 (P1)**: Can start after Phase 2.
- **User Story 2 (P1)**: Can start after Phase 2; independent of US1.
- **User Story 3 (P2)**: Can start after Phase 2; independent of US1/US2.
- All stories share the foundational template catalog and persistence model.

## Parallel Execution Examples/并行执行示例

### Within User Story 2/用户故事 2 内部

```bash
# Adapter tests and writer tests can run in parallel:
Task: "CodeBuddy adapter tests in tests/unit/hook-config-codebuddy.test.ts"
Task: "Claude Code adapter tests in tests/unit/hook-config-claude-code.test.ts"
Task: "Codex adapter tests in tests/unit/hook-config-codex.test.ts"
Task: "Config writer tests in tests/unit/hook-config-file-writer.test.ts"
```

### Across User Stories/跨用户故事

```bash
# After Phase 2, three developers can work simultaneously:
Developer A: User Story 1 (view templates)
Developer B: User Story 2 (enable and notify)
Developer C: User Story 3 (disable and manage)
```

## Implementation Strategy/实施策略

### MVP First (User Story 1 Only)/MVP 优先（仅用户故事 1）

1. Complete Phase 1 and Phase 2.
2. Complete User Story 1.
3. Validate that all nine templates are visible and browse-only.

### Incremental Delivery/增量交付

1. Add User Story 2 for end-to-end notifications.
2. Add User Story 3 for safe disable and conflict management.
3. Finish with Phase 6 validation and security review.

### Parallel Team Strategy/并行团队策略

- Phase 2 is the shared foundation.
- After Phase 2, user stories can proceed independently.
- Phase 6 should start only after at least one user story is complete.

---

## Notes/备注

- [P] tasks touch different files and have no incomplete dependencies.
- [Story] labels map tasks to user stories for traceability.
- Tests are included because the project constitution mandates test-first development.
- Commit after each task or logical group.
- Stop at any checkpoint to validate a user story independently.
