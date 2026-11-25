const { test } = require('node:test')
const assert = require('node:assert/strict')

// The fake SVG records writes; the Electron sandbox probe checks real artwork.
function svg() {
  const nodes = new Map()
  const symbol = { childNodes: [{}], children: [], appendChild(node) { this.children.push(node) } }
  const root = { writes: [], children: [], style: {}, attributes: {}, nodes,
    namespaceURI: 'http://www.w3.org/2000/svg',
    ownerDocument: { createElementNS: () => svg() },
    setAttribute(name, value) { this.attributes[name] = value; this.writes.push([name, value]) },
    appendChild(node) { this.children.push(node) },
    append(...items) { this.children.push(...items) },
    querySelector(id) {
      if (id.startsWith('[id$=')) return symbol
      if (!nodes.has(id)) nodes.set(id, { style: {}, animate() { this.animated = true; return { pause() {}, cancel() {} } } })
      return id === '[data-duck-art]' ? this : nodes.get(id)
    } }
  return root
}

test('Suit Duck directional task symbols stay readable when the body faces left', async () => {
  const { mountFlows, drawFlows } = await import('../src/companion/figures/minduck-suit-duck/flow-player.js')
  const flows = mountFlows(svg())
  for (const kind of ['ask', 'happy', 'sad']) {
    drawFlows(flows, kind, 0, false, -1)
    assert.equal(flows[kind].symbol.style.transform, 'scaleX(-1)')
    drawFlows(flows, kind, 0.1, false, 1)
    assert.equal(flows[kind].symbol.style.transform, '')
  }
})

test('Suit Duck animated layers use their authored SVG origin', async () => {
  const { mountFlows, drawFlows } = await import('../src/companion/figures/minduck-suit-duck/flow-player.js')
  const flows = mountFlows(svg())
  drawFlows(flows, 'work', 0.1)
  const layers = [...flows.work.root.nodes.values()].filter(node => node.animated)
  assert.ok(layers.length > 0)
  assert.ok(layers.every(node => node.style.transformOrigin === '0 0'))
})

test('Suit Duck pose handoffs remain opaque between the exported visibility keyframes', async () => {
  const { FLOWS } = await import('../src/companion/figures/minduck-suit-duck/flow-artwork.js')
  const { opacityAt } = await import('../src/companion/figures/minduck-suit-duck/flow-player.js')
  for (const kind of ['work', 'write', 'ask', 'happy', 'sad']) {
    for (const track of FLOWS[kind].animations) {
      const frames = track.keyframes
      if (!frames.every(frame => ['0', '1'].includes(frame.opacity))) continue
      for (let i = 1; i < frames.length; i++) {
        const left = frames[i - 1], right = frames[i]
        if (left.opacity === right.opacity) continue
        if (right.offset - left.offset > .000100001) continue
        const middle = (left.offset + right.offset) / 2
        assert.equal(opacityAt(frames, middle), Number(left.opacity), `${kind}: ${track.id} at ${middle}`)
        assert.equal(opacityAt(frames, right.offset), Number(right.opacity))
      }
    }
  }
})

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

async function activityRenderFixture(id) {
  const { createFlowBody } = await import(`../src/companion/figures/${id}/flow-state.js`)
  const { FLOW_TIMING } = await import(`../src/companion/figures/${id}/flow-player.js`)
  const { withMatterActivity } = await import('../vendor/coopanion/runtime/node_modules/cortico-world-desktop-pet/web/minduck-activity.js')
  const state = { kind: null, sourceTime: 0, elapsed: 0, holdTime: 0 }, drawn = [], events = []
  const base = { words: [...Object.keys(FLOW_TIMING), 'stand'],
    do: () => true, stopWalk() {}, set() {}, dispose() {},
    step() { drawn.push({ kind: state.kind ?? 'idle', time: state.sourceTime }) },
    layout: () => ({ busy: false, mode: 'idle', pressing: false }),
  }
  const body = withMatterActivity(createFlowBody({ createBody: () => base },
    { emit: (kind, detail) => events.push({ kind, ...detail }) }, {}, state))
  return { state, drawn, events,
    set(kind) { body.set({ matterActivity: { kind, id: kind, expiresAt: Date.now() + 10000 } }) },
    tick(count = 1) { for (let i = 0; i < count; i++) body.step(.05) },
  }
}

for (const id of ['minduck-duck', 'minduck-suit-duck']) {
  test(`${id} paints the next activity on the frame that finishes stowing`, async () => {
    const pairs = [['ask', 'work'], ['work', 'ask'],
      ...(id === 'minduck-suit-duck' ? [['ask', 'success'], ['work', 'error']] : [])]
    for (const [from, to] of pairs) {
      const f = await activityRenderFixture(id)
      f.set(from); f.tick(40); f.drawn.length = 0
      f.set(to)
      for (let i = 0; i < 80 && f.state.kind === from; i++) f.tick()
      const target = { success: 'happy', error: 'sad' }[to] ?? to
      assert.equal(f.state.kind, target)
      assert.ok(f.drawn.length > 1, 'the original stowing sequence remains visible')
      assert.deepEqual([...new Set(f.drawn.map(frame => frame.kind))], [from, target], 'no unrelated idle frame')
      assert.deepEqual(f.drawn.at(-1), { kind: target, time: 0 }, 'the new source starts at its actual first frame')
      assert.equal(f.events.filter(event => event.word === from).length, 1)
    }
  })

  test(`${id} reads the latest target at stow completion and never paints an obsolete queued action`, async () => {
    for (const final of ['work', 'idle']) {
      const f = await activityRenderFixture(id)
      f.set('work'); f.tick(40); f.drawn.length = 0
      f.set('ask'); f.tick(3)
      f.set('error'); f.set('idle'); f.set(final)
      for (let i = 0; i < 80 && !f.events.some(event => event.word === 'work'); i++) f.tick()
      assert.equal(f.drawn.at(-1).kind, final)
      assert.ok(f.drawn.every(frame => frame.kind === 'work' || final === 'idle' && frame.kind === 'idle'))
      assert.equal(f.events.filter(event => event.word === 'work').length, 1)
    }
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
