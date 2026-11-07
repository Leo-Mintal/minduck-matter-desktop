const test = require('node:test')
const assert = require('node:assert/strict')
const {
  CLOSED_PANEL_BUTTON_INSET,
  MATTER_TOP_INSET,
  matterContentBounds,
  rightPanelLayout,
  TOOLBAR_HEIGHT,
  PANEL_RESIZER_WIDTH,
} = require('../src/rightPanelLayout.cjs')

test('closed panel gives Matter the whole window and keeps the opener outside the drag region', () => {
  const layout = rightPanelLayout(1280, 800, false)
  assert.deepEqual(layout.matter, { x: 0, y: 0, width: 1280, height: 800 })
  assert.equal(layout.browser, null)
  assert.equal(layout.panel, null)
  assert.equal(layout.resizer, null)
  assert.deepEqual(layout.dragRegion, { x: 0, y: 0, width: 1212, height: MATTER_TOP_INSET })
  assert.equal(layout.shell.y, CLOSED_PANEL_BUTTON_INSET)
})

test('leaves 12px below native window controls without reducing the Matter frame', () => {
  assert.equal(MATTER_TOP_INSET, 36, '24px native controls plus a 12px content gap')
  const layout = rightPanelLayout(1280, 800, false)
  assert.deepEqual(matterContentBounds(layout.matter), {
    x: 0,
    y: MATTER_TOP_INSET,
    width: 1280,
    height: 800 - MATTER_TOP_INSET,
  })
  assert.deepEqual(matterContentBounds({ x: 0, y: 0, width: 1280, height: 32 }), {
    x: 0,
    y: 32,
    width: 1280,
    height: 0,
  })
})

test('uses the Web panel default width and an adjacent one-pixel divider without a transparent gap', () => {
  const layout = rightPanelLayout(1280, 800, true)
  assert.deepEqual(layout.panel, { x: 896, y: 0, width: 384, height: 800 })
  assert.equal(layout.matter.x + layout.matter.width, layout.panel.x)
  assert.equal(layout.browser.x, layout.panel.x + 1)
  assert.equal(layout.browser.width, 383)
  assert.equal(layout.browser.y, TOOLBAR_HEIGHT)
  assert.equal(layout.browser.y + layout.browser.height, 800)
  assert.equal(layout.resizer.y, 0)
  assert.equal(layout.resizer.x + Math.floor(PANEL_RESIZER_WIDTH / 2), layout.panel.x)
  assert.equal(layout.shell.width, layout.panel.width)
  assert.equal(layout.shell.y, 0)
})

test('uses persisted widths within the Web reserve and maximum ratio at common desktop sizes', () => {
  for (const width of [960, 1024, 1280, 1440]) {
    const manual = rightPanelLayout(width, 800, true, 640)
    assert.equal(manual.panel.width, Math.min(640, width - 300))
    assert.equal(manual.matter.width + manual.panel.width, width)
    assert.equal(rightPanelLayout(width, 800, true, 120).panel.width, 380)
    assert.equal(rightPanelLayout(width, 800, true, 9999).panel.width, Math.min(Math.round(width * 0.82), width - 300))
  }
})

test('consumes resolved Web geometry instead of relying on startup values', () => {
  const metrics = { toolbarHeight: 117, resizeHitWidth: 13, panelMin: 400, panelDefault: 410, panelReserve: 350, panelMaxRatio: 0.7 }
  const layout = rightPanelLayout(1280, 800, true, undefined, metrics)
  assert.equal(layout.panel.width, 410)
  assert.equal(layout.shell.height, 117)
  assert.equal(layout.browser.y, 117)
  assert.equal(layout.resizer.width, 13)
  assert.equal(rightPanelLayout(1280, 800, true, 9999, metrics).panel.width, 896)
  assert.equal(rightPanelLayout(1280, 60, true, 410, metrics).browser.height, 0)
})
