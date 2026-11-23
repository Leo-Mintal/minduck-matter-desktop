# Claude Code Project Rules

This file stays aligned with `AGENTS.md`.

- Default to direct, focused implementation instead of specs or long plans.
- Read `docs/wiki/index.md` before development and consult only relevant pages.
- Treat current user instructions, code, and tests as authoritative over the wiki.
- Run the fastest relevant validation and update affected wiki pages for behavior, configuration, architecture, test-command, or important-constraint changes.
- Fast-path keywords use the smallest safe scoped change.
- Push verified changes to `main` and confirm the remote result. Keep `main` as the only remote branch by default. Before removing a temporary branch, verify its code is included in `main`. Follow explicit requests to keep a particular branch.
- Record unexpected command and integration failures in `.learnings/ERRORS.md`.

## macOS Installation and Build Copies

- 测试包保留当前客户端版本号，产物放在 `release/<version>/tests/<build-name>/`。
- 正式包在打包前提高 `package.json` 的 `version`，新版本必须高于线上更新清单的当前版本。测试包保留版本号的约定只适用于测试包。
- 每次打包客户端（包括正式包、测试包和同版本重打）前，都必须重新获取 Web 仓库远程 `dev` 分支当次最新代码，并重新构建 Web 后再打包客户端；不得直接复用旧的本地 Web 构建产物。
- 只有用户明确指定打包当前分支或 `main` / `master` 分支时，才改用用户指定的 Web 代码来源；该例外仅对当次指定的打包生效，后续仍默认重新获取远程 `dev`。
- 本次已授权的共享界面修改须一并保留。
- Keep the installed application at `/Applications/Minduck Matter.app`; replace that same path and name when an installation is authorized. Quit the installed app before replacing it and preserve its user-data directory.
- Do not create or retain rollback application backups, including `.app` copies or additional ZIP archives, unless the user explicitly requests them. After verifying the new installation artifact, replace the installed app directly; preserve its user data and normal release artifacts.
- Use `pnpm dist:mac` and its temporary build directory. Manual signing or packaging workarounds must also clean up their temporary application bundles and detach their mounted DMGs after verification. Preserve required artifacts as DMG/ZIP, plus validation records.
- Store all packaging output under `release/<package.json version>/`: DMG/ZIP at the version directory root; manifests, checksums, block maps, notarization reports and validation records in its `metadata/`; distinct test builds in `tests/<build-name>/`. Keep each version self-contained, including manual packaging. Upload scripts must read that version's files and manifest; do not restore flat output or shared `release/metadata/`. Keep historical archives within their version directory.
- If duplicate application entries remain, inspect native application resolution and unregister only the verified obsolete Minduck paths; preserve the installed app and avoid global LaunchServices resets.
- Keep these rules synchronized with `AGENTS.md`; see `docs/macos-distribution.md` for the installation procedure.

## Global Default Addendum

- This is Claude Code's project rules file; keep its behavior rules synchronized with the Codex-facing `AGENTS.md`, preserving existing constraints.
- Implement clear goals with the smallest scoped change. Fast-path work still follows context → change → fastest relevant validation → fix failures → summary; do not expand scope to complete the loop.
- Follow existing formatting, naming, types and error-handling conventions; avoid duplication and dead code. Do not add dependencies without user approval or an existing project requirement.
- Inspect and use the project's formatter, lint, typecheck and test scripts. Run relevant validation after changes and explain checks that cannot run. Use oxlint only when already configured.
- Synchronize development-mode, fast-path and quality-rule changes between both rule files.
- Default to ego-browser for ordinary webpage operations, with Simplified Chinese action titles. Use Playwright only for advanced testing needs and clean up this task's pages, contexts and processes without broad pkill.

## 通用开发规则

以当前需求、授权和项目现行规范为准。历史文档与记忆是参考，不自动形成新需求、永久限制或额外审批。

1. **先理解再实现。** 按“调研成熟实践 → 核实系统现状 → 形成整体方案 → 完整实施 → 验证交付”推进。调研深度与任务风险相称，优先官方资料与实际行为，可复用仍有效的结论，不要求每一步单独写文档或停工评审。

2. **依据真实系统判断。** 先读相关代码、配置、数据模型和调用链，确认需求、根因与影响范围。不仅凭截图、旧文档、用户建议或审查意见决定方案。

3. **从完整链路设计。** 明确模块职责，复用职责与变化原因一致的能力，避免因表面相似强行抽象。新能力须贯通真实入口、执行、数据与使用方。

4. **修根因并完成迁移。** 同类问题反复出现、修复不断增加特例时，重新检查需求与状态模型。需要重构就完整处理受影响单元、迁移调用方、清理旧实现和失效测试，覆盖必要的数据与兼容要求；不扩展无关清理。

5. **控制复杂度与范围。** 只为当前需求或已证实的问题增加机制，保留必要的权限、安全与数据完整性检查。审查发现不自动升级为新需求；不以最小差异限制必要修复，也不为假想需求过度设计。

6. **测试也要审查。** 预期依据当前需求和行为契约，断言可观察结果。修缺陷先写有效复现测试；失败时区分实现、预期、夹具和环境问题。不为全绿扭曲设计或放宽有效断言，及时更新失效测试。

7. **尽早做有判别力的验证。** 按风险选验证，尽早检查身份、生命周期、恢复与事务边界。确认目标行为确实执行、失败如实传递；数据库语义使用专用测试库。完成项目必需检查，复用有效结果，不默认增加固定验证套餐或验证设施。

8. **保护现有工作与环境。** 只提交本任务改动，保护他人未提交工作，不改写共享历史。环境操作先确认实际服务、版本和配置来源，保留数据与配置；部署按当前授权执行，不能以代码提交代替约定的环境更新。

9. **负责资源与信息安全。** 成功、失败或中断都清理本任务临时资源，先确认归属，不影响共享服务和未交付改动。不在输出、日志、文档或记忆中记录密钥、令牌、Cookie 等凭据。

10. **如实收尾。** 简要说明依据、取舍、修改范围与实际验证结果，区分已实现、已测试、已验收、已部署。关键路径未验证时不宣称接近完成；不以局部通过或子任务汇报代替整体完成，满足当前要求后及时交付。
