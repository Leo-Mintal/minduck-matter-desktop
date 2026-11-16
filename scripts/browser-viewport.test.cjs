const assert = require('node:assert/strict')
const test = require('node:test')
const { EventEmitter } = require('node:events')
const { BrowserViewport, fitPageScale, browserInputParams } = require('../src/browserViewport.cjs')

test('fits overflowing pages while retaining native viewport geometry', () => {
  assert.equal(fitPageScale(1, { viewportWidth: 380, clientWidth: 365, contentWidth: 1200 }, 380), 0.312)
  assert.equal(fitPageScale(0.5, { viewportWidth: 760, clientWidth: 730, contentWidth: 1200 }, 380), 0.308)
  assert.equal(fitPageScale(1, { viewportWidth: 380, clientWidth: 380, contentWidth: 380 }, 380), 1)
  assert.equal(fitPageScale(1, { viewportWidth: 380, clientWidth: 380, contentWidth: 381 }, 380), 1)
})

test('converts mouse and wheel coordinates without changing page or keyboard commands', () => {
  const contents = new EventEmitter()
  const viewport = new BrowserViewport({ webContents: contents })
  viewport.scale = 0.5
  const params = { type: 'mouseWheel', x: 120, y: 80, deltaX: 10, deltaY: 400, button: 'none' }
  assert.deepEqual(browserInputParams(contents, 'Input.dispatchMouseEvent', params),
    { type: 'mouseWheel', x: 60, y: 40, deltaX: 5, deltaY: 200, button: 'none' })
  assert.equal(params.x, 120)
  assert.equal(browserInputParams(contents, 'Page.captureScreenshot', params), params)
  assert.equal(browserInputParams(contents, 'Input.dispatchKeyEvent', params), params)
  assert.equal(browserInputParams({}, 'Input.dispatchMouseEvent', params), params)
})

test('ignores stale, invalid and parent-sized offscreen viewport measurements', () => {
  assert.equal(fitPageScale(1, { viewportWidth: 1280, clientWidth: 1280, contentWidth: 1800 }, 380), 1)
  assert.equal(fitPageScale(0.5, { viewportWidth: 380, clientWidth: 365, contentWidth: 1200 }, 380), 0.5)
  for (const metrics of [undefined, {}, { viewportWidth: 380, clientWidth: 0, contentWidth: 1200 },
    { viewportWidth: 380, clientWidth: 365, contentWidth: Infinity }]) assert.equal(fitPageScale(1, metrics, 380), 1)
})
