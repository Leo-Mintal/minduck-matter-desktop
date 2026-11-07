const test = require('node:test')
const assert = require('node:assert/strict')
const { parseChromeMetrics } = require('../src/chromeMetrics.cjs')

const metrics = {
  theme: 'dark', toolbarHeight: 106, panelMin: 380, panelDefault: 384,
  panelReserve: 300, panelMaxRatio: 0.82, resizeHitWidth: 11,
  canvas: 'rgb(3, 3, 3)', surface: 'rgb(22, 23, 25)', divider: 'rgb(33, 34, 34)',
}

test('accepts resolved Web geometry and normalizes opaque native colors', () => {
  const parsed = parseChromeMetrics(metrics)
  assert.equal(parsed.canvas, '#030303')
  assert.equal(parsed.surface, '#161719')
  assert.equal(parsed.divider, '#212222')
  assert.equal(parsed.toolbarHeight, 106)
  assert.equal(parseChromeMetrics({ ...metrics, toolbarHeight: 0 }).toolbarHeight, 0)
})

test('rejects malformed dimensions, themes and transparent or invalid native colors', () => {
  for (const patch of [{ panelMin: NaN }, { panelDefault: '384' }, { toolbarHeight: 301 },
    { theme: 'system' }, { panelMaxRatio: 2 }, { resizeHitWidth: -1 },
    { divider: 'rgba(0,0,0,0)' }, { canvas: 'rgb(999,0,0)' }, { surface: 'transparent' }]) {
    assert.equal(parseChromeMetrics({ ...metrics, ...patch }), null)
  }
  assert.equal(parseChromeMetrics(null), null)
  assert.equal(parseChromeMetrics({}), null)
})
