# Minduck Matter Chromium Prototype

This is an Apple Silicon macOS prototype that hosts the existing Matter Browser
and Xiaohongshu extensions in a standalone Chromium profile. It does not use
the user's Google Chrome profile or modify either extension.

## Development

From the repository root:

```bash
pnpm chromium:download
pnpm chromium:smoke
pnpm chromium:start
```

`chromium:download` fetches an official Chromium snapshot into `vendor/`.
`chromium:smoke` verifies that the unchanged Matter Browser extension receives
the `tabs`, `scripting`, `debugger`, and `tabGroups` APIs from that runtime.
`chromium:start` launches that copy with an isolated profile and these unpacked
extensions:

- `../extensions/matter-browser`
- `../extensions/xiaohongshu`

Matter opens at `http://localhost:3001`. Start the local Matter service before
launching the browser.

## Configuration

- `MINDUCK_CHROMIUM_BINARY`: use a specific Chromium executable instead of the
  downloaded runtime.
- `MINDUCK_CHROMIUM_APP`: use a specific `Chromium.app` bundle.
- `MINDUCK_CHROMIUM_PROFILE`: override the isolated browser profile directory.
- `MINDUCK_MATTER_ORIGIN`: override the initial Matter HTTP(S) URL.
- `MINDUCK_CHROMIUM_REVISION`: download a specific Chromium snapshot revision.

The runtime never falls back to `/Applications/Google Chrome.app`; it remains a
separate browser with its own cookies, login state, and extension storage.

## macOS Package

```bash
pnpm chromium:dist:mac
```

The command creates an unsigned `Minduck Matter Chromium.app` and DMG under
`minduck-matter-chromium/release/`. The extension folders are copied verbatim
into the application bundle and loaded with Chromium's normal extension runtime.

## Scope

This is a packaging and compatibility prototype, not a maintained Chromium
source fork. Production distribution needs a fixed reviewed Chromium revision,
code signing and notarization, an update strategy, and browser regression tests.
