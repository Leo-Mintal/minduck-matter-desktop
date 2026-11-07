# Embedded Coopanion runtime

Minduck vendors Coopanion 0.2.16 from its macOS distribution, including Core, Cortico,
the desktop-pet World, API 2 figure sandbox, console, Node dependencies and native libraries.
The runtime is source in this directory, not a reference to an installed Coopanion.app.
Do not replace it automatically during a normal build. The integration was made on 2026-11-02.

Upstream: https://github.com/Pal-AI-Lab/Coopanion
License: AGPL-3.0-or-later, with upstream's additional Steamworks permission; see LICENSE.
Original package notices and source remain in runtime/. See UPSTREAM.json for the imported
version and before/after hashes of integration changes. Distributors must preserve the
upstream license and provide the corresponding source as required by it.

Integration changes in the vendored source:

- desktop-pet/web/pet-app.js, pet.html and minduck-panels.js/css: desktop-only translucent
  output/actions capsules around the unchanged figure, using system light/dark appearance,
  14px text and the supplied 18px icons. The desktop reserves bottom space and replaces
  the original hover/context controls; browser previews and conversation prompts are preserved.
  The top capsule is empty/hidden without an active task and stays visible independently of hover
  while a task is active. Body hover reveals the bottom controls; the full body/button rectangles
  then share a continuous hover and native mouse-input area with 12px padding, including transparent
  corners and diagonal paths through the gap. Hidden controls never activate from the empty gap.
  Controls also support visible keyboard focus. The buttons use the isolated preload/native bridge to activate Matter:
  new-chat opens `/new-chat`, while open-app preserves the current page. The parent desktop now supplies
  normalized public Matter task output through the native bridge: pending/running/waiting remain visible,
  while idle and settled tasks hide. Business credentials and tool configuration never reach this page.
  Every active conversation now has an independent capsule, stacking upward with 8px gaps; overflow
  scrolls within the available height and accepts native wheel input. Lifecycle controls automatic work/ask flows and stops roaming while active.
  Observed terminal transitions play happy/sad once after the concurrent task batch finishes.
  Every capsule is separately clickable with a system-theme-aware Matter brand outline on hover/focus;
  guarded `open-conversation` IPC carries only bounded conversation/turn IDs. The embedding desktop
  builds the trusted Matter route and focuses the current message using existing DOM anchors.
- core/seed.ts: new profiles use the Suit Duck, console port 17888, pet port 17897,
  remembered position, microphone off, telemetry off and automatic updates off.
  Existing profile files are preserved by the upstream seeder.
- core/companion.ts: MINDUCK_COMPANION_MANUAL_SETUP=1 suppresses automatic introduction
  and key-request bubbles. The explicit introduction action remains available in settings.
- desktop-pet/host/electron-main.cjs and preload.cjs: no eager microphone permission request at startup;
  Chromium requests it when voice input is enabled by the user. The guarded native pet IPC accepts only
  explicit Matter shortcuts (including bounded conversation targets) and forwards them to Minduck's parent-process bridge; no generic native API,
  destination URL or bridge credential is exposed to the renderer. A separate read-only `onMatterOutput`
  subscription delivers bounded status/text snapshots and restores the current output when the pet reopens.
- desktop-pet/web/figure-frame.js and web/minduck-thinking/: shared random idle thought-bubble
  effect for every API 2 body, with a direct quiet short-click trigger as well as random idle scheduling, using the user's original SVG bubble and six-second keyframes.
  The selected figure is preserved; work, movement, drag, dialogue and active model states
  take priority. The persistent thoughtShown preference does not block idle effects.
  The kit accepts reaction:false on pointer release to omit only the poke bounce/jump;
  drag/drop physics and capture are unchanged. Pointer entry no longer counts as a petting stroke. The effect uses only the host clock and retains the opaque sandbox policy.
- desktop-pet/web/minduck-activity.js: map normalized Matter work/ask/success/error inside the sandbox;
  loop finite work/ask, wait for complete animations before switching, recover the latest lifecycle
  after dragging, and deduplicate terminal cues. The kit exposes actual expression/gesture completion.
  Existing figure artwork and client/panel styles are unchanged.
- desktop-pet/web/minduck-recovery.js: preserve work/ask interrupted by carrying and resume only
  after the full landing/dizzy recovery reaches idle. Later commands replace/cancel the saved flow;
  naturally completed flows remain finite. No original character package is changed.
- desktop-pet/web/kit/body.js: active business states and success/failure expressions stop existing
  walking and prevent autonomous roaming; idle restores the user's configured roaming preference.

Minduck's adapter in src/companion/ starts and stops the upstream CoreHost, uses this
application's executable for the pet host, and serves the upstream settings console in its
own session. There is no second tray, login item, separate application install, or standalone
Coopanion self-updater. The pet's Exit action hides the pet rather than quitting Minduck.

The user's character package is under src/companion/figures/minduck-suit-duck. Its original
files are unchanged. The artwork has not been assigned a public license by this integration.

Build: pnpm run check:companion, pnpm start, or pnpm dist:mac at the project root.
The macOS package includes runtime/ and the figure pack outside app.asar, alongside the
upstream notices. Core and pet are child processes of this client and stop with it.
To update upstream, intentionally import a complete compatible distribution, review/reapply
the documented patches, update provenance/hashes, and run unit + real Electron smoke tests.
Do not copy user data, keys, logs or model downloads into this directory.
