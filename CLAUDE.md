# Claude Code Project Rules

This file stays aligned with `AGENTS.md`.

- Default to direct, focused implementation instead of specs or long plans.
- Read `docs/wiki/index.md` before development and consult only relevant pages.
- Treat current user instructions, code, and tests as authoritative over the wiki.
- Run the fastest relevant validation and update affected wiki pages for behavior, configuration, architecture, test-command, or important-constraint changes.
- Fast-path keywords use the smallest safe scoped change.
- Record unexpected command and integration failures in `.learnings/ERRORS.md`.

## macOS Installation and Build Copies

- Keep the installed application at `/Applications/Minduck Matter.app`; replace that same path and name when an installation is authorized. Quit the installed app before replacing it and preserve its user-data directory.
- Do not create or retain rollback application backups, including `.app` copies or additional ZIP archives, unless the user explicitly requests them. After verifying the new installation artifact, replace the installed app directly; preserve its user data and normal release artifacts.
- Use `pnpm dist:mac` and its temporary build directory. Manual signing or packaging workarounds must also clean up their temporary application bundles and detach their mounted DMGs after verification. Preserve required artifacts as DMG/ZIP, plus validation records.
- If duplicate application entries remain, inspect native application resolution and unregister only the verified obsolete Minduck paths; preserve the installed app and avoid global LaunchServices resets.
- Keep these rules synchronized with `AGENTS.md`; see `docs/macos-distribution.md` for the installation procedure.

## Global Default Addendum

- This is Claude Code's project rules file; keep its behavior rules synchronized with the Codex-facing `AGENTS.md`, preserving existing constraints.
- Implement clear goals with the smallest scoped change. Fast-path work still follows context → change → fastest relevant validation → fix failures → summary; do not expand scope to complete the loop.
- Follow existing formatting, naming, types and error-handling conventions; avoid duplication and dead code. Do not add dependencies without user approval or an existing project requirement.
- Inspect and use the project's formatter, lint, typecheck and test scripts. Run relevant validation after changes and explain checks that cannot run. Use oxlint only when already configured.
- Synchronize development-mode, fast-path and quality-rule changes between both rule files.
- Default to ego-browser for ordinary webpage operations, with Simplified Chinese action titles. Use Playwright only for advanced testing needs and clean up this task's pages, contexts and processes without broad pkill.
