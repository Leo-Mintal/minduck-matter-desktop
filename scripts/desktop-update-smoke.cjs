// Real updater HTTP/integrity and renderer tests; native installation is stubbed.
// This probe never modifies an installed app or uses its user-data directory.
const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const crypto = require('node:crypto')
const fs = require('node:fs')
const http = require('node:http')
const os = require('node:os')
const path = require('node:path')
const Module = require('node:module')
const electron = require('electron')
const { MacUpdater } = require('electron-updater')
const { ElectronHttpExecutor } = require('electron-updater/out/electronHttpExecutor')
const { createDesktopUpdater } = require('../src/desktopUpdater.cjs')

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'minduck-updater-smoke-'))
const previews = fs.mkdtempSync(path.join(os.tmpdir(), 'minduck-updater-previews-'))
electron.app.setPath('userData', path.join(temporary, 'profile'))
const version = require('../package.json').version
const nextVersion = version.replace(/\d+$/, value => String(Number(value) + 1))
const filename = `MinduckMatter-${nextVersion}-arm64.zip`
const bytes = crypto.randomBytes(128 * 1024)
const releaseNotes = '- 新增：更新说明。\n- 修复：桌宠点击抖动。'
const info = { version: nextVersion, releaseNotes, files: [{ url: filename, size: bytes.length,
  sha512: crypto.createHash('sha512').update(bytes).digest('base64') }] }
const logger = { info() {}, warn() {}, error() {}, debug() {} }
const server = http.createServer((request, response) => {
  const url = new URL(request.url, 'http://localhost')
  if (url.pathname.endsWith('/latest-mac.yml')) {
    response.writeHead(200, { 'content-type': 'application/yaml' }); response.end(JSON.stringify(info)); return
  }
  if (url.pathname.endsWith(`/${filename}`)) {
    const body = Buffer.from(bytes)
    if (url.pathname.startsWith('/corrupt/')) body[0] ^= 255
    response.writeHead(200, { 'content-type': 'application/zip', 'content-length': body.length })
    response.end(body); return
  }
  response.writeHead(404); response.end()
})

async function verifyDownload(mode) {
  const directory = path.join(temporary, mode)
  fs.mkdirSync(directory, { recursive: true })
  const config = path.join(directory, 'app-update.yml')
  fs.writeFileSync(config, 'updaterCacheDirName: fixture-updater\n')
  const lifecycle = [], native = new EventEmitter()
  let feed
  native.setFeedURL = options => { feed = options }
  native.checkForUpdates = () => {
    lifecycle.push('native')
    void (async () => {
      const manifest = await (await electron.net.fetch(feed.url, { headers: feed.headers })).json()
      assert.ok(manifest.url.startsWith('http://127.0.0.1:'))
      const payload = Buffer.from(await (await electron.net.fetch(manifest.url)).arrayBuffer())
      assert.deepEqual(payload, bytes, 'native handoff receives the checksum-verified bytes')
      native.emit('update-downloaded')
    })().catch(error => native.emit('error', error))
  }
  native.quitAndInstall = () => lifecycle.push('install')
  const load = Module._load
  const fakeElectron = Object.create(electron)
  Object.defineProperty(fakeElectron, 'autoUpdater', { value: native })
  let updater
  try {
    Module._load = function (request, ...args) {
      return request === 'electron' ? fakeElectron : load.call(this, request, ...args)
    }
    updater = new MacUpdater(undefined, { version, name: 'Fixture', isPackaged: true,
      appUpdateConfigPath: config, baseCachePath: directory, userDataPath: directory,
      whenReady: () => electron.app.whenReady() })
  } finally { Module._load = load }
  updater.httpExecutor = new ElectronHttpExecutor()
  updater.setFeedURL({ provider: 'generic', url: `http://127.0.0.1:${server.address().port}/${mode}/` })
  updater.autoDownload = false; updater.autoInstallOnAppQuit = false
  updater.disableDifferentialDownload = true; updater.logger = logger
  const dialogs = []
  const controller = createDesktopUpdater({ updater, nativeUpdater: native, currentVersion: version, logger,
    showDialog: async options => { dialogs.push(options); return { response: options.defaultId ?? 0 } },
    prepareToQuit: async () => lifecycle.push('stop') })
  try {
    await controller.run()
    const confirmation = dialogs.find(item => item.title === '发现新版本')
    assert.ok(confirmation.detail.includes(releaseNotes), 'real HTTP feed notes reach the update dialog')
    assert.equal(confirmation.defaultId, 0)
    if (mode === 'corrupt') {
      assert.equal(controller.snapshot().phase, 'error')
      assert.deepEqual(lifecycle, [], 'checksum failure never reaches native installation or child shutdown')
    } else {
      assert.equal(controller.snapshot().phase, 'installing')
      assert.deepEqual(lifecycle, ['native', 'stop', 'install'])
    }
    assert.ok(!fs.existsSync(path.join(directory, 'fixture-updater', 'update.zip')),
      'differential download does not retain an extra previous ZIP')
  } finally { updater.closeServerIfExists() }
}

async function verifyInterface() {
  let update = { phase: 'idle' }, theme = 'dark'
  const state = () => ({ theme, rightPanelOpen: false, navigation: {}, update })
  electron.ipcMain.handle('desktop-frame:get-state', state)
  const window = new electron.BrowserWindow({ show: false, width: 1024, height: 360,
    webPreferences: { offscreen: true, backgroundThrottling: false, sandbox: true, contextIsolation: true,
      preload: path.resolve(__dirname, '../src/desktop-frame-preload.cjs') } })
  try {
    await window.loadFile(path.resolve(__dirname, '../src/desktop-frame.html'))
    for (theme of ['dark', 'light']) {
      for (const width of [375, 768, 1024, 1440]) {
        window.setContentSize(width, 360)
        for (const phase of ['checking', 'available', 'downloading', 'downloaded', 'preparing', 'installing', 'error']) {
          update = { phase, version: nextVersion, percent: 100, available: true, error: phase === 'error' }
          window.webContents.send('desktop-frame:state', state())
          const result = await window.webContents.executeJavaScript(`new Promise(resolve => requestAnimationFrame(() => {
            const button = document.querySelector('#check-update'), progress = document.querySelector('#update-progress');
            const bounds = button.getBoundingClientRect(), value = progress.getBoundingClientRect();
            resolve({ phase: button.dataset.phase, disabled: button.getAttribute('aria-disabled') === 'true',
              focusable: !button.disabled && button.tabIndex === 0, label: button.title,
              progress: progress.getAttribute('aria-valuenow'), text: progress.textContent.trim(),
              offset: progress.querySelector('.update-progress-value').getAttribute('stroke-dashoffset'),
              visible: !progress.hidden,
              clipped: value.left < bounds.left || value.right > bounds.right,
              overflow: document.documentElement.scrollWidth > innerWidth });
          }))`)
          assert.equal(result.phase, phase)
          assert.equal(result.disabled, ['checking', 'downloading', 'preparing', 'installing'].includes(phase))
          assert.equal(result.focusable, true)
          assert.ok(!result.overflow, JSON.stringify(result))
          if (phase === 'downloading') {
            assert.equal(result.progress, '100')
            assert.equal(result.text, '')
            assert.equal(result.offset, '0')
            assert.equal(result.label, '正在下载 100%')
            assert.ok(result.visible && !result.clipped)
            if (width === 375) fs.writeFileSync(path.join(previews, `progress-${theme}.png`),
              (await window.webContents.capturePage()).toPNG())
          }
          if (phase === 'error') assert.ok(result.label.includes('重试'))
        }
      }
    }
  } finally { window.destroy(); electron.ipcMain.removeHandler('desktop-frame:get-state') }
}

async function main() {
  await electron.app.whenReady()
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  await verifyDownload('good')
  await verifyDownload('corrupt')
  await verifyInterface()
  console.log('PASS actual MacUpdater HTTP download, SHA-512 rejection, authenticated native handoff and no differential ZIP copy')
  console.log('PASS update states at 375/768/1024/1440px in light/dark; native OS installation remains stubbed')
  console.log('UI previews:', previews)
}

const timeout = setTimeout(() => { console.error('Updater smoke timed out'); electron.app.exit(1) }, 45_000)
main().catch(error => { console.error(error); process.exitCode = 1 }).finally(() => {
  clearTimeout(timeout); server.close()
  fs.rmSync(temporary, { recursive: true, force: true })
  electron.app.exit(process.exitCode || 0)
})
