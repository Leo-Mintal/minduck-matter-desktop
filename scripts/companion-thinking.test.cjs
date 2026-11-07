const { test } = require('node:test')
const assert = require('node:assert/strict')

const modulePath = '../vendor/coopanion/runtime/node_modules/cortico-world-desktop-pet/web/minduck-thinking/idle.js'
const load = () => import(modulePath)

async function setup(random = () => 0, custom) {
  const { withIdleThinking } = await load()
  const state = { mode: 'idle', moving: false, busy: false, pressing: false }
  const view = { visible: false, frames: [], disposed: false,
    draw(time) { this.visible = true; this.frames.push(time) },
    hide() { this.visible = false }, dispose() { this.disposed = true } }
  const commands = []
  const original = custom ?? { words: ['work', 'ask'], step() {}, layout: () => state, set() {},
    do(word) { commands.push(word); return word === 'work' } }
  const body = withIdleThinking(original, {}, { random, createView: () => view })
  const tick = (seconds) => { for (let i = 0; i < Math.round(seconds * 20); i++) body.step(0.05) }
  return { body, original, state, view, commands, tick }
}

test('idle thinking waits a random 20–45 seconds and ends after one six-second loop', async () => {
  const { body, view, tick } = await setup()
  tick(19.9)
  assert.equal(view.visible, false)
  tick(0.2)
  assert.equal(view.visible, true)
  assert.equal(body.layout().moving, true, 'the host keeps a smooth frame rate during the effect')
  tick(6)
  assert.equal(view.visible, false)
  assert.equal(body.layout().moving, false)
  assert.ok(view.frames.every((time) => time > 0 && time < 6))
  tick(20.1)
  assert.equal(view.visible, true)
  assert.deepEqual(body.words, ['work', 'ask'], 'the pack vocabulary remains unchanged')
  const later = await setup(() => 0.999)
  later.tick(44.9)
  assert.equal(later.view.visible, false)
  later.tick(0.2)
  assert.equal(later.view.visible, true)
})

test('walking, work, ask, drag and sleep are never interrupted by an idle effect', async () => {
  for (const state of [
    { mode: 'walk', moving: true }, { mode: 'idle', moving: true, work: 'typing' },
    { mode: 'idle', moving: true, ask: 'waiting' }, { mode: 'drag', busy: true },
    { mode: 'sleep' }, { pressing: true },
  ]) {
    const item = await setup()
    Object.assign(item.state, state)
    item.tick(60)
    assert.equal(item.view.visible, false, JSON.stringify(state))
    assert.deepEqual(item.commands, [])
  }
})

test('dialogue, listening, model thinking, status and external holds block random effects', async () => {
  for (const key of ['dialogOpen', 'listening', 'thinking', 'status']) {
    const { body, view, tick } = await setup()
    body.set({ [key]: true })
    tick(60)
    assert.equal(view.visible, false, key)
    body.set({ [key]: false })
    tick(20.1)
    assert.equal(view.visible, true, key)
  }
  const held = await setup()
  held.body.set({ hold: 60 })
  held.tick(45)
  assert.equal(held.view.visible, false)
})

test('new commands and pointer presses immediately cancel thinking and preserve pack return values', async () => {
  const { body, tick, view, commands } = await setup()
  tick(20.1)
  assert.equal(view.visible, true)
  assert.equal(body.do('work'), true)
  assert.equal(view.visible, false)
  assert.deepEqual(commands, ['work'])
  assert.equal(body.do('unsupported'), false)
  const input = await setup(() => 0, { step() {}, layout: () => ({ mode: 'idle' }), do() {},
    pointer(type) { return type }, walk(x) { return x }, setScheme: async (id) => id })
  for (const [method, value] of [['pointer', 'down'], ['walk', 123], ['setScheme', 'alternate']]) {
    input.tick(20.1)
    assert.equal(input.view.visible, true)
    assert.equal(await input.body[method](value), value)
    assert.equal(input.view.visible, false)
  }
})

test('minimal API 2 bodies and live class getters remain compatible; disposal stops the clock', async () => {
  class MinimalBody {
    #z = 'first'
    step() {}
    layout() { return { mode: 'idle' } }
    do(word) { this.#z = word; return word }
    get z() { return this.#z }
  }
  const { body, tick, view } = await setup(() => 0, new MinimalBody())
  tick(20.1)
  assert.equal(view.visible, true)
  assert.equal(body.do('second'), 'second')
  assert.equal(body.z, 'second')
  assert.equal(body.walk, undefined)
  for (const dt of [0, -1, NaN, Infinity]) body.step(dt)
  assert.equal(view.visible, false)
  body.dispose()
  const count = view.frames.length
  tick(60)
  assert.equal(view.disposed, true)
  assert.equal(view.frames.length, count)
})

async function clickable(random = () => 0) {
  const state = { mode: 'idle', moving: false, busy: false, pressing: false }
  const calls = []
  const reactions = []
  const item = await setup(random, { step() {}, layout: () => state, set() {}, do() {},
    pointer(type, p) {
      calls.push(type)
      if (type === 'up') reactions.push(p.reaction)
      if (type === 'down') state.pressing = p.x >= 0
      if (type === 'up' || type === 'cancel') state.pressing = false
      return type
    } })
  const click = () => {
    assert.equal(item.body.pointer('down', { x: 10, y: 10, t: 1000 }), 'down')
    assert.equal(item.body.pointer('up', { x: 10, y: 10, t: 1100 }), 'up')
  }
  return { ...item, state, calls, reactions, click }
}

test('every short click plays thinking, suppresses the pack poke reaction and finishes one loop', async () => {
  const item = await clickable(() => 0.999)
  item.body.set({ thoughtShown: true, thinking: false, status: null, dialogOpen: false, listening: false })
  item.click()
  item.tick(0.05)
  assert.equal(item.view.visible, true)
  assert.deepEqual(item.calls, ['down', 'up'])
  assert.deepEqual(item.reactions, [false])
  item.tick(6)
  assert.equal(item.view.visible, false)
  item.tick(45)
  assert.equal(item.view.visible, true, 'random idle scheduling still works after a click')
})

test('the production default thoughtShown preference never blocks idle animation', async () => {
  const item = await setup()
  item.body.set({ thoughtShown: true, thinking: false, status: null, dialogOpen: false, listening: false })
  item.tick(20.1)
  assert.equal(item.view.visible, true)
  item.body.set({ thoughtShown: true })
  assert.equal(item.view.visible, true, 'updating the preference does not cancel an active effect')
})

test('drags, long presses, cancellations and off-figure presses do not trigger click thinking', async () => {
  for (const kind of ['drag', 'long', 'cancel', 'miss', 'up-only', 'drag-return']) {
    const item = await clickable()
    if (kind !== 'up-only') item.body.pointer('down', { x: kind === 'miss' ? -10 : 10, y: 10, t: 1000 })
    if (kind.startsWith('drag')) {
      item.body.pointer('move', { x: 30, y: 10, t: 1050 })
      if (kind === 'drag') item.state.mode = 'drag'
    }
    item.body.pointer(kind === 'cancel' ? 'cancel' : 'up',
      { x: 10, y: 10, t: kind === 'long' ? 1500 : 1100 })
    item.tick(3.1)
    assert.equal(item.view.visible, false, kind)
  }
})

test('click thinking yields to commands, dialogue and explicit pack workflows', async () => {
  const item = await clickable()
  item.click()
  Object.assign(item.state, { mode: 'jump', moving: true })
  item.tick(1)
  assert.equal(item.view.visible, false)
  Object.assign(item.state, { mode: 'idle', moving: false })
  item.tick(0.05)
  assert.equal(item.view.visible, true)
  item.body.set({ dialogOpen: true })
  assert.equal(item.view.visible, false)
  for (const interrupt of [(body) => body.do('work'), (body) => body.set({ dialogOpen: true })]) {
    const pending = await clickable()
    pending.click()
    interrupt(pending.body)
    pending.tick(3.1)
    assert.equal(pending.view.visible, false)
  }
  const busy = await clickable()
  busy.body.set({ status: 'working' })
  busy.click()
  busy.tick(3.1)
  assert.equal(busy.view.visible, false)
  for (const flow of ['work', 'ask']) {
    const working = await clickable()
    working.state[flow] = 'active'
    working.click()
    working.tick(3.1)
    assert.equal(working.view.visible, false, flow)
  }
})
