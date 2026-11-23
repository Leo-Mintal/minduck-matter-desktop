const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const vm = require('node:vm')

const host = path.resolve(__dirname, '../vendor/coopanion/runtime/node_modules/cortico-world-desktop-pet/host')
const plain = value => JSON.parse(JSON.stringify(value))

async function fixture() {
  const app = new EventEmitter(), screen = new EventEmitter(), ipcMain = new EventEmitter()
  const primary = { id: 1, scaleFactor: 2, workArea: { x: 0, y: 25, width: 1440, height: 850 },
    bounds: { x: 0, y: 0, width: 1440, height: 900 } }
  const secondary = { id: 2, scaleFactor: 1, workArea: { x: -900, y: -575, width: 900, height: 550 },
    bounds: { x: -900, y: -600, width: 900, height: 600 } }
  let displays = [primary, secondary], point = { x: 500, y: 700 }, win
  const intervals = [], handlers = new Map(), sent = []
  app.whenReady = () => Promise.resolve()
  app.dock = { hide() {} }
  screen.getAllDisplays = () => displays
  screen.getPrimaryDisplay = () => primary
  screen.getDisplayMatching = rect => rect.x < 0 ? secondary : primary
  screen.getDisplayNearestPoint = pt => pt.x < 0 ? secondary : primary
  ipcMain.handle = (channel, handler) => handlers.set(channel, handler)
  class BrowserWindow extends EventEmitter {
    constructor(options) {
      super(); win = this; this.options = options; this.visible = false; this.changes = []
      this.bounds = { x: options.x, y: options.y, width: options.width, height: options.height }
      this.webContents = new EventEmitter()
      Object.assign(this.webContents, { setWindowOpenHandler() {}, setZoomLevel() {},
        send: (channel, value) => sent.push([channel, value]) })
    }
    getBounds() { return this.bounds }
    setBounds(bounds) { this.bounds = plain(bounds); this.changes.push(this.bounds) }
    setAlwaysOnTop(...args) { this.top = args }
    setVisibleOnAllWorkspaces(...args) { this.spaces = args }
    setIgnoreMouseEvents(on) { this.ignoreMouse = on }
    isVisible() { return this.visible }
    showInactive() { this.visible = true; this.emit('show') }
    loadURL(url) { this.url = url }
  }
  const module = { exports: {} }
  const electron = { app, screen, ipcMain, BrowserWindow, session: { defaultSession: {
    setPermissionRequestHandler() {}, setPermissionCheckHandler() {},
  } } }
  vm.runInNewContext(fs.readFileSync(path.join(host, 'electron-main.cjs'), 'utf8'), {
    module, __dirname: host, __filename: path.join(host, 'electron-main.cjs'), URL, URLSearchParams, Buffer,
    process: { platform: 'darwin', argv: [] },
    setInterval: (callback, ms) => { const timer = { callback, ms }; intervals.push(timer); return timer },
    clearInterval: timer => { if (timer) timer.cleared = true },
    require(id) {
      if (id === 'electron') return electron
      if (id === './cursor.cjs') return { createCursorSource: () => ({ read: () => point, close() {} }) }
      if (id === './overlay.cjs') return { createOverlaySource: () => ({ stop() {}, pageLoaded() {}, frame() {} }) }
      if (id === './windows.cjs') return { createWindowSource: () => ({ available: false }) }
      if (id === './mouse-lease.cjs' || id.startsWith('node:')) return require(id.startsWith('./') ? path.join(host, id) : id)
      throw new Error('Unexpected native surface dependency: ' + id)
    },
  })
  module.exports.runPetHost({ url: 'http://127.0.0.1:17897/pet#key=test', tray: false })
  await new Promise(resolve => setImmediate(resolve))
  const event = () => ({ sender: win.webContents, senderFrame: { url: win.url } })
  return { win, screen, ipcMain, primary, secondary, sent, intervals,
    invoke: channel => handlers.get(channel)(event()),
    emit: (channel, ...args) => ipcMain.emit(channel, event(), ...args),
    point: value => { point = value }, displays: value => { displays = value } }
}

test('macOS pet uses one transparent work-area BrowserWindow at rest and throughout renderer updates', async () => {
  const f = await fixture(), { win, primary } = f
  assert.deepEqual(plain(win.getBounds()), primary.workArea)
  assert.equal(win.options.transparent, true)
  assert.equal(win.options.backgroundColor, '#00000000')
  assert.equal(win.options.frame, false)
  assert.equal(win.options.hasShadow, false)
  assert.equal(win.options.webPreferences.backgroundThrottling, false)
  assert.deepEqual(win.top, [true, 'floating'])
  assert.deepEqual(plain(win.spaces), [true, { visibleOnFullScreen: true, skipTransformProcessType: true }])
  assert.equal(win.ignoreMouse, true)
  win.emit('ready-to-show')
  assert.equal(win.isVisible(), true, 'show the native window without taking keyboard focus')
  const count = win.changes.length
  for (let i = 0; i < 120; i++) f.emit('pet:contentBounds', { x: i, y: i, width: 300, height: 200, moving: i < 60 })
  assert.equal(f.ipcMain.listenerCount('pet:contentBounds'), 0, 'renderer content cannot resize or move the native surface')
  assert.equal(win.changes.length, count)
  assert.deepEqual(plain(win.getBounds()), primary.workArea)
})

test('display migration, work-area changes and removal use native screen coordinates', async () => {
  const f = await fixture()
  f.point({ x: -600, y: -400 })
  assert.deepEqual(plain(f.invoke('pet:followCursor')), { x: 300, y: 175, w: 900, h: 550, dx: 900, dy: 600 })
  assert.deepEqual(f.win.getBounds(), f.secondary.workArea)
  assert.equal(f.invoke('pet:followCursor'), null, 'moving inside one display leaves the native window fixed')
  f.secondary.workArea.height = 500
  f.screen.emit('display-metrics-changed')
  assert.deepEqual(f.win.getBounds(), f.secondary.workArea)
  f.displays([f.primary])
  f.screen.emit('display-removed')
  assert.deepEqual(f.win.getBounds(), f.primary.workArea)
})

test('cursor hit testing and guarded click-through leases retain the full work-area origin', async () => {
  const f = await fixture()
  f.win.emit('ready-to-show')
  f.intervals.find(timer => timer.ms === 100).callback()
  assert.deepEqual(plain(f.sent.findLast(([channel]) => channel === 'pet:cursor')[1]), { x: 500, y: 675 })
  f.emit('pet:interactive', true)
  assert.equal(f.win.ignoreMouse, false)
  f.emit('pet:interactive', false)
  f.ipcMain.emit('pet:interactive', { sender: {}, senderFrame: { url: f.win.url } }, true)
  assert.equal(f.win.ignoreMouse, true, 'foreign renderers cannot capture screen clicks')
  f.point({ x: -1, y: 700 })
  f.intervals.find(timer => timer.ms === 100).callback()
  assert.equal(f.sent.findLast(([channel]) => channel === 'pet:cursor')[1], null)
  f.win.emit('closed')
  assert.ok(f.intervals.every(timer => timer.cleared), 'closing the window stops native cursor polling')
})

test('sandbox preload exposes no content-window geometry API', () => {
  let api
  vm.runInNewContext(fs.readFileSync(path.join(host, 'preload.cjs'), 'utf8'), {
    require: () => ({ contextBridge: { exposeInMainWorld: (_name, value) => { api = value } }, ipcRenderer: {} }),
  })
  assert.equal(api.fitContent, undefined)
  assert.equal(typeof api.setInteractive, 'function')
  assert.equal(typeof api.followCursor, 'function')
  assert.equal(typeof api.overlayFrame, 'function')
})
