# Learnings

## [LRN-20261004-001] correction

**Logged**: 2026-10-04T00:00:00+08:00
**Priority**: high
**Status**: pending
**Area**: architecture

### Summary
Matter's requested local sandbox is a VM boundary, not a controlled host Bash tool.

### Details
The user explicitly wants the Matter desktop client to provide an isolated local VM environment for CLI workloads such as OCR and media conversion. Host Bash must not be treated as the sandbox. Bash may be used only as a command interface inside the VM.

### Suggested Action
Evaluate WebVM/CheerpX or a native local VM integration. Keep host filesystem exchange and process control behind explicit, validated bridges.

### Metadata
- Source: user_feedback
- Related Files: docs/wiki/modules/local-agent-gateway.md
- Tags: vm, sandbox, architecture

---

## [LRN-20261105-qa-inline] correction

**Status**: resolved
**Area**: frontend

User feedback clarified that reusing QA capabilities does not mean copying the full client composer/collapse shell. In compact desktop-pet cards, render free input in the card and preserve the original next/send/submit/explicit-skip decisions in one footer. The bottom editor is a separate new Matter platform chat, never a send into the currently open project or conversation. Verify visible interaction through the entire shadow/ancestor chain, not programmatic clicks alone.

## [LRN-20261110-001] correction

**Logged**: 2026-11-10
**Priority**: high
**Status**: resolved
**Area**: build

### Summary
The current signed installer must advance to 0.1.6; the earlier instruction to retain 0.1.5 applied to local debugging.

### Details
The user corrected the same-version packaging assumption. Bump the source package version, rebuild real application metadata and ASAR, and renew application/DMG signatures and notarization; renaming the old installer is insufficient.

### Suggested Action
Treat the current packaging version request as authoritative over previous debugging preferences.

### Metadata
- Source: user_feedback
- Related Files: package.json, docs/macos-distribution.md

## [LRN-20261111-cloud-computer] correction

**Logged**: 2026-11-11
**Priority**: high
**Status**: resolved
**Area**: docs

### Summary
The latest cloud-computer direction retains the user's local computer and adds a separately rented Matter computer with a full desktop.

### Details
The user clarified that local and cloud execution remain selectable, the cloud computer is rented using points, and users can view and take over its desktop. This supersedes the earlier idea of moving every browser operation to the cloud. Automatic device fallback and mid-task migration remain undecided; 1000 points per day is an example, not an agreed price.

### Metadata
- Source: user_feedback
- Related Files: docs/matter-cloud-workspace-mvp.md

## [LRN-20261112-native-window-buttons] correction

**Logged**: 2026-11-12
**Priority**: medium
**Status**: resolved
**Area**: docs

### Summary
No public Electron size option does not imply all native macOS window buttons have the same size or require custom drawing to differ.

### Details
The user showed two applications on the same desktop with visibly different button diameters. macOS appearance and the SDK used to build an application can affect native window chrome; Zed issue 59405 reports smaller release-build traffic lights and larger controls when rebuilt with SDK 26. The local Electron executable links SDK 26.5. Upstream Electron window_buttons_proxy.mm reads native frame dimensions and changes origins; trafficLightPosition is a placement option, not a size setting. A cropped screenshot alone does not establish whether the other app uses compatibility styling or custom controls.

### Suggested Action
Separate the public Electron configuration limits from macOS native appearance differences; qualify any app-specific attribution until that app is inspected. Avoid claiming custom drawing is the only possible path to a smaller appearance.

### Metadata
- Source: user_feedback
- Related Files: src/main.cjs
- References: https://github.com/zed-industries/zed/issues/59405, https://github.com/electron/electron/blob/main/shell/browser/ui/cocoa/window_buttons_proxy.mm


## [LRN-20261113-ICON-BAKED-CORNERS] knowledge_gap

**Logged**: 2026-11-13T05:45:12+00:00
**Priority**: medium
**Status**: pending
**Area**: frontend

### Summary

Opaque full-canvas output does not prove app-icon artwork has no pre-rendered rounded corners.

### Details

Read-only inspection of `build/sidebar-logo.svg` and the shared Web sidebar logo found the same embedded 256×256 RGB PNG (SHA-256 `0d8a3dddbe85bc971487eed0c2e424b3ac0efdc8c6dcb754e4a3bbc3f3fd9985`). Its corner pixels are already black; removing the SVG rectangle/clip `rx` attributes does not reconstruct those missing background pixels. The generated 1024×1024 Duck.png retains black opaque corners. `build/AppIcon.icon/icon.json` supplies the complete image as one layer. Installed 0.1.9 AppIcon.icns and Assets.car match the current build hashes. Native NSWorkspace rendering was compared with the installed Safari icon at 512×512; no installation or icon change was made.

### Suggested Action

For a future authorized icon correction, inspect actual corner colors and source resolution, prepare full-bleed high-resolution background artwork and a separate duck foreground, and compare native system output. Do not treat alpha=255 or removed SVG corner radii alone as proof of corrected artwork.

### Metadata

- Source: conversation
- Related Files: `build/sidebar-logo.svg`, `build/AppIcon.icon/icon.json`, `scripts/build-icon.sh`
- Tags: macos, icon-composer, embedded-raster

## [LRN-20261117-INVITE-DIRECT-ACCESS] correction

**Logged**: 2026-11-17
**Priority**: high
**Status**: resolved
**Area**: frontend

### Summary
Respect the requested standalone invitation page with direct, credential-free access.

### Details
The user explicitly requested a fixed localhost:4179 entry without login, roles, tokens or link keys. The earlier fragment-key guard added an unrequested access flow and blocked that entry. Remove the guard from both H5 and its dedicated issuance API instead of hiding credentials in a proxy. Preserve one-time redemption, request idempotency, storage keys and device proof; unrelated account/admin APIs keep their existing behavior.

### Metadata
- Source: user_feedback
- Related Files: tools/invite-console/core.js, tools/invite-console/app.js, tools/invite-console/serve.cjs
- Tags: scope, invitation, direct-access
