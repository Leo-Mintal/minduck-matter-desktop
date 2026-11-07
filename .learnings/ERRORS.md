# Unexpected Errors

## 2026-11-07 - Preview name broke the main Matter page

- The task-local launcher set `app.setName('Minduck Matter 浏览器开发预览')`. Electron included the non-Latin app name in its default User-Agent; the protocol request adapter then threw `TypeError: Cannot convert argument to a ByteString` (character value 27983) before the bundled frontend handler could serve the document, producing `ERR_UNEXPECTED` and the unavailable page.
- Process liveness and the browser settings controller's `等待登录` state did not prove that the Matter page had loaded. The previous startup report missed this distinction.
- Stopped only that faulty preview and started the actual project with `node_modules/.bin/electron .` from the repository. Corrected the inactive temporary launcher's name to ASCII to avoid repeating the issue. Kept the existing development profile, login data and service origin intact; no production-code change, rebuild or reinstall was needed.
- Verified the running standard-entry window through native accessibility: `Minduck Matter`, URL `http://127.0.0.1:8080/`, visible `欢迎登录` heading, email/password fields and login button. The bundled frontend's real Electron routes/assets/auth POST/upload/SSE/media/share smoke also passed; the new startup log has no ByteString or ERR_UNEXPECTED failure.

## 2026-11-07 - Native browser integration validation

- The development-preview restart stopped its exact parent, then a `ps` lookup raced a terminating child and returned exit 1. The new preview still started; rechecked with exit-tolerant process reads, confirmed exactly one running preview and its waiting-login settings state, and restricted its log to 0600.

- Native visible-window click/capture probes were inconsistent and capture reported `Current display surface not available for capture`. CUA subsequently confirmed the Mac was locked. Reused the project's offscreen native-rendering test pattern; real trusted events, resulting DOM state and screenshots then passed. Do not attribute this failure to the tool's click coordinates or claim visible-window inspection while locked.
- JS modal testing exposed blocked renderer identity evaluation and redundant `Page.enable` while the modal was open; per-tool debugger detach also rejected a pending dialog evaluation. Native runtime now observes dialogs, retains its own page session, uses only the paused fixed document's last verified unexpired identity for the dialog handler, and releases ownership on stop/cancel. Real `confirm()` accept and out-of-scope rejection pass. The initial unbounded prompt probe was replaced by a bounded confirm fixture; do not claim system prompt UI validation.
- A heartbeat timeout threw `DOMException: invalid code`: WHATWG WebSocket refuses application-sent close code 1001. Reconnect-only closes now use private code 4000, separate from terminal revocation codes.
- Cross-origin OOPIF keyboard targeting initially had no mapped frame. Native-only child-target attachment now enumerates the task page's iframe sessions; both same-origin and cross-origin frame targeting pass. The extension-facing CDP whitelist remains unchanged.
- A capture immediately after resizing an offscreen settings window returned `UnknownVizError` before the compositor produced the new surface. The preview fixture now retries the read-only capture with a bounded deadline; all four light/dark and 360/560px captures pass.

- The initial smoke selected the label's accessibility ref instead of the nested textbox. The fill tool correctly rejected that non-fillable element; the fixture now selects the textbox role explicitly.
- One combined patch used an incorrect errors-file heading and failed verification without writing. Read back both targets and applied the corrected patch.

## 2026-11-06 - Desktop update release notarization profile

- The `0.1.3` desktop-update release reached successful Developer ID signing, but electron-builder's `notarytool` submission stopped with `No Keychain password item found for profile: MinduckNotary`. The Developer ID Application identity remains valid; the macOS Keychain notarization profile must be restored with `xcrun notarytool store-credentials` using the controlled App Store Connect API key before retrying.
- The temporary staging directory was removed by the packaging script. No `0.1.3` DMG was created in `release/`, no static-download file or `latest.json` was uploaded, and the public release remains `0.1.2`. Do not publish an unsigned or unnotarized replacement.
- Resolution and follow-up: the Keychain profile was restored; a later `0.1.3` build obtained accepted app and DMG notarizations plus a valid stapled DMG. Its automatic static publish stopped because this environment has no usable SSH credential for `root@124.70.149.30`; public `latest.json` therefore remains `0.1.2`. The release orchestrator now opens its SSH ControlMaster before the lengthy build, so password/key access fails early and one password authentication is reused for both upload and manifest switch.

## 2026-11-06 - Desktop default-language source discovery

- Read-only discovery initially referenced absent sibling `src/desktop/`, `scripts/smoke-bundled-frontend.cjs`, and `src/preload.cjs` paths. Used the verified inventory (`scripts/bundled-frontend-smoke.cjs` and the actual per-surface preloads) before changing code. No files were written by those failed reads.
- Missing `CFBundleDevelopmentRegion` and `CFBundleLocalizations` in the installed Info.plist were expected inspection results, not a packaging failure. A real Electron probe confirmed `--lang=zh-CN` changes `app.getLocale()` and `navigator.language`/`languages`; role-generated native menu labels remained English in that probe, so do not claim that the switch translates macOS menus.

## 2026-11-06 - Full-bleed macOS icon verification

- The installed `actool` rejects `--help`; the existing verified compilation command remains valid and generated AppIcon.icns plus Assets.car successfully.
- Icon Composer's compiled legacy ICNS contains sizes through 256px, while the full-resolution modern artwork lives in Assets.car. A preview probe incorrectly assumed the compiled ICNS had a 1024px PNG and failed before creating its comparison image. Inspected the extracted inventory and used its actual 256px rendition; all ten source PNGs separately verify as fully opaque, and their central artwork is unchanged.
- CUA bundle-ID lookup was ambiguous because an existing mounted installer shares the app identifier. Selected the exact installed application path instead; did not detach the user's volume or alter its app.
- The Chinese preview label probe assumed a legacy system-font path. Located the installed PingFang font in the current MobileAsset font directory and rendered the comparison successfully; no project font or dependency was added.
- Icon-update notarization submission `c17125b4-16d7-40ad-aae6-c8c28f8acfd5` was created successfully and initially queryable as In Progress. Later info requests returned "No Keychain password item found for profile: MinduckNotary", both with the default keychain and explicit login.keychain-db. The default/search-list keychains are unchanged and login reports no-timeout; do not infer why the profile cannot be read. The original wait process remains alive, the staged app is signed, and the installed app has not been touched. Requested local profile restoration without requesting any secret content.
- Resolution: the original wait completed Accepted and the public notarization ticket became available; stapled and validated the staged application without needing profile restoration for this operation. Installed only the three icon resources plus required signature/ticket updates, preserving 4,814 other bundle entries, original signing requirements, entitlements and Info.plist. The same pre-existing fullscreen startup blank recovered after native fullscreen toggling. The restarted client now shows its login page; did not enter credentials or infer the cause of the session change. Dock's CUA lookup timed out; read-only NSWorkspace rendering of the installed application's actual system icon confirmed the corrected full-bleed shape. Do not describe that rendered verification as a captured Dock screenshot.
- Read-only process probes must redact companion URL fragments and avoid dumping full child arguments; those URLs can contain short-lived local authentication keys. Subsequent checks should return only the main PID/executable and public file hashes.

## 2026-11-05 - Desktop-pet direct custom answer

- First panel regression caught the shared edit SVG missing from the new custom input: esbuild's SVG data URL contains literal quotes, so interpolating it inside another quoted CSS URL produced an invalid mask. Escape the URL with JSON string syntax, then retain the actual computed-mask and real-focus assertions. No shared Web source change was needed.
- A combined patch included an incorrect placeholder heading for this log and failed validation before any writes. Read back the production/test targets and applied the verified scoped patch.

## 2026-11-05 - Compact desktop-pet settings

- Concurrent desktop interaction made some CUA indices stale; reacquired the live app/state before menu actions. After successful installed menu/page inspection the app was closed externally, so a later read-only loopback check returned ECONNREFUSED. Verified the saved Claude theme and exact installed resource bytes without reopening or changing user preferences.
- Another task installed and restarted the app between staging and replacement. The app-running/drift guards stopped without writing. Restaged from the new installed app to retain its independent panel changes.
- This workspace has no Git metadata. Used task-local original files and narrow replacement guards; bounded inventory resolved absent guessed runtime/source paths. A documentation patch with an incorrect error-log anchor failed before any write; re-read targets and applied exact patches.
- The first settings probe matched the upstream palette label case-sensitively (`claude` vs `Claude`). Corrected the assertion without changing the palette, then the real Core, settings, dress frame, four-width/light-dark, route and restart checks passed.
- Initial runtime integrity check found the concurrently edited, unrelated `minduck-panels.css` digest differed from the existing notice. Preserved that CSS and its other task's notice ownership; after that task synchronized its digest, the complete integrity check passed. This settings task documents only its three runtime edits.

## 2026-11-05 - Desktop-pet notification controls

- Initial runtime discovery guessed a nonexistent `runtime/plugins/desktop-pet` directory; verified the integrated page is under `runtime/node_modules/cortico-world-desktop-pet/web` before edits.
- The offscreen panel probe logged SVG filter bounds `inf/-inf` during the original default figure's initial layout and a Chromium sandbox diagnostic. Its complete interaction/appearance assertions and script-error checks passed; no figure artwork was changed.
- A staged-install allow-list assumed an old executable name and correctly stopped before replacing the installed app. Read `CFBundleExecutable` from the current bundle for signing-change checks instead. A subsequent combined patch failed on an incorrect error-log anchor and wrote nothing; re-read the targets and applied exact patches.

## 2026-11-04 - Single capsule and default duck follow-up

- Source discovery tried nonexistent `src/companion/config.cjs` and `src/figures.ts` paths. Verified first-run defaults are in the vendored `core/seed.ts` and figure scanning is in `src/packs.ts`; changed only the verified defaults and bundled ordinary duck.
- The default duck's supplied SVG already contains non-finite `inf`/`-inf` filter bounds. Chromium reports these inherited SVG warnings during the panel probe; source artwork was not altered for this unrelated request. The real panel, work/ask, recovery and full smoke assertions passed. macOS also emitted its existing task-policy diagnostic while test windows were destroyed.
- The installed app had a valid Developer ID signature. Prepared a clone of that exact installed bundle, changed only companion resources, and re-signed the staged outer app with the same identity and preserved metadata. This avoids signing a running executable in place. Verify unchanged resources and retain the previous app before installing; never rebuild the shared browser/frontend for this pet-only change.

## 2026-11-04 - Browser UI installation recovery

- Directly resolving `@electron/asar` from the project root failed because pnpm keeps this transitive build dependency under `.pnpm`; discover its installed package directory before loading it. No application files were changed by this read-only lookup failure.
- AppleScript quit returned success but left the verified main PID alive. Sent SIGTERM only to that exact old main process, waited for all application-owned processes to exit, then performed the staged replacement with the previous application retained as a backup.
- A combined documentation/error-log patch was rejected because its log context used an unverified heading. Re-read both targets, confirmed neither was written, and used their actual headings for the follow-up patch.

## 2026-11-04 - Simplified browser UI validation

- The offscreen shortcut probe initially used CDP renderer key dispatch and timed out waiting for the main-process native shortcut route. It now exercises the registered Electron `before-input-event` route and checks the resulting tab lifecycle and cross-process address-focus effect; the toolbar Enter/Escape tests continue using real renderer key dispatch.

- Source lookup initially assumed `components/ui/` and a standalone Brave app; the verified shared primitives are under `components/core/`, and no Brave installation is required. Subsequent reads used the actual inventory.
- The first native new-tab capture returned `UnknownVizError` before the offscreen compositor had produced a frame. The probe now awaits layout frames and finite CSS transitions before capturing.
- Visual inspection caught the shared Select's default full width squeezing setting labels, although the first control-only overflow checks passed. Scoped the settings selects to intrinsic control width and added a minimum readable label-width assertion at all four test viewports.
- Light-mode settings needed an explicit CSS body background instead of inheriting a dark native backing. The probe now checks heading/background contrast as well as screenshots. No shared theme tokens were changed.
- Closing a still-loading tab can reject `loadURL` with `ERR_FAILED`; the host now ignores late load failures for already-removed/destroyed tabs instead of publishing a stale error.

## 2026-11-04 - Default duck SVG replacement probe

- Read-only lookups initially used nonexistent CLI `src/` and `coopanion_svg/` directories, a repository-relative wiki path from the CLI directory, and a CLI-relative parser path from the desktop directory. Used the verified root-level CLI files and correct working directories instead. The pet server also rejects HTTP HEAD with 405; use GET for its resource/header inspection.
- The disposable staging proxy initially omitted the incoming `Origin: null` header. The official opaque sandbox consequently could not load CORS-enabled modules and the harness timed out. Forwarding Origin preserved the server's actual CORS response; only the temporary verification proxy changed. Its process was terminated by exact PID, with no production runtime change.
- A raw-source reference comparison sampled the final partial typing loop, where the established retimer deliberately blends back to neutral for stow, and correctly found an opacity difference. Reference-pose sampling now excludes that intentional blend interval; the full flow, transition and recovery probes still execute it. Staged and installed sandbox runs both passed, including 15,236 sampled opacity/transform comparisons per run.

## 2026-11-04 - Source lookup shell glob

- A read-only source lookup included the unmatched `src/*.test.cjs` zsh glob and reported `no matches found`. No files were changed; use known `scripts/*.test.cjs` paths or `find` for test discovery.

## 2026-11-04 - Default-origin combined patch context

- The first multi-file default-origin patch did not match the concurrently updated wiki Recent Updates context and was rejected before writing any file. Re-read the affected files and applied scoped changes without overwriting unrelated updates.

## 2026-11-04 - Brave integration source inventory

- The read-only Git status check failed because this desktop project directory has no Git repository metadata. No Git state was changed.
- Initial source lookups used a nonexistent `tests/` directory, `minduck-matter-chromium/src`, the currently absent sibling Web `src/desktop/`, and an unmatched zsh filename glob. Re-ran bounded lookups against the verified file inventory. The desktop shell is currently present as generated `web-dist/desktop-shell/` output; the default sibling Web package also has no `build:desktop-shell` script. No browser implementation or generated bundle was changed during the feasibility review.

## 2026-11-04 - Developer ID identity qualifier

- The first notarized release attempt passed the full `Developer ID Application: ...` identity to electron-builder 26's `mac.identity` setting. This version rejects that prefix because it detects the certificate type automatically. The package script now keeps the complete identity for Keychain validation, but passes only its organization/team qualifier to electron-builder before retrying. No release artifact replaced the existing DMG.

## 2026-11-04 - Notarization Keychain profile unavailable

- The Developer ID-signed app and DMG completed local signature validation, but `xcrun notarytool submit --keychain-profile MinduckNotary` returned "No Keychain password item found for profile." A direct `notarytool history` retry produced the same result, while the Developer ID identity remains available. Restore the named profile with `notarytool store-credentials` before rerunning the release command; do not weaken the release script to read a `.p8` file or place credentials in the project.

## 2026-11-04 - Rollback patch context mismatch

- A combined rollback `apply_patch` did not match the current Coopanion runtime manifest reason text and was rejected before writing any file. Subsequent rollback patches must be scoped by file after reading the exact manifest content.

## 2026-11-04 - Companion rollback probe assertion

- The first restored panel probe incorrectly expected a long one-line value to stay in its first display row. The original `panelLines` behavior splits a single input across the two ten-grapheme rows, so the assertion was corrected to the real legacy result before rerunning the isolated probe.
- The rerun completed all eight width/appearance text checks but its final pre-existing right-click assertion failed: the probe dispatches a `contextmenu` event at the figure hit point, and the restored upstream page opens its native menu there. The restored panel runtime matches the installed rollback app; no production interaction was changed merely to satisfy this unrelated probe assertion.

## 2026-11-04 - Installed ASAR inspection command

- The project has `@electron/asar` only in pnpm's internal store, not at `node_modules/.bin/asar`; the first installed-archive listing therefore produced no file list. Use `node_modules/.pnpm/node_modules/.bin/asar` or the resolved `@electron/asar` CLI when inspecting a packaged archive. The installed Coopanion panel hashes already matched the verified source payload.

## 2026-11-04 - Shared-token lookup pattern

- A read-only token inventory used an unsupported look-ahead expression with `rg`, which returned a regex parse error. Re-ran the lookup without look-around and used only confirmed shared CSS variables for the desktop opener tooltip; no product behavior was affected.

## 2026-11-04 - Desktop opener temporary assertion

- A one-off local verification looked for the literal `data-sidebar-tooltip` in the injected script, while the implementation correctly assigns `dataset.sidebarTooltip`. The source and the runtime smoke check use the DOM value; the follow-up contract assertion checks the actual assignment form.

## 2026-11-04 - Companion runtime manifest refresh

- `pnpm run check:companion` correctly rejected the changed Minduck panel files because their recorded integrated SHA-256 values no longer matched. Updated only the two affected entries in `vendor/coopanion/UPSTREAM.json`, including the verified display-behavior rationale, then reran the gate before release validation.

## 2026-11-04 - Desktop pet hover area

- Read-only source lookups used obsolete `pages/LiveConversation.tsx` and `dress-app.js` paths. Located the actual `screens/LiveConversation.tsx`, state layer and `web/dress.js` from the file inventory before continuing; no Web source was changed.
- The former panel test covered only the center of the final gap and did not assert native input ownership. Added diagonal body-corner-to-button paths, native cursor callbacks and real mouse clicks; the new test reproduced the disappearing controls before the fix. The renderer and native polling now share one full body/button hover area instead of the old narrow, disconnected strip.
- Resolved: the expanded probe passed with both the unchanged Suit Duck and a read-only copy of the user's Police Duck in disposable profiles, including real clicks after diagonal movement and native cursor reports. All 64 unit tests, syntax/integrity checks and the focused quality scan passed. Installed runtime files were verified against the new package and live server; the user's selected Police Duck remains unchanged.

## 2026-11-04 - Matter pet action integration probe

- A read-only route lookup used a missing shell glob and a nonexistent router file. Recovered by reading the verified Web `src/App.tsx` route and navigation code; no Web source was changed.
- The first native action probe compared the public pet URL with the full DevTools target URL and failed to select a target. Upstream `world.ts` exposes `/pet`, while `server.ts` adds a private authentication fragment only for the native host. Match the same page without its fragment; never print the private URL.
- A combined patch included an invalid log-file hunk and was rejected before any write. Re-read the targeted files and applied the corrected patch.
- Resolved: the real native pet/preload/desktop path passed hidden-window activation, minimized-window restoration, foreground focus, current-page retention and new-chat navigation. The updated panel probe, 64 unit tests, syntax checks, integrity checks and focused quality scan also passed.

## 2026-11-04 - Matter service settings offscreen focus assertion

**Status**: resolved

- The first Electron visual smoke expected a hidden offscreen `BrowserWindow` to move focus into the service-address input. Chromium does not grant focus to hidden offscreen windows, so the assertion failed before measuring the shared control geometry. Removed only that environment-invalid focus assertion; the smoke continues to verify rendered shared stylesheet, dark/light themes, 36px input height, pill radii and nonblank output.

## 2026-11-04 - macOS package desktop-shell build

**Status**: resolved

- `pnpm dist:mac` completed the sibling Matter Web production build, then failed because `scripts/build-web.cjs` invokes `pnpm build:desktop-shell` but `/Applications/File/WorkSpace/jomec/Minduck/minduck-matter-web-prod/package.json` currently defines no such script. The desktop package was then built successfully with the supported `MINDUCK_WEB_DIST` override pointing to the existing verified `web-dist/` bundle, which includes the required desktop shell. This is unrelated to the native title-bar layout change.

## 2026-11-04 - Installed app replacement process check

**Status**: resolved

- The first replacement attempt used `pgrep -f` with the full app path. That expression also appeared in the installer shell command, so the safety check saw its own parent shell and cancelled before moving, deleting, or installing anything. Use exact process-name matching for the Electron executable on retry.

## 2026-11-04 - Installed ASAR verification

**Status**: resolved

- The first post-install check treated the `asar extract-file` command's output as file contents. The command did not provide the expected content, so it reported the new safe-area marker missing even though the app process launched. The subsequent ASAR file-list and library extraction check confirmed both installed layout modules contain `matterContentBounds` and `MATTER_TOP_INSET`.

## 2026-11-03 - Compact browser tab close control

**Status**: resolved

- The first compact-close CSS assumed --sp-0-5 was 2px and --size-icon-md was 16px. The native regression measured 3px padding and rejected it. Read the actual geometry and Icon primitive: --sp-0 is 2px, --size-icon-xs is the 16px glyph, and md is 20px. Use those existing tokens without changing shared geometry or weakening the requested 2px assertion.

## 2026-11-03 - Restore project browser styling

- The rollback patch generator emitted numbered unified-diff hunk headers, which apply_patch interpreted as context. The tool rejected the first hunk without writes. Verified the affected markers were unchanged, converted only hunk headers to the supported bare @@ form, and applied the inverse scoped edits. All six source files match the pre-Ego baseline byte for byte.
- Whole-Web typechecking stopped at LiveConversation.tsx:2593 because onOpenMember is undefined. This file is outside the rollback scope and was left unchanged. Restore packaging uses the verified pre-Ego installed app's business Web artifact plus the freshly rebuilt shared desktop entry, supported by the existing MINDUCK_WEB_DIST option.
- A dependent staging command initially consumed the old generated desktop entry after the earlier typecheck failed. The native regression correctly detected the old appearance and 32px height. Rebuilt the desktop entry before restaging; the three-window-size, navigation, public-field focus and live-resize regressions pass.
- The first isolated desktop typecheck omitted src/vite-env.d.ts, producing missing SVG/CSS declaration errors. Added the existing ambient declaration file to the temporary validation config; no source declarations or dependencies were changed.

## 2026-11-03 - Ego-style address input

**Status**: resolved

- The first native reference screenshot lookup matched a window title rather than the application name and returned no match. Used the returned Ego Lite window ID and captured its idle/focused address bar; no reference application files were modified.
- The address smoke initially dispatched Enter without its carriage-return text, so Chromium did not perform the default form submission. Added the same text payload a real Enter produces, asserted the typed value first, and verified actual navigation plus Escape restoration. No production navigation change was required.
- A combined documentation patch assumed the error log was headed Errors; verification rejected it before any writes. Read the actual heading and applied the scoped updates.
- A temporary-file discovery command used an unmatched zsh glob; replaced it with bounded pathlib globbing. A nested JavaScript template literal also rejected a read-only QA probe before tool execution; the saved probe now serializes functions without nested templates.
- The installed QA first compared an encoded location.pathname with a space-containing path; decode the pathname before matching. Its next focus assertion ran against an inactive native window, so CSS :focus stayed inactive despite the DOM activeElement. Activating the exact installed app and bringing its toolbar WebContents to the front produced the expected document focus and pale-green border. No production changes were needed.

## [ERR-20261102-001] Bundled frontend integration

**Logged**: 2026-11-02
**Priority**: low
**Status**: resolved
**Area**: infra

- `corepack pnpm run build` failed with `corepack: command not found`; the current environment has a working `pnpm`. Retried the existing Web build with pnpm successfully; README commands use pnpm, and scripts prefer it with Corepack only as fallback.
- The first bundle-path unit assertion compared macOS `/var/...` with `realpath`'s `/private/var/...`. Canonicalized the fixture root; all 45 tests passed on rerun.
- The first Electron smoke removed its profile before Chromium flushed its disk cache. Moved cleanup to a Node parent after Electron exits; the smoke passed without the cache warning on rerun.
- A multi-file documentation/error-page patch used a nonexistent error-log anchor and failed validation without changing files. Read back the targets and reapplied with the actual heading.

Related files: `scripts/build-web.cjs`, `scripts/bundled-frontend.test.cjs`, `scripts/bundled-frontend-smoke.cjs`, `README.md`.

- 2026-09-29: `https://developer.apple.com/help/account/membership/duns-number/` returned 404 during an Apple Developer enrollment help lookup. The current official page is `https://developer.apple.com/support/D-U-N-S/`.
- 2026-09-29: The workspace root is not a Git repository, so Git-based diff validation is unavailable. Reconfirmed on 2026-11-04 during the read-only Coopanion integration inspection: `git status --short` returned `fatal: not a git repository`; continued with direct source and package-config inspection.
- 2026-09-29: The first multi-hunk patch for the Electron flicker fix did not apply because the `layoutViews` context had changed; the same change was split into smaller patches.
- 2026-09-29: A development Electron smoke run could not attach its bundled extension because macOS rejected the local Electron helper resource with `sandbox_extension_issue_file`; the process was stopped after repeated DevTools connection-closed messages.
- 2026-09-29: Initial Matter-origin patches failed once from JavaScript string escaping and once from an outdated patch context; splitting the edits into verified hunks resolved both failures.
- 2026-09-29: Settings and documentation patches twice embedded Markdown or JavaScript template literals inside the patch transport and caused syntax errors; smaller patches with explicit escaping applied cleanly.
- 2026-09-29: The first packaged-ASAR verification used the nonexistent top-level path `node_modules/@electron/asar/bin/asar.js`; pnpm installed the CLI under `node_modules/.pnpm/@electron+asar@3.4.1/node_modules/@electron/asar/bin/asar.js`.
- 2026-09-29: A DMG verification script was rejected because its cleanup trap used `rm -rf`; rerunning with read-only mounting and detach-only cleanup completed the verification.
- 2026-09-29: A source/test search used an unmatched `src/*.test.*` zsh glob, so zsh returned `no matches found`; subsequent test discovery used `find` with explicit filename predicates.
- 2026-09-29: One read-only test inspection call used a serialized command object where raw JavaScript was required by the client transport and failed with `Unexpected token ':'`; the call was retried with the correct `exec_command` wrapper.

## 2026-09-29 - Bash tool patch transport syntax error

- Command/integration: functions.exec apply_patch wrapper
- Failure: JavaScript template parsing stopped at unescaped Go raw-string and struct-tag backticks.
- Resolution: retry with an escaped normal JavaScript template literal; no project files were changed by the failed attempt.

## 2026-09-29 - Combined Bash tests/docs patch transport syntax error

- Command/integration: functions.exec apply_patch wrapper
- Failure: Markdown backticks in README/wiki content terminated the JavaScript patch template before apply_patch ran.
- Resolution: stop retrying the combined transport; split code patches from documentation edits and generate Markdown backticks inside Python.

## 2026-09-29 - Documentation edit Python newline escaping error

- Command/integration: Python here-document launched through functions.exec
- Failure: JavaScript converted Python string escape sequences into physical newlines, causing an unterminated Python string before any docs changed.
- Resolution: rerun the same deterministic replacements with String.raw so Python receives literal escape sequences.
- 2026-09-29: A final Bash cleanup patch again failed before applying because Go struct-tag backticks terminated the JavaScript template; the retry used a Python file edit without embedded backticks.
- 2026-09-30: The first layout documentation patch was rejected by JavaScript template parsing because Markdown backticks were embedded in the patch string; the retry used an array of plain strings and applied without touching code.
- 2026-09-30: An unpackaged Electron smoke run reported `sandbox_extension_issue_file` for the local Electron helper and a gateway exit because the installed app already owned `127.0.0.1:7331`; rerunning with `MINDUCK_AGENT_GATEWAY_EXTERNAL=1` verified the new browser host started without bridge errors.
- 2026-10-04: A temporary WebVM source inspection command was rejected because its cleanup used a recursive `rm` command; no project files were changed. Use non-destructive temporary inspection commands instead.
- 2026-10-15: A development Electron smoke run loaded the desktop pet but the bundled Local Agent Gateway exited with status 1; the existing app/runtime likely already owned its loopback service. The desktop pet target remained available through Electron DevTools, so validation continued without changing Gateway behavior.
- 2026-10-15: The first Electron DevTools screenshot probe used `require` together with top-level `await`, which Node rejected as ambiguous module syntax before any project file was touched. The probe was retried with explicit ESM imports.
- 2026-10-15: A first automated `src/pet.html` rewrite assumed an inline `class="duck-art"` marker and stopped before writing the file; the follow-up inspection found the complete SVG, then a smaller edit restored the marker and verified the source paths and filters.
- 2026-10-15: The native CUA right-click probe reported that the Electron application binary changed and required a fresh app query; the renderer had already been visually validated, so no source change was needed.
- 2026-10-15: A direct development Electron launch emitted `sandbox_extension_issue_file` for the local Electron Helper resources; the packaged DMG build and source-level tests still completed successfully, so the warning was isolated to the development runtime.
## 2026-10-15

- `brew install --cask blender` 无法完成：本机 Homebrew cask API 在解析 Blender 依赖时触发 `undefined method 'to_sym' for nil`；改用 Blender 官方 Apple Silicon DMG 安装。
- Blender 4.5 的 3D 桌宠脚本首次生成时拒绝旧的 `AgX - Medium High Contrast` 色彩预设名称，已改为当前版本的 `Medium High Contrast`。

## 2026-11-02 - Coopanion inspection

- An inferred `/Applications/Coopanion-inspect` extraction path did not exist; used the verified installed `Coopanion.app/Contents/Resources/app` source tree instead.
- Whole-tree REA analysis included bundled dependencies and did not finish within the useful inspection window; cancelled it and inspected the specific CoreHost, pet host, configuration and settings modules directly. No installed application files were modified.
- Focused inspection initially assumed nonexistent upstream `window.ts` and `panel.ts` files, and an unmatched zsh glob stopped a read. Follow-up inspection located `window-host.ts` and panel dispatch in `world.ts`; no code changes depended on the failed reads.

## 2026-11-02 - Embedded runtime package validation

- Mounted-DMG verification found electron-builder omitted the runtime root `node_modules` in extraResources despite an inclusive filter. Its FileMatcher explicitly skips root node_modules. Added a separate node_modules-to-node_modules resource mapping and an afterPack assertion for Core/tsx/native dependencies, figure and license; rebuilt and retested the artifact.
- Native CUA combined shortcut/screenshot observation timed out once and reset its session. Rebound the app and used the visible application menu; confirmed the integrated settings window.
- Final packaged-app UI validation succeeded. The user began interacting with the verification instance; left that application and its mounted DMG open rather than interrupting the active window. The development client also remains running.

## 2026-11-02 - Desktop login investigation

- Initial read-only searches used unmatched zsh globs for API/auth paths; followed up with existing file paths and rg searches. A listener inspection also used an invalid duplicate lsof TCP-state option; corrected the command. These probes did not change application state or credentials.

## 2026-11-02 - Suit Duck drag pose

- An initial source search assumed a worlds/desktop-pet directory; the pinned desktop-pet package is under runtime/node_modules/cortico-world-desktop-pet. Used that verified path for the API 2 body and sandbox validation.
- The quality checker accepted a single-file argument but scanned zero files; reran it on the figure directory and verified four modules with no errors or warnings. The real Electron smoke passed despite the previously documented local Helper sandbox-resource warning.
- An AppleScript quit request returned success while the old packaged process remained running. The native application quit shortcut closed it; reopened the rebuilt app from a distinct read-only DMG mount and preserved its existing userData.

## 2026-11-02 - Shared thinking animation

- The disposable visual-preview server initially routed built-in figures through the imported-pack URL prefix and shifted URL segments inside an Array.find predicate, producing 404s. Corrected the preview routing to use the official built-in bases and consume each segment once. A follow-up preview probe now guards missing elements after a load failure. The real six-figure official-sandbox smoke had already passed; production serving was unaffected.

## 2026-11-02 - Click thinking inspection

- An initial focused search assumed flat kit.js/body.js/pet.js runtime files. The pinned runtime uses kit/body.js and pet-app.js; located the actual paths and inspected their pointer thresholds before editing. No writes depended on the failed read.
- The first real smoke failed its pre-existing combined cancel/walk/recovery assertion before the figure compatibility checks. Added diagnostic assertion output; the rerun passed all six figures. The probe now turns off free roaming for its scripted movement checks, matching the existing per-figure fixture, so unrelated random idle decisions do not move the subject between actions.

## 2026-11-02 - Actual pet click animation regression

- The previous sandbox fixture omitted pet-app.js default thoughtShown:true. The shared effect incorrectly treated that status-bubble preference as an active thought and permanently blocked both idle and click animation in the real pet. Removed only that preference from activity gating, added a default-state regression and a complete pet-page mouse/visible-SVG/completion check. The original poke bounce/jump is now replaced by a direct click effect, retaining drag capture and physics.
- The expanded walking-click fixture found that upstream stopWalk requires an exact walk id, so calling it without an id leaves walking active. The quiet release now transitions walking to idle inside the kit, preserving its interrupted notification. The complete-page probe initially sent native mouse input to a hidden BrowserWindow, which Electron ignored. A visible-window retry was vulnerable to focus/closure and a rendered-press poll could exceed the 400 ms threshold. The final probe uses offscreen rendering and trusted Chromium input at a fixed 60 ms press interval, verifies actual visible SVG animation and its completion, and destroys its disposable window. It passes without changing the user's focus.
- The full-page input review also found that the first pointer move from the kit's off-stage sentinel counted as a >320px petting stroke, causing a false purr/expression bounce. Stroke accumulation now requires consecutive points already on the body; the real click test rejects both poke and false-purr reactions.

## 2026-11-03 - Remove standalone browser chat

- The disposable full-main smoke launched from a temporary script, so Electron initially resolved app.getAppPath() to the temporary directory and could not find the generated frontend. Corrected the harness with app.setAppPath(projectRoot) before loading the real entry point. Production startup/package paths were unchanged.
- AppleScript quit stopped the old pet host but left the old main process running; sent SIGTERM only to the verified installed main PID before replacement. The disposable native-window capture returned an empty image, so it was not treated as visual evidence; native bounds and real navigation/tab assertions passed.
- An initial error-log update script had an unterminated Python string; the interpreter rejected it before any process or file changes. Corrected the quoting and reran the targeted step.

## 2026-11-03 - Browser panel close button

- The installed-app probe initially waited a fixed 300 ms after the click and read the prior panel state while Electron startup/IPC was still settling. A subsequent read showed the expected open state. Replaced fixed delays with bounded polling of the actual shell state; close/reopen and preservation of the exact active tab and tab IDs passed.

## 2026-11-03 - Shared Web chrome and live native resize

- Read probes assumed missing filenames/globs (reload icon, rightPanelLayout.test.cjs, button.css); recovered using rg and verified paths. An independent read used the sibling Web cwd for desktop-only files; no edits relied on these failures. A broad temp-directory listing hit macOS TemporaryItems restrictions; subsequent probes use known paths.
- The patch tool rejected a delete/add pair targeting the same existing file before any writes. Verified unchanged files and applied a normal scoped update.
- Trusted native drag instrumentation showed that expanding WebContentsView can emit lostpointercapture; the shared divider now lets native hosts own capture with a stable full-window overlay, retaining DOM capture on Web. One visible-window test received unrelated physical pointer moves during the assertion; offscreen native test surfaces isolate trusted input from user interaction. Electron exports cannot be redefined; the test injects a scoped inherited module facade, restores Module._load immediately and cleans up only its own process.
- Offscreen WebContentsView uses its parent viewport for CDP coordinates despite narrow native bounds. The harness now uses parent-space pointer coordinates, validates real native bounds before release, and emulates the toolbar viewport explicitly for fitting/radius checks. Theme screenshots wait for CSS transitions to complete before inspecting contrast. All three native window sizes, shared control shapes and cancel/blur paths pass.

## 2026-11-03 - Full-bleed icon verification

- A post-install pixel-inspection one-liner had a mismatched closing bracket, so Python rejected it before reading or changing any project or application file. Corrected the read-only assertion and reran it before evaluating the Dock preview.
- A temporary Icon Composer probe combined setup with a recursive cleanup command and was rejected before execution. The follow-up uses a checked, unique temporary directory and leaves it available for inspection.

## 2026-11-03 - Rounded Dock icon generation

- The initial Swift renderer used an unavailable `NSBitmapImageRep(contentsOf:)` initializer and newer AppKit enum shorthand. Its follow-up could decode the image but could not allocate an `NSBitmapImageRep` canvas in the command-line process, so `pnpm run icon` stopped before changing generated assets. Replaced the AppKit path with the built-in CoreGraphics/ImageIO pixel APIs, then reran the icon build and alpha-corner check.
- A combined delete/add patch and a stale hunk were rejected by the patch tool before changing source. Read the current generated script and applied the CoreGraphics migration as smaller scoped updates.
- The post-install `screencapture` probe returned an all-black 3024x1964 image twice, including after app activation, so it cannot verify the live Dock appearance in the current macOS session. Verified the installed runtime PNG's transparent corner and opaque top center instead; no application behavior was changed to work around the system capture restriction.

## 2026-11-03 - Dock icon ownership

- The full-bleed crop, added corner mask and `app.dock.setIcon` workaround incorrectly treated the application asset as the Dock presentation layer. The requested behavior is direct use of the supplied icon while macOS owns the icon slot and hover magnification. Removed all three layers; the compiled Icon Composer asset is now the sole packaged icon source.
- An initial combined rollback patch used stale `package.json` context and was rejected before writes. Re-read the current configuration and applied the rollback as scoped patches.

## 2026-11-03 - Browser panel motion validation

- The quality checker accepts only one path argument; passing three selected `.cjs` paths caused it to inspect only the final file and incorrectly report zero files. Re-ran it against `src/`; it passed but does not recognize the project’s `.cjs` main-process files, so Node syntax checks, unit tests and the real Electron browser smoke remain the relevant validation for the motion state machine.

## 2026-11-03 - Google default-tab smoke network access

- The Electron browser smoke correctly created the initial and user-created tabs with `https://www.google.com/`, but the disposable test runtime reported `ERR_FAILED (-2)` while attempting to load Google. The URL/state assertions and the remainder of the native smoke passed, so this is a test-environment network-access limitation rather than a default-tab routing regression.

## 2026-11-03 - Post-install process probe

- A combined read-only process probe had malformed shell escaping and the command wrapper rejected it before executing anything. Retried the launch verification with small, independent read-only commands.

## 2026-11-03 - Old application cleanup verification

- Finder moved the 19 exact `/Applications/Minduck Matter.app.previous*` bundles to the user's Trash, but the terminal lacked permission to enumerate `~/.Trash` for a post-move count. `/Applications` now contains only `Minduck Matter.app`, Spotlight returns no `.previous*` names, and the installed app remains running.

## 2026-11-03 - Chromium source research navigation

- The read-only Ego browser lookup of Chromium's Gitiles source timed out waiting for full load after navigation had already committed. Continue the same browser task from its committed page using a bounded readiness check rather than treating the lookup as a source or network failure.

## 2026-11-03 - Open-source browser research metadata

- GitHub's anonymous repository API returned HTTP 403 for the public browser repositories in this environment. The research uses their public repository pages and license files instead; no credentials or repository state were accessed.
- One browser-project landing page exposed a committed empty document during the bounded Ego lookup, so its `document.body.innerText` read threw before completing the batch. Retried the same task with a null-safe page extraction and retained only directly verifiable project facts.

## 2026-11-04 - Desktop pet panel inspection

- A read-only route lookup included a missing sibling `src/desktop` path; recovered by reading the existing Web `src/App.tsx`, which confirms `/new-chat`. No Web source was changed.
- The quality checker excludes files inside `node_modules`, returning zero scanned files even for a direct path. Re-ran it on an exact temporary copy of the new panel module; it scanned the file and passed with no errors or warnings. Node syntax checks and the real Electron smoke remain the runtime validation.
- The first expanded Electron smoke reached its 100-second deadline after the existing animation regressions passed, before the new panel probe completed. Added a panel-only harness path and phase diagnostics to isolate the pending operation. A read-only screenshot listing also used an unmatched zsh glob; use bounded pathlib enumeration for generated captures.
- Root cause of the probe stall: a brand-new offscreen BrowserWindow has no ready renderer target for Page commands. Load `about:blank`, attach CDP, enable Page, install the desktop preload fixture, then navigate to the real page. Without Page.enable the fixture was missing and its state lookup threw. Subsequent layout checks now await the original body's idle state instead of measuring its entry drop; the panels also hide during airborne/landing modes. Chromium transform bounds can differ from CSS sizes by ~0.00003px, so geometry assertions use a 0.01px tolerance. The focused probe then passed all eight viewport/appearance combinations and generated both captures.
- Final verification passed: 59 unit tests, runtime/patch-hash checks, the isolated module quality scan, and the full real Electron smoke including pointer/click-through regions, pending buttons, original animations and settings hide/reopen. All eight figure files match the installed original byte-for-byte.

## 2026-11-04 - Matter status contract source lookup

- Two read-only `rg` calls included guessed backend/frontend filenames that do not exist; both returned exit code 2 while still finding matches in valid inputs. Continued with confirmed source files and directory-scoped searches. Use `rg --files` before narrowing to unfamiliar filenames. No product code was changed.

## 2026-11-04 - Desktop task bridge source discovery

- Initial read-only lookups used an unmatched zsh `test*` glob and guessed sibling source filenames (`auth.ts`, `conversationRoutes.ts`, `routes.go`). Continued with `rg --files`, directory searches and confirmed files. Inspect the file inventory before narrowing unfamiliar source paths.

## 2026-11-04 - Desktop browser chrome patch context drift

- A single combined `apply_patch` for the browser-opener and macOS layout update was rejected before writing because the architecture wiki line had additional capture-handling text beyond the stale patch context.
- Re-read the exact line and split the follow-up patches by module and documentation target. No source file was changed by the rejected patch.

## 2026-11-04 - Multi-task state fixture consistency

- The expanded native task probe timed out after switching back to a waiting task because the fixture changed its durable list row from pending to waiting without publishing the matching turn status; its replay history therefore still described a pending turn. Corrected the fixture to publish the waiting transition before rediscovery, matching the backend contract. The initial end-to-end probe and production bridge had already passed.

## 2026-11-04 - Installed app quit targeting

- The AppleScript quit request left the installed desktop main PID alive while its companion PID changed; the isolated pet shares the app executable. The installer correctly stopped before any replacement. Verified the exact old main executable with `ps`, sent SIGTERM only to that PID, waited for its owned processes to exit, and then continued the staged replacement. No broad process kill was used.

## 2026-11-04 - Stacked companion capsule validation

- The first multi-capsule native probe found that a reversed flex stack with visible overflow does not report its negative upward content through `scrollHeight` until scrolling is enabled. Determine overflow from the identical card heights and gaps before enabling the scroll viewport; a real wheel-input probe now verifies all twelve capsules remain reachable.
- A focused panel fixture bypassed the production Matter-output callback and therefore left autonomous roaming enabled while measuring hover geometry. Drive single-task updates through the fixture's real `onMatterOutput` callback, exercising both capsules and the business-state roaming lock. The corrected focused probe passed all four widths and both system appearances.
- Read-only navigation-anchor searches included guessed Web folders (`pages`, `conversation`, `ui`) that do not exist. Recovered using the file inventory and the confirmed `screens/LiveConversation.tsx`; avoid including unverified folders even in a combined `rg` call.

## 2026-11-04 - Scoped pet activity installation preflight

- Read-only ASAR inventory initially passed leading-slash list entries directly to `statFile`; normalize them to archive-relative paths. The staged repack check also compared directory `unpacked` metadata, which `unpackDir` marks differently from the original file-only matcher; verify flags on files and links, and verify every file content instead. Both checks stopped before modifying the installed app.
- The installation preflight assumed a bundle `_CodeSignature` existed. Inspection showed the current executable is linker-signed ad hoc, with no sealed resources and no bundle signature directory. Back up optional signature metadata only when present; preserve the existing signing arrangement and update the ASAR integrity hash. The staged-only error did not touch the running app.
- A read-only route search used unmatched `server*`/`index*` shell globs at the package root. Replaced it with a directory-scoped `rg` search; the actual server is `src/server.ts`. Do not use shell globs to guess unfamiliar file locations.
- Final scoped installation passed content verification: 4,520 other resource entries unchanged, original figure files unchanged, metadata changed only for the ASAR integrity hash, and the reopened pet serves all six tested logic modules.

## 2026-11-04 - Suit Duck work sleeve alignment

- User screenshot exposed a pre-existing pose defect that lifecycle/timing regressions did not detect: the work transform translated the entire near arm (hand, cuff and navy sleeve) 12 SVG units away from the shoulder. Matching all 21 base paths against the supplied Character_And_Suit_Animated.svg confirmed the correct figure and grouping; the defect was the hand-written work transform, not source artwork or automatic-state routing.
- Fixed only Suit Duck work placement: pin the arm at its source shoulder, rotate while typing, and align the laptop keyboard within reach. Added a joint-position unit regression and a real opaque-sandbox SVG geometry probe for both facings and repeated entry/typing/stow (72 samples). Verify animation geometry visually as well as its lifecycle; keep source artwork and client styles unchanged.

## 2026-11-04 - Brave native source and toolchain initialization

- Public upstream Git operations initially inherited a global GitHub HTTPS-to-SSH rewrite and failed authentication. Use task-local `GIT_CONFIG_GLOBAL=/dev/null` and noninteractive public HTTPS; do not change global Git configuration.
- Pinning only the top-level pnpm invocation was insufficient: Leo's Git dependency prepare command invoked `/opt/homebrew/bin/pnpm` 10.33.0 and rejected its URL override. A task-local executable wrapper now forces pnpm 11.27.0 for nested commands too. The actual upstream frozen install and Leo prepare completed successfully. This was not proven to be a parser defect in pnpm 11.11.0.
- Broad partial-clone checkout transfers repeatedly ended with curl 18/28, early EOF or bad pack headers. Retained downloaded objects and temporary packs. Added bounded Git-object batches and an exact-commit archive recovery path that validates each blob against the Git tree before import; its success, mismatch and truncated-transfer tests pass without changing refs or existing files.
- Python urllib's archive TLS connection ended with `UNEXPECTED_EOF_WHILE_READING` before importing any objects. The same official endpoint works through system curl; archive recovery now streams from curl with HTTPS-only redirects and still validates each Git blob. This does not make an incomplete unverified archive valid source.
- Strict signature checking on the read-only official Brave DMG mount rejected Sparkle FinderInfo metadata. A clean reference copy with `ditto --noextattr --norsrc --noqtn` passed deep strict signature verification without changing executable bytes or re-signing. It is a reference runtime, not the native integration artifact.
- The quality scanner does not recognize `.cjs`; a zero-file scan is not validation. Use exact `.js` copies in the ignored verification workspace for the JavaScript tooling and scan Python directly. Native patch application and TSX parsing also do not substitute for a real Chromium build or native UI tests.
- A diagnostic pnpm invocation at the desktop root touched the lockfile timestamp. Read-back comparison with the existing installed lock showed identical contents; no desktop dependency or lockfile content change was made.
- A transfer probe through the macOS system proxy at loopback port 7897 failed TLS negotiation before downloading any bytes. Do not assume system proxy settings improve CLI transfers; the active direct archive stream was retained. A separate bounded Git-object fetch is making verified progress while the official depot_tools clone runs.
- A Gitiles URL containing `?format=TEXT` was initially unquoted and zsh rejected it as a glob; quoting the URL fixed the request. A guessed legacy Chromium navigator header returned 404; the pinned source uses `chrome/browser/ui/navigator/browser_navigator.h`. Resolve APIs from the pinned source instead of guessed paths.
- The failed upstream depot_tools clone left an ActionGuard marker. Starting official sync while a separately recovered checkout was still bootstrapping caused its cleanup callback to delete that active checkout and unlink an in-progress CIPD download. The runner now awaits a fixed-commit bootstrap before official sync, retains incomplete checkouts by renaming them, and clears the official guard only after bootstrap and an actual gclient check succeed. Never start competing init/sync processes against the same checkout.
- One CIPD byte range repeatedly timed out while other ranges completed. A separate bounded request recovered the missing bytes; its Content-Range, length and ETag were checked before the complete 26,139,634-byte client passed the official pinned SHA256. Later package recovery hit curl TLS error 35; retries now include transient TLS failures, and already verified archives remain cached. Packages are installed and checked by the official CIPD client, not by manual extraction.
- Independent reverse checks cannot recognize an applied patch when a later patch refactors its inserted code. Reproduced the overlap failure and replaced per-patch detection with whole-chain preflight in a temporary Git index, exact-prefix recognition and final object read-back. Five real-Git regressions cover overlapping reruns, partial-prefix recovery, drift, a broken later patch and pin rejection while preserving staged user work.
- Some read-only probes used an incorrect fixture working directory, guessed source/header locations, or a shell glob after temporary downloads had completed. Recovered from the file inventory, the pinned headers and explicit absolute patch paths. Use pathlib enumeration for optional generated files. No installed app or unrelated source was changed by those probes.
- The expanded quality scan found excessive complexity in range assembly and one long bootstrap import. Extracted the atomic digest-verified assembly step and split the import; the repeated scan of sixteen exact source copies reports zero errors or warnings. This does not substitute for compiling or exercising native C++.
- Direct vpython/uv wheel downloads timed out against the official registry. A task-local HTTPS proxy using the machine's existing loopback service allowed the unchanged pinned Python spec to initialize and gclient to run. No global proxy settings, requirements or vpython bypass flags were changed.
- The official gsutil 5.35 urllib stream repeatedly ended before 14,920,713 bytes. Recovered the exact official archive with validated ranges through the task proxy, checked the MD5 from Google's HTTPS metadata, then used the unchanged upstream installer with a local-file transport. The installed official entry point reports version 5.35. A direct probe initially lacked depot_tools in PATH and could not find luci-auth; the runner now includes it for all bootstrap children.
- Full ensure_bootstrap also preinstalls unrelated legacy pylint versions and their old Python environments. The pinned bootstrap now verifies official CIPD packages and actually runs the build-required gclient and gsutil entry points instead. Its interruption guard is retained until those checks succeed; only task-owned initialization process groups were stopped during this transition, with source and caches retained.

## 2026-11-05 - Chromium partial-source recovery

- Initial gclient cloning moved the existing nested Brave directory under `_bad_scm` after its source transfer failed. Stopped only the task runner, restored the entire Brave directory by rename, and verified its pin and native modifications. Chromium now gets a complete pinned checkout before official dependency sync; unrelated files and original recovery directories remain retained.
- An interrupted shallow Chromium metadata pack contained 30,968 complete objects. Recovered them with Git's unpack-objects, installed a verified promisor metadata pack, and retained both the original partial pack and loose objects. This is source recovery, not build readiness. Directory discovery must inspect raw tree mode 40000; mode 160000 is an external Gitlink commit and must not be fetched as a main-repository tree.
- `git show -s --format=%T` unexpectedly attempted to read an unavailable nested tree during recovery. Read the root tree from `git cat-file commit` instead; a real Git fixture with missing directory metadata now recovers successfully. Source tests pass. Explicit task-local proxy transport works for verified tree transfers; direct TLS/DNS failures do not justify changing global network settings or discarding cached source.
- Bounded Git batches continued to stall while an isolated real tree transfer succeeded. Official Gitiles commit/path JSON returned the same tree content; tree-ID-only URLs returned 404 because Gitiles expects a commit/path. The recovery now reconstructs and hashes exact raw tree bytes before Git import. Eight HTTP workers later encountered HTTP 429; reduced them to two and added delayed bounded retries. Downloaded trees remain retained on rate-limit or TLS failures. Archive recovery was extended to the fixed Chromium mirror and to commits not yet checked out; the new unborn-HEAD fixture passes without changing HEAD or existing refs.
- Bulk metadata refetch stalled; public recursive GitHub tree metadata succeeded through the existing authenticated CLI. Root and large Blink responses were truncated or ended early, so smaller pinned subtrees were fetched. Only reconstructed directories matching their Git IDs were imported; incomplete directory data was skipped. The complete pinned Chromium directory tree now traverses successfully. The CLI is not a new runner dependency.
- Per-object missing-source inventory spent excessive time probing hundreds of thousands of absent files. Compare the pinned tree's required IDs against one local object inventory instead. Node and Python regressions passed after the change. A guessed regression filename did not exist; actual source-selection tests live in `scripts/native-source-layout.test.cjs`.
- Code review found that controlled archive cancellation could be mistaken for network failure and start another download. The runner now marks controlled stops and Chromium preparation rethrows them; a real incomplete-source fixture verifies that no fallback is launched and existing work is retained.
- The exact-commit Chromium archive imported 430,143 verified blobs before `third_party/mako/mako/test/templates/crlf.html` failed its Git hash check. Gitiles and raw GitHub bytes both match the pinned LF blob; `third_party/mako/.gitattributes` explicitly exports this fixture with `eol=crlf`. Recovery now also tries canonical LF bytes but imports them only when their Git hash matches the pinned object; changed text still fails the regression. Completed archive and subsequent bounded-fetch objects were retained before resuming initialization with the corrected recovery.
- Replaying the full Chromium mirror archive downloaded already-known files too slowly. The official exact-commit Gitiles directory archives worked: all 10,881 files in the UI archive were first verified against Git, then a task-local two-worker recovery imported the remaining directories with the existing per-blob verifier. Transient HTTP 503 responses succeeded on bounded retries. Only `vpython.toml` and its lock remained outside those directories; bounded Git fetched both. The final inventory reports zero missing pinned source objects. Checkout/dependency initialization then resumed without competing sync processes.

## 2026-11-05 - Sidebar-only macOS safe area

- Read-only discovery used optional unquoted zsh globs and two guessed filenames that were absent; resolved from the actual file inventory. No write resulted. ASAR entry names returned with a leading slash must be normalized before `statFile`.
- The first native fixture returned an assigned callback from `executeJavaScript`, which cannot cross Electron structured-clone IPC. Return `undefined` explicitly; the rerun passed the complete native chrome suite.
- A staged ASAR repack using `unpackDir` changed directory flags although file bytes matched. The pre-install comparison rejected it; repacked with file-only unpack globs and verified every entry and flag. The live installation was untouched during recovery.
- Outer app signing also updates the embedded signature of the main Mach-O executable. Compared copies after signature removal and confirmed executable code is identical; only the three intended archive sources and signing/integrity metadata change.
- A combined documentation patch failed on an incorrect error-log anchor. Read back both wiki targets to confirm neither write had applied before making the exact scoped updates.

## 2026-11-05 - Restore original browser chrome

- A historical checkout predates the split `BrowserTabs.tsx`; inspect its actual tree and inline component instead. Optional guessed stylesheet/icon paths were absent, so discovery now uses the existing design primitives and exact historical CSS.
- `@electron/asar` is transitive rather than a root dependency. Resolve its existing pnpm package path instead of adding a dependency.
- First offscreen Electron smoke stopped at `capturePage` with `UnknownVizError`; rerunning with `--disable-gpu` passed that boundary and exposed a real inherited 8px Panel action radius. Restored the original pill radius only within browser chrome and reran the same assertions.
- The staging ASAR comparison rejected a lost unpacked flag before installation. Existing asar 3.4.1 matches unpack globs against absolute filenames; use an absolute file-only pattern and verify all unrelated entry flags and bytes. The live app was untouched.
- A later smoke launch observed the shell before the Matter native view URL was attached. Added a bounded wait for that existing view before reading its children; no application startup logic changed.

- Follow-up title-bar/zero-width-sidebar work remained uninstalled when the user requested restoration. Reverted all six original source/test files byte-for-byte and removed both task-owned adapter/probe files. One follow-up offscreen capture reported `UnknownVizError`; no release claim was made for that build. CUA launch discovery used an unavailable optional method, timed out during startup, and found duplicate bundle IDs on a mounted DMG; the full installed app path resolved after startup.
- Sidebar offscreen screenshot intermittently raised `UnknownVizError` even with software rendering. Waiting two animation frames and keeping capture hidden/awake passed the full suite; all original assertions remain enabled.
- Graceful installed-app quit did not finish during the bounded wait; no application files were replaced on that attempt. Stopped only the verified app process tree, rechecked all baseline resources, then installed the four verified archive/signing files and relaunched. Live CDP read-back confirms the restored bundle, 999px pill tabs, flex navigation and shared Panel spacing.
- Another workspace task concurrently reverted the sidebar-only safe-area experiment and removed its dedicated probe. Preserved that newer layout rollback and re-applied only browser-style assertions to the current smoke; the installed archive was rechecked and still matched the restored browser staging.

## 2026-11-05 - Clean canceled browser migration

- The initial process inventory encountered a non-UTF-8 byte in another process's command line. No deletion had started. Re-read the inventory with replacement decoding and validated the exact task paths and inactive processes before cleanup.
- The uninstalled zero-width-sidebar fixture also failed a width assertion and was discarded with the requested rollback. CUA Cmd+Q did not reliably terminate the active window; quitting via the observed native application menu completed shutdown. Both attempted restores stopped at the running-process precondition before changing files.
- A whole-bundle restoration correctly refused after another workspace installed newer browser assets. Rebuilt from that latest installed ASAR, restored only the three known safety-area files, and verified the other 346 archive entries and unpack flags remained unchanged. A concurrent smoke-test edit added browser-style assertions and was preserved; its rerun passed. Re-signed and verified the scoped rollback, then confirmed the running Matter viewport is 1280×748 for an 800px content window with no injected sidebar adapter.

## 2026-11-05 - Unit tests under the default shell Node

- `pnpm test` on the shell's default nvm Node v18.20.8 stalled at test 28 until a 300s timeout: `companion-actions.test.cjs` hung in its task-stream test and `companion-suit-pose.test.cjs` failed with `Cannot use import statement outside a module` when importing the ESM `figure.js`. The same 87 tests all pass on Node v20.19.4, v22.22.0 and v24.21.0. The project declares no `engines` or `.nvmrc`, so run unit tests with Node >= 20.19.

## 2026-11-05 - Service-worker preload probe for removing the DevTools port

- A throwaway Electron 44.4.5 probe (outside the repo, since deleted) tested replacing the global remote-debugging port. `ses.serviceWorkers.startWorkerForScope()` called right after `loadExtension()` failed with `Failed to start service worker.` for every extension, because the extension workers were already starting; attach on `running-status-changed` instead and use `startWorkerForScope` only for later wakes.
- Service-worker IPC reaches only that worker's `ServiceWorkerMain.ipc`, not the global `ipcMain`. A restarted worker is a new `ServiceWorkerMain` with the same `versionId`; tracking attachment by `versionId` left it without handlers (`No handler registered for 'probe:ping'`). Attach handlers per instance.
- `self` is not defined in the service-worker preload's isolated world; read `location.href` through `contextBridge.executeInMainWorld`. The registered service-worker preload also runs in ordinary website workers, so it must gate on the Matter Browser extension origin.
- Security finding, not a probe failure: a `webContents.debugger` attached to an ordinary Agent Browser tab listed every page and service worker via `Target.getTargets`, including a page in the default session. Using the same two-argument `sendCommand` shape the compatibility bridge forwards, `Target.attachToTarget` (`flatten: false`) plus `Target.sendMessageToTarget` read that page's `localStorage` and changed its title. `debuggerSendCommand` currently forwards any method.

## 2026-11-05 - Remote dev release-build probe

- A disposable remote `dev` clone/build probe was rejected by the execution environment before it started because its exact temporary-directory cleanup used `rm -rf`. No clone, dependency installation, build, or project-file change occurred. Keep the package script's existing bounded temporary-directory cleanup, but use its shell syntax check, the package unit suite, and `git ls-remote` to validate this scoped packaging-script change in this environment.

## 2026-11-05 - Default signed-release documentation patch

- A combined script/README/release-guide/wiki patch was rejected because the concurrently updated wiki Recent Updates heading no longer had the previously read adjacent entry. No file was written by that attempt. Re-read the current sections, then applied scoped patches without replacing concurrent updates.

## 2026-11-05 - Service-worker preload bridge migration

- The first compatibility-smoke run of the new bridge passed every tab, group, window and debugger assertion but saw no paired presence: a `chrome.storage.onChanged` listener plus a startup read in the extension worker never reached main within the test window. Presence now uses a main-initiated re-read over `ServiceWorkerMain.send`, the path the earlier probe had proven; the cause of the missing push was not isolated.
- `matter-browser-extension-compatibility-smoke.cjs` and `extension-bridge-probe.cjs` set `app.exitCode`, which is not an Electron API, so a failed assertion still exited 0. Both now call `app.exit(1)`.
- `extension-bridge-probe.cjs` removes its profile in `finally`, but Chromium rewrites `Local State` during quit, leaving an empty-looking profile directory behind. Remove that run's directory afterwards when running it repeatedly.

## 2026-11-05 - Interactive desktop-pet QA cards

- Initial SVG rendering destroyed its only Electron window between assets, triggering app shutdown before the next render. Reused one window and retained the app until all three reference captures completed. Optional source-file guesses were resolved from the actual inventory.
- QA bundling found that the sibling Web no longer contained the initially selected checkbox/radio/choice-option styles. Inspected the current original QA imports and bundled only its actual buttons/composer/QA styles; the adapter was aligned with the current two-argument page-pick callback. No sibling source was modified.
- The first shared-top layout assertions exposed different bottom-edge clamping for the 6px handle and 42px expanded controls. Captured actual body/control geometry, reserved expanded height in both states and raised the floor reserve to 64px; the unchanged edge/hover checks then passed. Transparent offscreen captures show exaggerated white alpha edges when viewed without a backdrop; compositing over an opaque neutral backdrop confirms the intended subtle shadow.
- The installed main entry differs from the task source baseline due to concurrent extension/browser work. Staging applies only the two QA wiring insertions to the current installed main, and compares every unrelated archive entry/flag and bundle resource rather than overwriting it from the workspace.
- The staging comparison initially saw transient differences in the final four ASAR entries. Fresh-process hashes proved the bytes were unchanged; inspection of @electron/asar 3.4.1 showed its package promise returns `out.end()` before the writable finishes. The task staging helper now awaits `stream/promises.finished(writer)` before any read-back, and the complete comparison passes. A subsequent helper-only equality guard had a leftover negation; the guard rejected staging before changing the live app, was corrected to strict string equality, then passed.
- The generic quality skill scanner omits `.cjs` and `.tsx`; scanned exact task-local `.js` copies of the six bridge/QA source files instead. The scoped scan reports zero errors/warnings; the original TSX also passes the sibling project’s strict TypeScript settings via a temporary scoped config.

## 2026-11-05 - Card-inline QA and quick composer verification

- The prior card probe used DOM `.click()` and inspected the button alone, allowing collapsed/transparent ancestor content to pass. The revised probe checks effective ancestor visibility, opacity, shadow hit testing and real CDP mouse clicks. QA input now lives inside the card with one action footer instead of collapsing the client OptionPanel and appending an external composer.
- A 16px geometric assertion measured 15.9999847px due to compositor rounding; use a 0.05px tolerance for fractional CSS positions. Optional file guesses and zsh unmatched globs were resolved through file inventory; no production changes were made for missing helper/style filenames.
- Changing the edit icon from host navigation to a local composer required updating all related probe expectations: the hidden offscreen window needed explicit textarea focus before Escape, `chat-context` adds a public target that must be cleared between independent assertions, and the old late synthetic click-all check still expected `new-chat`. Read the full probe and updated those expectations; real action paths, native bridge, composer and QA checks then passed.
- Panel startup also logs pre-existing figure filter bounds of inf/-inf and an occasional macOS sandbox resource diagnostic; the complete figure/panel assertions pass. The figure assets were outside this scoped UI change and were preserved.
- The final running-process check initially treated `--remote-debugging-port=0` on renderer subprocess command lines as a global/pet debugging switch. Inspection confirmed the installed main has no appendSwitch and neither the main nor pet-host process carries it; scope this assertion to the actual host processes. No debugging flag was added by this update. Runtime-resource, installed-source and signature checks then passed.

## 2026-11-05 - Desktop-pet QA option alignment

- This workspace is not a Git checkout; the initial `git status` stopped a chained read before any mutation. Use bounded file reads and task-local source baselines for scoped edits and preservation checks.
- A guessed sibling `ChoiceOption.tsx` path was absent. The sibling source is older than the installed main client; locate actual installed ChoiceOption/radio styles in its ASAR instead of assuming the stale numbered QA matches the user screenshot. Shared Web files remain read-only.
- A staging-helper orchestration call had a nested template-literal syntax error; the tool rejected it before any command ran. Generated the fresh helper with plain string replacement and retained the current-app drift guards.
- The new selection-color assertion sampled the 120ms CSS transition at alpha 0.816. Kept the expected final main-QA colors and added a bounded wait for the selected surface to settle before checking layout; no production workaround was needed.

## 2026-11-05 - Desktop-pet stacked message queue

- An initial search named a nonexistent task-bridge probe, stopping the chained read without any mutation. Used the actual script inventory and existing `companion-tasks-probe.cjs` instead.
- Runtime integrity caught a second existing pet-app notice entry still carrying the prior hash; the update had changed only the first match. Synchronized the digest in every existing entry for the three touched resources and kept unrelated notice entries.
- The first native queue probe expected an existing waiting card after introducing waiting and running rows simultaneously into an empty panel. The actual initial running-first selection was correct. Established the waiting-card precondition before adding the new running task; retained the stable-current assertion.
- The native close-next assertion compared the stable queue with the independently changing running-first server primary. Replaced that incorrect equality with a next-live-conversation check plus an exact one-item decrement. Also keyed queue order by conversation so a late replayed turn anchor cannot reorder a visible message; added a UI regression for this metadata update.
- After the scoped signed install, the restored full-screen main window initially showed a blank view. Reload did not restore it; toggling full screen out and back showed the existing main UI again. Verified content after restoring the original full-screen state; no unrelated layout/source change was made.

## 2026-11-05 桌宠进行中操作验证
- 首轮定向单测发现新增 contextId/queued:false 改变原空状态和新聊天返回形状；已改为只在需要时输出，115 项单测通过。
- 原生 QA 探针在新增 180ms 输入框展开动画尚未结束时点击附件，透明度断言失败；探针改为等待实际控件透明度完成再点击。
- 面板探针首次在队列关闭按钮悬浮断言超时；增加卡片内连续指针路径及失败截图继续定位，保持可见性断言。
- 查找不存在的 bridge.cjs 路径，以及 zsh 未匹配新预览 glob 的只读命令出错；已改用已确认的 task-bridge.cjs 和明确文件路径。
- 新增运行卡 UI 探针发现浮点布局的右侧距离为 16.000015px，以及动画中输入框暂时上移 2px；使用 0.001px 几何精度并等动画结束验证最终布局，未改生产布局。
- 运行卡收起后立即点击停止的探针没有触发请求；增加动画/布局帧稳定检查和实际动作断言，继续定位后再安装。
- 新运行卡探针的最后一次停止点击失败确认为收起导致上方卡片锚点尚未重新定位；点击前同步两帧并断言真实动作后通过。完整面板回归、原生 QA/排队/终止、任务状态链路及 115 项单测全部通过；安装版定向替换、签名、重启和实际资源校验完成。

## 2026-11-05 桌宠 QA 胶囊输入框
- 全部面板断言通过并正常退出；Electron 测试进程额外输出一次 sandbox_extension_issue_file / Electron Helper Resources / Operation not permitted 的原生日志。未影响四宽深浅、长输入滚动、焦点和 QA 操作断言，不更改项目权限或沙箱策略。

## 2026-11-05 桌宠悬浮中性边缘
- QA 悬浮探针首次在深浅主题的 160ms 阴影过渡中读取基线，得到插值灰色（80/175），随后与最终白色比较失败；改为先等待目标主题中性边缘完全稳定再比较悬浮前后，生产 CSS 无需修改。退出失败探针后另有 GPU SharedImageManager 邮箱日志，不作为原始失败原因。
- 替换前设置窗口被用户持续切换，CUA 拒绝陈旧菜单索引；一次退出快捷键调用超时并重置内核，进程检查确认应用仍在运行。重新获取当前窗口后通过原生应用菜单正常退出，定向安装、重启、验签和运行中资源核对均通过。

## 2026-11-05 桌宠会话内容撑高与标题间距
- 新增 2/3 自由回答布局探针首次读到 160.000015px 的卡片高度，与精确 160px 深比较失败；各项间距与输入高度符合预期。探针将几何读数归一到 0.001px 再比较，保留 8px 间距、内容撑高和深浅模式断言，未为浮点误差修改生产布局。
- 修正探针后四宽深浅模式完整面板回归通过，115 项单测和运行时完整性通过；定向安装仅更换一项归档源码及两项桌宠样式资源和必要签名/元数据，重启后实际资源与源码一致。

## 2026-11-05 桌宠默认显示配置
- 首次新增 seed 行为测试直接导入 seed.ts，只加载 tsx，未注册生产 boot.ts 先注册的 Cortico 扩展解析器，导致找不到 cortico 包；测试改为同样预加载 build/cortico/src/extensions/runtime.ts。真实 Core 的全新数据与重启自动显示验证已通过，生产代码无需为测试添加依赖。
- 只读检查中猜测了不存在的 core.cjs、tsconfig.json、resolve.ts 及 register glob，出现缺失路径/未匹配 glob；后续按实际 boot.ts 导入链查到解析器，未修改相关文件。
- 补齐生产解析器后 117 项单测通过，首次启动/再次启动原生自动显示通过；定向安装默认 seed 后验签和运行状态核对通过，默认鸭已自动显示。

## 2026-11-05 - Desktop-pet content-window assessment

- The initial read-only window search included the absent `src/companion/host/` directory alongside the valid `host.cjs` and vendored host, so ripgrep returned 2 while printing valid matches. Continued with the confirmed vendored host/preload/renderer paths; no production file or application change.

## 2026-11-05 - Default duck transition flicker diagnosis

- A read-only search guessed `web/kit.js`; the actual official body implementation is `web/kit/body.js`, confirmed from the sandbox import. A broad temporary-directory file inventory also met protected macOS service subdirectories; continued only within the known task artifact directory. No production code changed.
- An isolated Electron 44.4.5 rendering of the current installed/source-identical duck reproduced the crossfade alpha dip: idle and active full-body groups at 0.5 each produced interior alpha 191/255 (about 75%) at 60ms of the 120ms transition. A temporary isolated `plus-lighter` blend kept the sampled interior alpha at 255 through both work/ask entries. This was diagnostic candidate validation only, not an installed fix.

## 2026-11-05 · bounded viewport native probe

- First drag/recovery probe passed its interaction steps but its original full-run work-area equality assertion failed (859 → 862 DIP). macOS changed the actual work area during Dock auto-hide/focus. The probe now compares the logical world against Electron screen.workArea at each checkpoint, while still verifying native crop size does not feed back into the world.

- The QA probe's assertions passed, but its HTTP fixture teardown later reached the smoke deadline while another probe was running. Re-run in isolation and inspect fixture socket shutdown before treating the run as passed.
- The full legacy smoke timed out on its settings-page label/iframe precondition before reaching figure assertions. Add bounded diagnostic output and re-run against the current settings build; do not modify unrelated settings to satisfy the test.
- Quality checker excludes vendor/node_modules and reports zero scanned files for a direct runtime path; scan temporary scoped copies instead. Original work-artwork exports contain pre-existing `inf` filter rectangles; preserve the supplied artwork in this task.

- Resolved QA teardown: explicitly close the test HTTP fixture's remaining connections after stopping its SSE streams; isolated QA smoke now exits 0. Resolved legacy settings smoke: the default duck label is in the cross-origin dressing iframe, not the console shell; wait for the actual iframe body. No settings production code changed.

- Native viewport probe raced asynchronous quick-chat context loading (input was still disabled). Wait for the real textarea enabled state before sending input, matching the authenticated QA probe; run native focus checks sequentially.

## 2026-11-05 桌宠设置顶部 GitHub 链接
- 安装后的原生验证中，一次 CUA 菜单操作超时并重置内核；重新获取句柄后，设置快捷键未触发，继续使用旧菜单索引得到 invalid element ID。改为在每次点击的同一调用中重新读取完整 AX 树并解析当前菜单项，成功打开桌宠设置；实际确认顶部版本/GitHub 区域及分隔线已移除。生产代码和测试均无需为该自动化故障改动。

- First install waited for the old app processes and replaced nothing. A later guard found a concurrent update to companion-runtime/build/console/index.js plus notices/signature. Retained the prior stage and rebuilt from the latest installed app, preserving that console update. Imported duck updates are backed up separately.

- Live-resource verification initially split the application path on whitespace, missing `Minduck Matter.app`; match the full ps command prefix after stripping only the PID. Corrected verification passed: all eight runtime targets, active imported default-duck modules, signature and concurrent settings build match.

## 2026-11-05 - Single-choice QA lookup

- A read-only lookup used an unmatched `src/companion/ui/qa*.ts` zsh glob. The actual source is `qa.tsx`; resumed with exact filenames and quoted rg globs. No files were changed by the failed lookup.

## 2026-11-05 - User-requested viewport/compositing rollback

- User observed worse transparency and choppy animation after the viewport/plus-lighter experiment despite automated checks passing. Restore the exact pre-change host, renderer and default-duck modules, including the active imported copy; retain later single-choice QA and concurrent settings updates. Synthetic alpha and geometry checks did not establish native desktop animation quality.
- The initial backup inventory expected `baseline-files.json`; this older task recorded its file list in `targets.json`. Used that verified list and compared applied hashes before restoring.

- The rollback full smoke passed, including sandbox timing, drag/drop and all panel UI checks. The following native QA probe reached the quick-chat attachment step after successfully submitting single-choice text/files, then timed out waiting for the bottom control opacity. Re-run the isolated native probe before classifying this result; preserve the requested pre-experiment production code.

- Isolated native QA retry completed with exit 0, covering QA text/files, platform chat, queue/upload/direct stop and stale-organization rejection. No production change was made for the transient expansion timeout.

- A temporary installed-verification helper had one extra closing parenthesis in its removed-file assertion. Corrected only the helper; live verification then confirmed all restored runtime/duck modules, retained single-choice QA, preserved settings and valid signature. A source lookup also guessed nonexistent `src/windowLayout.cjs`; used the known `src/main.cjs` and verified runtime host instead.
- On restart CUA returned only the main window container, with a black capture and no embedded-view AX content; resetting its binding and a second clean restart did not establish main-page visual QA. The running pet resource check and read-only native window measurement succeeded (1512×859 DIP). No main-client code was changed in response to this observation.

## 2026-11-05 - 0.1.1 release build

- The first Web `dev` shallow clone remained without visible progress for over 90 seconds while a bounded batch-mode `ls-remote` succeeded. Terminated only this task's exact clone PID and retained its log; git reported early EOF following termination. Retrying the existing release script with batch-mode SSH and explicit connection timeout. The prior release and installed application were not changed.

- 2026-11-06: The batch-mode SSH retry ended with `Connection to ssh.github.com closed by remote host` / unexpected disconnect / early EOF without intervention. Retrying the same remote `dev` release via HTTPS with the existing GitHub credential helper and HTTP/1.1; no stale frontend fallback or source-checkout changes.

- 2026-11-06: HTTPS shallow clone of remote `dev` succeeded at `6beb91cbf357d19d2f0b62819b86f970b5ac43b8`; frozen-lockfile install, full Web TypeScript/Vite build and desktop-shell build passed. The signed release preflight now reports missing `MinduckNotary` even when explicitly selecting login.keychain-db; requested local profile restoration without requesting secret material. Preparing signed artifacts in the task staging directory while public notarized release remains pending.

- 2026-11-06: Post-install main UI initially appeared blank in full screen; toggled full screen out and back using the native menu, then visually confirmed the new Web home and restored full-screen state. No production code changed. A read-only pet window assertion using AppKit visibleFrame differed by the full-screen menu-bar area; corrected the probe to compare native CGWindow bounds with Electron screen.workArea, the production host API. It matches exactly at 2560×1410 DIP.

- 2026-11-06 resolution: User restored `MinduckNotary`; Apple accepted submission `7dc758aa-bac1-4bb1-8a18-fffe189aac0e`. DMG and installed app tickets validate. The host Gatekeeper assessment is overridden by an existing disabled policy, so it is not treated as independent clean-machine acceptance; no security setting was changed.
- Stapling changed the DMG from 195,986,037 to 195,988,159 bytes, leaving the original block map short. Two read-only probes assumed an older `app-builder-bin` dependency and failed; inspected the installed 26.16.1 sources and used its existing JavaScript `buildBlockMap` implementation instead. Added the same post-staple refresh to the release script without dependencies; shell syntax, 119 unit tests and all 9,354 final block checksums pass.

## 2026-11-06 · 0.1.1 cross-Mac launch rejection

- User reports the DMG-dragged app cannot open on both M2 Pro and M4 Macs. Original payload is arm64, Mach-O minimum macOS 13.0, executable mode 0755, with self-contained symlinks and a valid deep signature. Its outer DMG ticket validates, but the app inside has no stapled ticket; `syspolicy_check distribution` exits 70 with fatal `Notary Ticket Missing`.
- Prior release checks validated the separately stapled local installation and outer DMG, not the app inside the shipped DMG. Local Gatekeeper assessment was already overridden by existing system policy; its accepted result was insufficient distribution evidence.
- A clone of the exact released app passes distribution checks after adding only Contents/CodeResources. Prepared an r1 installer from that clone; mounted r1 app matches all original files/modes except the added ticket, and its signature, stapled app ticket and distribution checks pass. The target Macs’ actual launch result is still unconfirmed.
- Future signed packaging now supplies the validated Keychain profile to electron-builder so app notarization/stapling runs before DMG construction, validates the app ticket/distribution readiness, and signs the DMG before outer notarization. No client UI/source or installed app was replaced during diagnosis.

- r1 completion: DMG signature verifies; Apple accepted `19df9b11-bc4e-4ec7-a4f1-5c6ced053bc4`; outer ticket validates. Re-mounted the final copied release artifact and revalidated its app ticket, deep signature and distribution readiness. All 9,368 block checksums cover the final 195,996,910-byte image. Requested M2 Pro/M4 launch confirmation from the user; no target-machine success claim yet.

- r1 target failure: User confirmed the revised installer still cannot open. Target macOS is 26.5.1 (25F80); deep signature validation passes, but `spctl` reports `File created by an AppSandbox, exec/open not allowed` and LaunchServices reports `-10810`. Both installed app and main executable carry `0187;6aed4292;Feishu;`; user confirms Feishu transfer. Re-mounted the actual r1 artifact and recursively inspected attributes: zero quarantine attributes, deep signature/app ticket/distribution checks pass. The missing-ticket defect was real but was not the identified cause of this target execution rejection. Browser redownload is currently unavailable to the user; supplied a scoped recovery command that verifies Apple-anchored publisher identity and the known release CDHash before removing only this app's quarantine, then reassesses with `spctl` and opens. Actual recovery launch remains unconfirmed. No local system policy or installed application was changed.
- Read-only diagnostic retries: this macOS Python does not expose `os.listxattr`; use `/usr/bin/xattr` subprocesses. Binary extended attributes cannot be decoded as strict UTF-8; decode diagnostic output with replacement or read only the named text attribute. A sidecar lookup initially omitted `.dmg` from its verified filename; corrected from the release inventory. These failures did not modify payloads.

- Target recovery confirmed: user reports the app opens after executing the signature/pinned-CDHash-gated, app-scoped quarantine removal, explicit security reassessment and launch command. This confirms the transfer-added quarantine rejection on that Mac; a second reported Mac has not been independently retested. No system security policy was changed. Produced an optional direct-app ZIP from the same verified release app without touching source or the locally installed app. Fresh extraction matches all 5,548 content/mode/link entries, including 14 symlinks; CRC, publisher/CDHash/deep signature, app ticket and distribution checks pass. Feishu transfer of the ZIP is not yet tested.

## 2026-11-06 Matter local execution validation
- Initial restricted Seatbelt read profile caused `/bin/echo` and zsh to exit with SIGABRT before output. Broad-read comparison passed; investigating the minimal runtime read requirement rather than permitting user files globally.
- New executor audit regression test initially used GORM AutoMigrate with a PostgreSQL `now()` default, unsupported by SQLite. Changed the test to use the existing explicit SQLite audit schema.
- Initial new queue roundtrip fixture omitted non-null attachment IDs, and a new UI literal lacked Japanese catalog coverage. Fixed the fixtures/catalog before rerunning.
- One debug Node heredoc had an extra parenthesis and one zsh glob referenced a nonexistent file. Corrected the commands; no production state was affected.

- Seatbelt runtime startup was fixed by permitting a literal read of `/`, without granting its subtree. Restricted read/write tests and real Electron worker then passed.
- Initial Electron smoke removed profile data before Chromium cache shutdown. Changed it to the project’s existing Node-parent cleanup pattern; rerun passed without cache errors.
- One batched patch failed exact-line matching and applied nothing; inspected targets before a narrower patch. A gofmt invocation used root-relative paths from the API module; corrected the working directory.
- Backend topology validation is blocked by the absent independent `apps/minduck-matter-web-prod` checkout. API/import/tenant/environment checks passed; did not bypass the guard or fetch a repository.

- A final concurrent regression run reported a process cancellation assertion failure and left the test process active. Stopped only its observed PIDs, added bounded local test timeouts and structured receipts to assertions. Isolated rerun, 10 consecutive local runs and full 132-test TAP run passed; the original intermittent failure was not reproduced.
- A later read used backend-relative paths from the desktop working directory; reran with explicit backend cwd. No source write was attempted in the wrong repository.

- The combined bundled-protocol/webRequest smoke found that Electron's main-process `net.fetch` has an absent `webContentsId`, rather than `-1`. The request listener stripped desktop headers that the protocol handler had just injected. Treat absent IDs as main-process forwarding, retaining the exact-origin, matching-JWT and ready-pairing checks. The integration test now verifies the production listener with an authenticated POST and checks that its body survives.

## 2026-11-06: Local sandbox denial was presented as macOS privacy denial

- Evidence: local_shell ran `ls -la ~/Desktop` from its session directory with no Desktop grant; it returned `Operation not permitted`.
- Cause: the explicit Seatbelt read scope excluded Desktop. This evidence does not establish TCC as the cause.
- Resolution: require external cwd/path to trigger the native folder picker; persist scoped consent, return allowed_directories and permission_hint, and correct model instructions. Full Disk Access does not expand the application sandbox.

## 2026-11-06: Batch patch could not delete and re-add the same path

- Symptom: apply_patch rejected duplicate file paths before any write.
- Resolution: read back unchanged targets, then use updates and scoped file writes.

## 2026-11-06: Automatic execution regression assumed successful writes lose their revision

- Symptom: expected unread-overwrite rejection did not occur after the same controller had just written the file.
- Cause: successful writes correctly retain the current known revision.
- Resolution: change the file externally before checking stale-write rejection; the corrected test and full suite pass.

## 2026-11-06: Release validation native smoke diagnostics

- The parallel full companion smoke reached the `coo` figure check and then hit its existing 100-second deadline. No production cause is established. Fresh-profile startup/restart smoke passed separately.
- A concurrent local-exec smoke stopped making progress; a scoped sample of its Electron PID showed an AppKit NSAlert modal on the main thread. The modal's underlying error could not be retrieved through accessibility, so no cause is attributed. Stopped only that observed test PID.
- Added a test-only 60-second parent process deadline and an uncaughtException logger that exits the isolated Electron test instead of displaying a native modal. The isolated rerun passed all execution, directory, cancellation, IPC and layout assertions. No application source or system permissions were changed for this recovery.

- Packaging verification helper initially resolved a pnpm transitive dependency from the symlinked package.json path, which cannot locate app-builder-lib. Resolved the real electron-builder entry point before createRequire; the read-only ASAR probe then confirmed version 0.1.2 and 15 local-exec entries.

- The isolated full companion rerun passed the figure and panel interaction probes, then compared the current settings ID with an earlier window that had closed during those probes (`5 !== 1`). The closure's origin is not established; settings can legitimately close on the pet's hide/quit controls. Verify immediate singleton reuse before the probes and again after reopening, and wait for the reopened page before stopping Core to avoid an incidental `ERR_FAILED` during cleanup. This changes only test sequencing, not application code.
- Resolution: the revised full companion smoke passed all figure, real-pointer, four-width light/dark panel, settings persistence, singleton reuse and hide/reopen checks in an isolated profile. Existing renderer/platform diagnostic warnings remain visible in its log; no application source was changed to suppress them.

- Installation guard correctly stopped before quitting when the previously observed installed PID had already exited; reinspection found only the development main process still running. The JXA Objective-C bridge exposes zero-argument `terminate` as a property: reading `app.terminate` requested a normal quit, then calling the returned boolean caused a TypeError. Re-read process state confirmed the development app and its pet host had exited; no quit was blindly retried, no force kill was used, and the backend stayed running. The subsequent bundle swap and full backup/installed manifests passed.
- A read-only vendored-source search used obsolete `build/pet-app`/`build/cortico/worlds` paths. Located the actual pet sources under `node_modules/cortico-world-desktop-pet/` from the file inventory; no runtime files were modified.

## [ERR-20261106-browser-demo-lookup] Historical file lookup limits

- `memmy-memory` was unavailable (`command not found`); continued with repository files and saved Codex history.
- This repository has no commits yet, so `git log` cannot locate removed files; saved history confirmed the former `agent-gateway/cmd/minduck-agent-gateway/main.go` entry.
- `read_thread` accepts at most 10 turns per call; retried the rejected 80-turn request with 10.
- An unmatched zsh glob stopped a backup lookup; explicit paths were used instead. macOS denied reading `~/.Trash`; no permissions were changed.

## 2026-11-06: System-folder authorization validation scope

- A read-only search used desktop `src/` and `scripts/` paths from the backend working directory and reported missing paths. Repeated the search with the explicit desktop working directory; no backend files were written.
- The quality checker excludes `.cjs`, so its initial local-exec directory scan covered only `settings-ui.js`. Copied the four relevant CJS files into an isolated temporary directory with `.js` suffixes and scanned those unchanged copies: four files, zero errors/warnings. Removed only that temporary directory afterward.


## [ERR-20261106-browser-integration-review] Cross-repository lookup paths

- The backend repository has no `docs/wiki/index.md`; its architecture entry point is `docs/architecture/current-topology.md`, as documented in its project rules.
- A combined cross-repository lookup used frontend/desktop or backend paths from the wrong working directory, and one guessed backend filename did not exist. Continued with verified paths and explicit repository working directories.
- Assessment validation completed: 8 desktop browser unit tests and focused reverse-MCP pairing, presence and tool-chain tests passed. No production pairing or full server-to-Electron validation was performed.

- Pairing follow-up: a guessed `src/local-exec/transport.cjs` path did not exist; the verified transport file is `src/local-exec/connection.cjs`.

## 2026-11-07: Browser label regression investigation

- A source lookup guessed an `extensions/matter-browser/tests` directory that is absent in the packaged extension. Continued with the existing desktop Electron/WS smoke instead.
- The quality checker treats its target as a directory, so a direct helper-file scan reported zero files. Repeated on temporary `.js` copies of both affected files: two scanned, no errors, one existing helper file-length warning. The temporary directory was removed.
