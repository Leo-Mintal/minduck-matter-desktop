const test = require('node:test')
const assert = require('node:assert/strict')
const {
  FRAME_RAIL_WIDTH, FRAME_EDGE, FRAME_GAP, MATTER_TOP_INSET, matterContentBounds,
  rightPanelLayout, TOOLBAR_HEIGHT, PANEL_RESIZER_WIDTH,
} = require('../src/rightPanelLayout.cjs')

test('closed browser leaves a fixed icon rail and gray frame around Matter', () => {
  const layout = rightPanelLayout(1280, 800, false)
  assert.equal(FRAME_EDGE, 4)
  assert.equal(FRAME_RAIL_WIDTH, 49)
  assert.equal(MATTER_TOP_INSET, 36)
  assert.deepEqual(layout.matter, { x: FRAME_RAIL_WIDTH, y: MATTER_TOP_INSET, width: 1227, height: 760 })
  assert.equal(1280 - layout.matter.x - layout.matter.width, 4)
  assert.equal(800 - layout.matter.y - layout.matter.height, 4)
  assert.equal(layout.browser, null)
  assert.equal(layout.panel, null)
  assert.equal(layout.resizer, null)
  assert.ok(layout.dragRegion.x >= 188, 'drag surface avoids native traffic lights and page-navigation buttons')
  assert.ok(layout.dragRegion.x + layout.dragRegion.width < layout.shell.x, 'right toggle remains clickable')
  assert.deepEqual(matterContentBounds(layout.matter), layout.matter, 'no second titlebar inset inside content')
})

test('joined native content shares top and bottom with a one-pixel seam', () => {
  const layout = rightPanelLayout(1280, 800, true)
  assert.equal(FRAME_GAP, 1)
  assert.deepEqual(layout.panel, { x: 892, y: 36, width: 384, height: 760 })
  assert.equal(1280 - layout.panel.x - layout.panel.width, 4)
  assert.equal(800 - layout.panel.y - layout.panel.height, 4)
  assert.equal(layout.matter.x + layout.matter.width + FRAME_GAP, layout.panel.x)
  assert.equal(layout.matter.y, layout.panel.y)
  assert.equal(layout.matter.height, layout.panel.height)
  assert.equal(layout.browser.x, layout.panel.x)
  assert.equal(layout.browser.width, layout.panel.width)
  assert.equal(layout.browser.y, TOOLBAR_HEIGHT)
  assert.equal(layout.browser.y + layout.browser.height, 800 - FRAME_EDGE)
  assert.equal(layout.resizer.width, PANEL_RESIZER_WIDTH)
  assert.equal(layout.resizer.y, layout.panel.y)
  assert.equal(layout.shell.y, 0, 'browser tabs share the native titlebar')
  assert.equal(layout.shell.y + MATTER_TOP_INSET, layout.matter.y, 'navigation and Matter start on the same row')
  assert.ok(layout.dragRegion.x + layout.dragRegion.width < layout.shell.x, 'native drag view cannot cover tabs')
})

test('persisted panel width respects the rail, gutter and minimum Matter reserve', () => {
  for (const width of [960, 1024, 1280, 1440]) {
    const available = width - FRAME_RAIL_WIDTH - FRAME_EDGE
    const manual = rightPanelLayout(width, 800, true, 640)
    assert.equal(manual.panel.width, Math.min(640, available - FRAME_GAP - 300))
    assert.equal(manual.matter.width + manual.panel.width + FRAME_GAP, available)
    assert.equal(rightPanelLayout(width, 800, true, 120).panel.width, 380)
    assert.equal(rightPanelLayout(width, 800, true, 9999).panel.width,
      Math.min(Math.round(available * 0.82), available - FRAME_GAP - 300))
  }
})

test('Web measurements determine toolbar size within the framed content bounds', () => {
  const metrics = { toolbarHeight: 117, resizeHitWidth: 13, panelMin: 400, panelDefault: 410, panelReserve: 350, panelMaxRatio: 0.7 }
  const layout = rightPanelLayout(1280, 800, true, undefined, metrics)
  assert.equal(layout.panel.width, 410)
  assert.equal(layout.shell.height, 117)
  assert.equal(layout.browser.y, 117)
  assert.equal(layout.resizer.width, 13)
  assert.equal(rightPanelLayout(1280, 800, true, 9999, metrics).panel.width, 859)
  for (const height of [0, 32, 60, 160]) {
    const short = rightPanelLayout(1280, height, true, 410, metrics)
    assert.ok(short.browser.height >= 0)
    assert.ok(short.browser.y + short.browser.height <= height)
  }
})
