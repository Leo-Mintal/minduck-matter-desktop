const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const vm = require('node:vm')

function fixture() {
  let now = 1000
  class BaseWindow extends EventEmitter {
    constructor(options) {
      super()
      this.bounds = options
      this.contentView = { addChildView() {} }
      this.changes = 0
    }
    setBounds(bounds) { this.bounds = bounds; this.changes++ }
  }
  class WebContentsView {
    constructor() { this.webContents = { isDestroyed: () => false, close: () => { this.closed = true } } }
    setBackgroundColor() {}
    setBounds(bounds) { this.bounds = bounds }
  }
  const module = { exports: {} }
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname,
    '../vendor/coopanion/runtime/node_modules/cortico-world-desktop-pet/host/content-window.cjs'), 'utf8'), {
    module, require: () => ({ BaseWindow, WebContentsView }), Date: { now: () => now },
  })
  const win = new module.exports.ContentWindow({ x: 100, y: 30, width: 1400, height: 900 })
  return { win, contentBounds: module.exports.contentBounds, tick: () => { now += 300 } }
}

test('native pet envelope shrinks without changing the display-sized renderer or global content position', () => {
  const { win } = fixture()
  win.fitContent({ x: 1000, y: 650, width: 240, height: 230 })
  assert.equal(win.view.bounds.width, 1400)
  assert.equal(win.view.bounds.height, 900)
  assert.equal(win.bounds.width, 272)
  assert.equal(win.bounds.height, 262)
  assert.equal(win.bounds.x + win.view.bounds.x, 100)
  assert.equal(win.bounds.y + win.view.bounds.y, 30)
  for (let i = 0; i < 60; i++) win.fitContent({ x: 1001 + Math.sin(i), y: 651, width: 240, height: 230 })
  assert.equal(win.changes, 1, 'breathing inside the effect margin must not resize a native window')
})

test('opening a QA expands immediately and closing it shrinks after settling', () => {
  const { win, tick } = fixture()
  const idle = { x: 1000, y: 650, width: 240, height: 230 }
  win.fitContent(idle)
  win.fitContent({ x: 900, y: 300, width: 400, height: 580 })
  assert.equal(win.bounds.width, 432)
  assert.equal(win.bounds.height, 612)
  win.fitContent(idle)
  assert.equal(win.bounds.height, 612)
  tick()
  win.fitContent(idle)
  assert.equal(win.bounds.height, 262)
})

test('moving to a negative-origin or smaller display updates only scene origin and size', () => {
  const { win } = fixture()
  win.fitContent({ x: 1000, y: 650, width: 240, height: 230 })
  win.setSceneBounds({ x: -800, y: -600, width: 800, height: 550 })
  assert.equal(win.view.bounds.width, 800)
  assert.equal(win.view.bounds.height, 550)
  assert.ok(win.bounds.x >= -800 && win.bounds.x + win.bounds.width <= 0)
  assert.ok(win.bounds.y >= -600 && win.bounds.y + win.bounds.height <= -50)
  assert.equal(win.bounds.x + win.view.bounds.x, -800)
  assert.equal(win.bounds.y + win.view.bounds.y, -600)
  win.emit('closed')
  assert.equal(win.view.closed, true, 'closing BaseWindow must close its renderer')
})

test('untrusted content envelopes cannot move the native window outside its display', () => {
  const { win } = fixture()
  for (const rect of [null, {}, { x: NaN, y: 0, width: 5, height: 5 },
    { x: 0, y: 0, width: Infinity, height: 10 }, { x: 0, y: 0, width: -1, height: 10 },
    { x: 9999, y: 0, width: 5, height: 5 }]) win.fitContent(rect)
  assert.equal(win.changes, 0)
  win.fitContent({ x: -100, y: -100, width: 2000, height: 2000 })
  assert.equal(win.bounds.x, 100)
  assert.equal(win.bounds.y, 30)
  assert.equal(win.bounds.width, 1400)
  assert.equal(win.bounds.height, 900)
})
