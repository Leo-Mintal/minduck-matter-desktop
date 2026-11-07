const { test } = require('node:test')
const assert = require('node:assert/strict')

async function figureAt(kind, time) {
  const { createSuitFigure } = await import('../src/companion/figures/minduck-suit-duck/figure.js')
  const nodes = new Map()
  const node = id => {
    if (!nodes.has(id)) nodes.set(id, { attributes: {}, setAttribute(k, v) { this.attributes[k] = v }, appendChild() {} })
    return nodes.get(id)
  }
  const group = { ownerDocument: { createElementNS: () => node('mouth') },
    querySelector: selector => node(selector), querySelectorAll: () => [] }
  const figure = createSuitFigure({ kind, sourceTime: time })
  figure.draw(group, { eyes: [] }, { t: time, mode: 'idle', low: 0, look: [0, 0],
    legs: [[0, 0, 104, 241], [0, 0, 150, 241]] })
  return nodes
}

// Evaluate the actual generated transform at the source shoulder, not just its rotation angle.
function shoulder(transform) {
  const [x, y, angle, cx, cy] = transform.match(/-?\d+(?:\.\d+)?/gu).map(Number)
  const radians = angle * Math.PI / 180
  return [x + cx + (13.5 - cx) * Math.cos(radians) - (27 - cy) * Math.sin(radians),
    y + cy + (13.5 - cx) * Math.sin(radians) + (27 - cy) * Math.cos(radians)]
}

test('Suit Duck work keeps the sleeve attached through entry, typing and stowing', async () => {
  for (const time of [0, .25, .6, 1, 1.35, 1.7, 2, 2.5, 3, 4, 4.35, 5, 5.5, 5.85]) {
    const nodes = await figureAt('work', time)
    const point = shoulder(nodes.get('#suit-wing-front').attributes.transform)
    assert.ok(Math.hypot(point[0] - 13.5, point[1] - 27) < .001, 'detached shoulder at ' + time)
  }
})

test('Suit Duck idle and question pose retain their original arm offsets', async () => {
  const idle = await figureAt(null, 0)
  assert.deepEqual(shoulder(idle.get('#suit-wing-front').attributes.transform), [13.5, 27])
  const ask = await figureAt('ask', 2)
  assert.deepEqual(shoulder(ask.get('#suit-wing-front').attributes.transform), [22.5, 25.5])
})
