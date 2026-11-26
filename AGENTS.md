# Project Agent Rules

## Default Development Mode

- Implement clear requests directly and avoid specs or long plans unless requested.
- Before development, read `docs/wiki/index.md` and then only task-relevant pages.
- Code, tests, and current user instructions take precedence over wiki content.
- Fast-path requests use the smallest safe scoped change.
- Push verified changes to `main` and confirm the remote result. Keep `main` as the only remote branch by default. Before removing a temporary branch, verify its code is included in `main`. Follow explicit requests to keep a particular branch.

## Development Loop

- Understand the relevant code, make the focused change, run the fastest relevant validation, and correct failures.
- Update `docs/wiki/` when behavior, configuration, architecture, test commands, or important constraints change.
- Keep `CLAUDE.md` aligned with these rules.

## Wiki and Docs

- The wiki is supporting context, not a source of truth.
- Keep verified facts concise and update the Recent Updates entry when changing it.

## Error Tracking

- Record unexpected command and integration failures in `.learnings/ERRORS.md`.

## macOS Installation and Build Copies

- 测试包保留当前客户端版本号，产物放在 `release/<version>/tests/<build-name>/`。
- 正式包在打包前提高 `package.json` 的 `version`，新版本必须高于线上更新清单的当前版本。测试包保留版本号的约定只适用于测试包。
- 每次正式新版本由代理根据已核实改动主动更新 `CHANGELOG.md` 对应版本的简短说明，通常 2–5 条“新增／优化／修复”，不直接堆砌提交日志。先将“未发布”内容整理到 `## <version>` 再打包；隔离构建必须带上该文件。正式打包会把说明写入更新清单并按版本留档，供应用内更新弹窗展示。
- 每次打包客户端（包括正式包、测试包和同版本重打）前，都必须重新获取 Web 仓库远程 `dev` 分支当次最新代码，并重新构建 Web 后再打包客户端；不得直接复用旧的本地 Web 构建产物。
- 只有用户明确指定打包当前分支或 `main` / `master` 分支时，才改用用户指定的 Web 代码来源；该例外仅对当次指定的打包生效，后续仍默认重新获取远程 `dev`。
- 本次已授权的共享界面修改须一并保留。
- Keep the installed application at `/Applications/Minduck Matter.app`; replace that same path and name when an installation is authorized. Quit the installed app before replacing it and preserve its user-data directory.
- Do not create or retain rollback application backups, including `.app` copies or additional ZIP archives, unless the user explicitly requests them. After verifying the new installation artifact, replace the installed app directly; preserve its user data and normal release artifacts.
- Use `pnpm dist:mac` and its temporary build directory. Manual signing or packaging workarounds must also clean up their temporary application bundles and detach their mounted DMGs after verification. Preserve required artifacts as DMG/ZIP, plus validation records.
- Store all packaging output under `release/<package.json version>/`: DMG/ZIP at the version directory root; manifests, checksums, block maps, notarization reports and validation records in its `metadata/`; distinct test builds in `tests/<build-name>/`. Keep each version self-contained, including manual packaging. Upload scripts must read that version's files and manifest; do not restore flat output or shared `release/metadata/`. Keep historical archives within their version directory.
- If duplicate application entries remain, inspect native application resolution and unregister only the verified obsolete Minduck paths; preserve the installed app and avoid global LaunchServices resets.
- Keep these rules synchronized with `CLAUDE.md`; see `docs/macos-distribution.md` for the installation procedure.

## 全局默认补充规则

- 目标明确时直接进行最小范围修改；快速通道同样遵循理解上下文 → 修改 → 最快相关验证 → 修正失败 → 总结，不为闭环扩大范围。
- 保持格式、命名、类型、错误处理与项目现有风格一致，避免重复和死代码；未经用户同意或项目已有模式要求，不引入依赖。
- 先检查项目已有 formatter、lint、typecheck、test scripts，优先使用现有工具；修改后运行相关验证，无法运行时说明原因。仅在项目已配置时使用 oxlint。
- 修改开发流程、快速通道或质量规则时，同步维护面向 Codex 的 `AGENTS.md` 和面向 Claude Code 的 `CLAUDE.md`，保留原约束。
- 普通网页操作默认使用 ego-browser，用户可见操作标题使用简体中文；仅在需要其未提供的高级测试能力时使用 Playwright，并清理本次创建的页面、上下文和进程，不使用广泛 pkill。

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
