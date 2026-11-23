const { test } = require('node:test')
const assert = require('node:assert/strict')

// The fake SVG records writes; the Electron sandbox probe checks real artwork.
function svg() {
  const nodes = new Map()
  const root = { writes: [], children: [], style: {}, attributes: {},
    ownerDocument: { createElementNS: () => svg() },
    setAttribute(name, value) { this.attributes[name] = value; this.writes.push([name, value]) },
    appendChild(node) { this.children.push(node) },
    querySelector(id) {
      if (!nodes.has(id)) nodes.set(id, { style: {}, animate: () => ({ pause() {}, cancel() {} }) })
      return id === '[data-duck-art]' ? this : nodes.get(id)
    } }
  return root
}

for (const id of ['minduck-duck', 'minduck-suit-duck']) {
  test(`${id} selects one opaque source at the entrance and exit without crossfading`, async () => {
    const { mountFlows, drawFlows, FLOW_TIMING } = await import(`../src/companion/figures/${id}/flow-player.js`)
    const flows = mountFlows(svg())
    const draw = (kind, time) => id === 'minduck-duck'
      ? drawFlows(flows, { kind, sourceTime: time }) : drawFlows(flows, kind, time)
    for (const time of [0, .025, .06, FLOW_TIMING.work.seconds - .025]) {
      assert.equal(draw('work', time), 1, 'the full source owns even the first/last frame')
      assert.equal(flows.work.root.attributes.opacity, '1')
    }
    const root = flows.work.root
    const writes = () => root.writes.filter(([name]) => name === 'opacity').length
    const before = writes()
    draw('work', .5)
    draw('work', .6)
    assert.equal(writes(), before, 'visibility is written only when it changes')
    draw('ask', .025)
    assert.equal(flows.work.root.attributes.opacity, '0')
    assert.equal(flows.ask.root.attributes.opacity, '1')
    draw(null, 0)
    assert.equal(flows.ask.root.attributes.opacity, '0')
    draw('work', 1)
    assert.equal(flows.work.root, root, 'returning to a source reuses its mounted artwork')
  })
}

test('the sandbox preserves the animation-rate signal separately from physical movement', async () => {
  const { readLayout } = await import('../vendor/coopanion/runtime/node_modules/cortico-world-desktop-pet/web/body-host.js')
  const size = { W: 960, H: 600, S: .5 }
  const layout = readLayout({ mode: 'idle', moving: false, animating: true }, size)
  assert.equal(layout.animating, true)
  assert.equal(layout.moving, false)
  assert.equal(readLayout({}, size).animating, false, 'unchanged third-party packs retain their resting rate')
})

test('default duck repairs non-finite filter regions before mounting without changing the artwork', async () => {
  const { FLOWS } = await import('../src/companion/figures/minduck-duck/flow-artwork.js')
  const { mountFlows, drawFlows } = await import('../src/companion/figures/minduck-duck/flow-player.js')
  const flows = mountFlows(svg())
  assert.equal(flows.work.animations, null, 'unused source timelines remain unmounted')
  drawFlows(flows, { kind: 'work', sourceTime: 0 })
  const original = FLOWS.work.svg
  const mounted = flows.work.root.innerHTML
  assert.match(original, /\b(?:x|y|width|height)="-?inf"/i, 'keep the original export intact')
  assert.doesNotMatch(mounted, /\b(?:x|y|width|height)="-?(?:inf|nan)"/i)
  const geometry = markup => markup.replace(/<filter\b[^>]*>/gi, '<filter>')
  assert.equal(geometry(mounted), geometry(original), 'paths and filter primitives are identical')
  assert.equal(flows.ask.animations, null, 'using work does not initialize ask')
})

for (const id of ['minduck-duck', 'minduck-suit-duck']) {
  test(`${id} automatic work/ask loop the source hold, then stow before switching`, async () => {
    const { createFlowBody } = await import(`../src/companion/figures/${id}/flow-state.js`)
    const { FLOW_TIMING } = await import(`../src/companion/figures/${id}/flow-player.js`)
    const { withMatterActivity } = await import('../vendor/coopanion/runtime/node_modules/cortico-world-desktop-pet/web/minduck-activity.js')
    const state = { kind: null, sourceTime: 0, elapsed: 0, holdTime: 0 }
    const events = []
    const base = { words: [...Object.keys(FLOW_TIMING), 'stand'],
      do: () => true, stopWalk() {}, set() {}, step() {},
      layout: () => ({ busy: false, mode: 'idle', pressing: false }), dispose() {} }
    const body = withMatterActivity(createFlowBody({ createBody: () => base },
      { emit: (kind, detail) => events.push({ kind, ...detail }) }, {}, state))
    const set = kind => body.set({ matterActivity: { kind } })
    const tick = dt => body.step(dt)
    for (const word of ['work', 'ask']) {
      set(word)
      for (let i = 0; i < 80 && state.kind !== word; i++) tick(.05)
      assert.equal(state.kind, word)
      const spec = FLOW_TIMING[word]
      for (let i = 0; i < 600; i++) {
        tick(.05)
        assert.equal(state.kind, word)
        if (i > 40) {
          assert.ok(state.sourceTime >= spec.enter - 1e-8)
          assert.ok(state.sourceTime < spec.sourceExit + 1e-8, 'do not put props away during an active task')
          assert.equal(body.layout()[word], word === 'work' ? 'typing' : 'waiting')
        }
      }
      assert.equal(events.filter(event => event.word === word).length, 0, 'a hold loop is not a completed action')
      set('idle'); tick(.05)
      assert.ok(state.sourceTime >= spec.sourceExit, 'finish via the source exit section')
      for (let i = 0; i < 80 && state.kind; i++) tick(.05)
      assert.equal(state.kind, null)
      assert.equal(events.filter(event => event.word === word).length, 1)
    }
  })
}
