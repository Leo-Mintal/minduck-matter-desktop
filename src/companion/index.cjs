const path = require('node:path')
const { mkdirSync } = require('node:fs')
const electron = require('electron')
const { assertRuntime, hostCommand, runtimeRoot } = require('./runtime.cjs')
const { createCompanionSettings } = require('./settings.cjs')
const { createMatterActionBridge } = require('./matter-actions.cjs')

function createCompanion(options = {}) {
  const { app, session } = electron
  const root = options.runtimeRoot ?? runtimeRoot(app)
  assertRuntime(root)
  const dataDir = options.dataDir ?? path.join(app.getPath('userData'), 'companion')
  mkdirSync(path.join(dataDir, 'tmp'), { recursive: true })
  const { CoreHost } = require(path.join(root, 'app/core-host.cjs'))
  const environment = {
    ...process.env, CORTICO_HOME: path.join(dataDir, 'home'),
    CORTICO_EXTENSIONS_DIR: path.join(dataDir, 'extensions'),
    CORTICO_SUPERVISED: '1', CORTICO_START_PAUSED: '0',
    CORTICO_DESKTOP_PET_HOST: JSON.stringify(options.hostCommand ?? hostCommand(app, root, dataDir)),
    CORTICO_NODE_EXE: process.execPath, CORTICO_PNPM_CJS: path.join(root, 'node_modules/pnpm/bin/pnpm.cjs'),
    COOPANION_VERSION: '0.2.16', COOPANION_SELF_UPDATE: '0', COOPANION_SYSTEM_LANGUAGE: 'zh',
    COOPANION_AUTOSTART: '0', MINDUCK_COMPANION_MANUAL_SETUP: '1',
    COOPANION_PACK_ROOTS: app.isPackaged
      ? path.join(process.resourcesPath, 'companion-figures') : path.join(__dirname, 'figures'),
    PATH: [path.join(root, 'app/shims'), process.env.PATH ?? ''].join(path.delimiter),
    TMPDIR: path.join(dataDir, 'tmp'), TEMP: path.join(dataDir, 'tmp'), TMP: path.join(dataDir, 'tmp'),
    pnpm_config_store_dir: path.join(dataDir, 'pnpm/store'),
    pnpm_config_cache_dir: path.join(dataDir, 'pnpm/cache'),
    pnpm_config_state_dir: path.join(dataDir, 'pnpm/state'),
  }
  const core = new CoreHost({ appRoot: root, logDir: path.join(dataDir, 'logs'),
    resolveProxy: (url) => session.defaultSession.resolveProxy(url), env: environment })
  let language = 'zh'
  let stopped = false
  const actions = createMatterActionBridge(options.onMatterAction ?? (() => {}))

  async function start() {
    if (stopped) return
    Object.assign(environment, await actions.start())
    await core.start()
  }

  async function panel(method, args = []) {
    if (!core.port) return null
    const url = `http://127.0.0.1:${core.port}/api/webui/providers/world%3Adesktop-pet/panels/pet/${method}`
    const response = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ args }), signal: AbortSignal.timeout(5000) })
    if (!response.ok) throw new Error(`桌宠接口 ${method} 返回 ${response.status}`)
    return response.json()
  }

  const settings = createCompanionSettings({ electron, root, core, panel, getLanguage: () => language })
  core.on('ready', (state) => { language = state.language ?? language; settings.load() })
  core.on('language', (next) => { language = next; settings.load() })
  core.on('open', (route) => settings.open(route))
  core.on('hide', () => settings.close())
  // The pet's Exit action closes the integrated pet, leaving the host client running.
  core.on('quit', () => { void panel('closeWindow').catch(console.error); settings.close() })
  core.on('state', (state, detail) => {
    if (state === 'failed') console.error('Companion core failed:', detail)
  })
  core.on('browse', (url) => { if (url.startsWith('https://auth.openai.com/')) void electron.shell.openExternal(url) })

  async function show() {
    if (stopped) return
    if (core.state === 'failed' || core.state === 'stopped') { await start(); return }
    const state = await panel('state')
    if (!state?.connected || !state?.onDesktop) {
      await panel('closeWindow')
      await panel('openWindow')
    }
  }

  async function stop() {
    if (stopped) return
    stopped = true
    settings.dispose()
    try { await core.stop(4000) } finally { await actions.stop() }
  }

  return { start, show, hide: () => panel('closeWindow'), stop,
    setTaskOutput: (output) => actions.setOutput(output),
    openSettings: (route) => {
      settings.open(route)
      if (core.state === 'failed' || core.state === 'stopped') void start().catch(console.error)
    },
    status: () => ({ state: core.state, port: core.port, dataDir }), panel,
    getSettingsWindow: settings.getWindow }
}

module.exports = { createCompanion }
