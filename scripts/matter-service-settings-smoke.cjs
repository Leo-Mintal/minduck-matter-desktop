const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const interactive = process.argv.includes('--interactive')

if (!process.versions.electron) {
  const result = spawnSync(require('electron'), [__filename, ...(interactive ? ['--interactive'] : [])], {
    stdio: 'inherit', timeout: interactive ? 300_000 : 30_000,
  })
  if (result.error) console.error(result.error)
  process.exit(result.status ?? 1)
}
const { app, BrowserWindow, Menu, nativeTheme } = require('electron')
const nativeModule = require('../build/desktop-access/desktop-access.node')
const { createMatterServiceSettings } = require('../src/matterServiceSettings.cjs')
const { DEFAULT_MATTER_ORIGIN } = require('../src/matterService.cjs')
const { defaultDesktopSettings, saveDesktopSettings, loadDesktopSettings } = require('../src/desktopSettings.cjs')
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'matter-native-settings-'))
app.setPath('userData', temporary)
app.setName('Matter 原生设置验证')
app.on('window-all-closed', () => {})
const wait = ms => new Promise(resolve => setTimeout(resolve, ms))

async function run() {
  await app.whenReady()
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { role: 'appMenu' }, { role: 'editMenu' },
  ]))
  let window, restarts = 0, ticks = 0
  const state = { defaultOrigin: DEFAULT_MATTER_ORIGIN, configuredOrigin: 'http://192.168.11.70:8080',
    effectiveOrigin: 'http://192.168.11.70:8080', environmentOrigin: null }
  const controller = createMatterServiceSettings({ app, nativeModule, getWindow: () => window,
    getState: () => state, dialog: { showErrorBox(_title, error) { throw new Error(error) } },
    saveOrigin(origin) {
      saveDesktopSettings(temporary, { ...defaultDesktopSettings(), matterOrigin: origin })
      assert.equal(loadDesktopSettings(temporary).matterOrigin, origin === null ? null : new URL(origin.trim()).origin)
      state.configuredOrigin = loadDesktopSettings(temporary).matterOrigin
      console.log('SAVED', state.configuredOrigin)
    }, restart() { restarts++; console.log('RESTART', restarts) } })
  const timer = setInterval(() => { ticks++ }, 20)
  try {
    controller.show(); controller.show()
    assert.equal(BrowserWindow.getAllWindows().length, 0, 'standalone native settings must not create an HTML window')
    assert.throws(() => nativeModule.openServiceSettings('', '', true, null), { code: 'prompt_already_open' })
    await wait(200)
    assert.equal(nativeModule.pollServiceSettings(), null)
    controller.close()
    window = new BrowserWindow({ width: 800, height: 650, title: 'Matter 原生设置验证',
      webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false } })
    await window.loadURL('data:text/html,<title>Matter 原生设置验证</title>')
    for (const theme of ['light', 'dark']) {
      nativeTheme.themeSource = theme
      state.environmentOrigin = 'https://managed.example.com'
      controller.show(); await wait(150); controller.close()
      state.environmentOrigin = null
    }
    controller.show()
    if (interactive) {
      console.log('READY', process.pid)
      const deadline = Date.now() + 240_000
      while (restarts < 2 && Date.now() < deadline) {
        await wait(100)
        if (restarts === 1) controller.show()
      }
      assert.equal(restarts, 2, 'save and reset must both complete through real native actions')
      assert.equal(loadDesktopSettings(temporary).matterOrigin, null)
    } else await wait(250)
    assert.equal(BrowserWindow.getAllWindows().length, 1, 'native settings must reuse the parent window')
    assert.ok(ticks > 10, 'native settings must not block Electron timers')
    console.log('PASS: native standalone/sheet settings, light/dark appearance, environment lock and event loop', { interactive, restarts, ticks })
  } finally {
    clearInterval(timer)
    controller.close()
    nativeTheme.themeSource = 'system'
    window?.destroy()
    app.quit()
  }
}

void run().catch((error) => {
  console.error(error)
  process.exitCode = 1
  app.quit()
}).finally(() => fs.rmSync(temporary, { recursive: true, force: true }))
