const test = require('node:test')
const assert = require('node:assert/strict')
const { easeOutCubic, panelTransitionFrame } = require('../src/panelMotion.cjs')
const { rightPanelLayout } = require('../src/rightPanelLayout.cjs')

const openLayout = rightPanelLayout(1280, 800, true, 384)
const closedLayout = rightPanelLayout(1280, 800, false, 384)

test('eases native panel bounds from offscreen while Matter yields its final width', () => {
  const first = panelTransitionFrame({ closedLayout, kind: 'opening', openLayout, progress: 0, windowWidth: 1280 })
  const middle = panelTransitionFrame({ closedLayout, kind: 'opening', openLayout, progress: 0.5, windowWidth: 1280 })
  const last = panelTransitionFrame({ closedLayout, kind: 'opening', openLayout, progress: 1, windowWidth: 1280 })

  assert.deepEqual(first.matter, closedLayout.matter)
  assert.equal(first.panel.x, 1280)
  assert.equal(first.panel.width, openLayout.panel.width)
  assert.ok(middle.panel.x < first.panel.x && middle.panel.x > last.panel.x)
  assert.ok(middle.matter.width < first.matter.width && middle.matter.width > last.matter.width)
  assert.deepEqual(last.panel, openLayout.panel)
  assert.deepEqual(last.shell, openLayout.shell)
})

test('reverses the same native bounds when the panel closes', () => {
  const first = panelTransitionFrame({ closedLayout, kind: 'closing', openLayout, progress: 0, windowWidth: 1280 })
  const last = panelTransitionFrame({ closedLayout, kind: 'closing', openLayout, progress: 1, windowWidth: 1280 })

  assert.deepEqual(first.panel, openLayout.panel)
  assert.deepEqual(first.matter, openLayout.matter)
  assert.equal(last.panel.x, 1280)
  assert.deepEqual(last.matter, closedLayout.matter)
  assert.equal(last.shell.x, 1280)
})

test('uses a monotonic ease-out curve with exact endpoints', () => {
  assert.equal(easeOutCubic(0), 0)
  assert.equal(easeOutCubic(1), 1)
  assert.ok(easeOutCubic(0.25) < easeOutCubic(0.5))
  assert.ok(easeOutCubic(0.5) < easeOutCubic(0.75))
})
