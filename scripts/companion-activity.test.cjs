const { test } = require('node:test')
const assert = require('node:assert/strict')
const base = '../vendor/coopanion/runtime/node_modules/cortico-world-desktop-pet/web/'

async function fixture() {
  const { withMatterActivity } = await import(base + 'minduck-activity.js')
  const { withActionRecovery } = await import(base + 'minduck-recovery.js')
  const state = { mode: 'idle', busy: false, pressing: false, work: null, ask: null,
    expression: null, gesture: null }
  let remaining = 0, stationary = false
  const commands = []
  const original = {
    words: ['work', 'ask', 'happy', 'sad'],
    layout: () => state,
    set(s) { if ('stationary' in s) stationary = s.stationary },
    step(dt) {
      if (remaining > 0 && (remaining -= dt) <= 1e-9) {
        state.work = state.ask = state.expression = state.gesture = null
      }
    },
    do(word) {
      commands.push(word)
      if (word === 'stand') { state.mode = 'wake'; return true }
      state.work = word === 'work' ? 'typing' : null
      state.ask = word === 'ask' ? 'waiting' : null
      state.expression = ['happy', 'sad'].includes(word) ? word : null
      remaining = state.expression ? 3.2 : 6
      return true
    },
    pointer(type) {
      state.pressing = type === 'down'
      if (state.pressing) { state.work = state.ask = state.expression = null; remaining = 0 }
    },
    drop() { Object.assign(state, { mode: 'air', pressing: false, busy: true }) },
    walk: () => !stationary, move: () => !stationary, cue: () => true,
  }
  const body = withActionRecovery(withMatterActivity(original))
  const set = (kind, id = 'cue-one') => body.set({ matterActivity: { kind, id, expiresAt: Date.now() + 10000 } })
  const tick = seconds => { for (let i = 0; i < Math.round(seconds * 20); i++) body.step(.05) }
  return { body, state, commands, set, tick }
}

test('real activity loops work/ask and finishes the entire current flow before changing', async () => {
  const { body, commands, set, tick } = await fixture()
  set('work'); tick(.05)
  assert.deepEqual(commands, ['work'])
  tick(6)
  assert.deepEqual(commands, ['work', 'work'])
  set('ask'); tick(5.9)
  assert.deepEqual(commands, ['work', 'work'], 'do not force an early stow')
  tick(.1)
  assert.deepEqual(commands, ['work', 'work', 'ask'])
  assert.equal(body.walk(), false)
  assert.equal(body.move(), false)
  assert.equal(body.do('jump'), false, 'Core commands cannot replace real work')
  set('idle'); tick(6)
  assert.equal(body.layout().matterActivity, null)
  assert.equal(body.walk(), true)
})

test('success/error play their real finite expression once; duplicate snapshots cannot replay', async () => {
  for (const [kind, word] of [['success', 'happy'], ['error', 'sad']]) {
    const { body, commands, set, tick } = await fixture()
    set(kind); tick(.05)
    assert.equal(body.walk(), false)
    tick(3.15)
    assert.equal(body.layout().matterActivity, kind, 'wait for the full 3.2 second expression')
    tick(.05)
    assert.equal(body.layout().matterActivity, null)
    assert.equal(body.walk(), true)
    set(kind); tick(20)
    assert.deepEqual(commands, [word])
    set(kind, 'cue-two'); tick(.05)
    assert.deepEqual(commands, [word, word])
  }
})

test('drag recovery waits for landing/dizzy/wake and resumes the latest activity, not the old flow', async () => {
  const { body, state, commands, set, tick } = await fixture()
  set('work'); tick(.1)
  body.pointer('down', {}); body.drop({})
  set('ask')
  for (const mode of ['drag', 'air', 'land', 'dizzy', 'wake']) {
    Object.assign(state, { mode, busy: ['drag', 'air'].includes(mode) })
    tick(1)
    assert.deepEqual(commands, ['work'])
    assert.equal(body.layout().recovering, null, 'manual recovery must not resurrect stale work')
  }
  Object.assign(state, { mode: 'idle', busy: false, gesture: 'work' })
  tick(.05)
  assert.deepEqual(commands, ['work', 'ask'], 'ignore the drag-cleared kit pulse')
  body.pointer('down', {}); body.drop({}); set('idle')
  Object.assign(state, { mode: 'idle', busy: false })
  tick(1)
  assert.deepEqual(commands, ['work', 'ask'], 'ended tasks never resume after a drop')
})

test('new tasks wait for terminal expressions and expired unstarted cues are discarded', async () => {
  const { body, commands, set, tick } = await fixture()
  set('error'); tick(.05); set('work'); tick(3.15)
  assert.deepEqual(commands, ['sad'])
  tick(.05)
  assert.deepEqual(commands, ['sad', 'work'])
  body.pointer('down', {}); body.drop({})
  body.set({ matterActivity: { kind: 'success', id: 'expired', expiresAt: Date.now() - 1 } })
  assert.equal(body.layout().matterActivity, null)
})

test('real kit exposes actual expression completion rather than manifest timing', async () => {
  const { createPet } = await import(base + 'kit/body.js')
  const pet = createPet({}, { figure: {}, sfx: { play() {} },
    bounds: () => ({ W: 960, H: 600, floorY: 600, S: .5 }), startX: 300 })
  for (const word of ['happy', 'sad']) {
    pet.doWord(word)
    assert.equal(pet.layout().expression, word)
    for (let i = 0; i < 63; i++) pet.step(.05)
    assert.equal(pet.layout().expression, word)
    pet.step(.1)
    assert.equal(pet.layout().expression, null)
  }
})
