# Project Agent Rules

## Default Development Mode

- Implement clear requests directly and avoid specs or long plans unless requested.
- Before development, read `docs/wiki/index.md` and then only task-relevant pages.
- Code, tests, and current user instructions take precedence over wiki content.
- Fast-path requests use the smallest safe scoped change.

## Development Loop

- Understand the relevant code, make the focused change, run the fastest relevant validation, and correct failures.
- Update `docs/wiki/` when behavior, configuration, architecture, test commands, or important constraints change.
- Keep `CLAUDE.md` aligned with these rules.

## Wiki and Docs

- The wiki is supporting context, not a source of truth.
- Keep verified facts concise and update the Recent Updates entry when changing it.

## Error Tracking

- Record unexpected command and integration failures in `.learnings/ERRORS.md`.

## 全局默认补充规则

- 目标明确时直接进行最小范围修改；快速通道同样遵循理解上下文 → 修改 → 最快相关验证 → 修正失败 → 总结，不为闭环扩大范围。
- 保持格式、命名、类型、错误处理与项目现有风格一致，避免重复和死代码；未经用户同意或项目已有模式要求，不引入依赖。
- 先检查项目已有 formatter、lint、typecheck、test scripts，优先使用现有工具；修改后运行相关验证，无法运行时说明原因。仅在项目已配置时使用 oxlint。
- 修改开发流程、快速通道或质量规则时，同步维护面向 Codex 的 `AGENTS.md` 和面向 Claude Code 的 `CLAUDE.md`，保留原约束。
- 普通网页操作默认使用 ego-browser，用户可见操作标题使用简体中文；仅在需要其未提供的高级测试能力时使用 Playwright，并清理本次创建的页面、上下文和进程，不使用广泛 pkill。
