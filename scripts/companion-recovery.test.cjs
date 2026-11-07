const { test } = require('node:test')
const assert = require('node:assert/strict')
const modulePath = '../vendor/coopanion/runtime/node_modules/cortico-world-desktop-pet/web/minduck-recovery.js'

async function setup() {
  const { withActionRecovery } = await import(modulePath)
  const state = { mode: 'idle', busy: false, pressing: false, work: 'typing', ask: null }
  const commands = [], holds = []
  const original = { words: ['work', 'ask'], get z() { return state.work },
    step() {}, layout: () => state, set: value => holds.push(value),
    do(word) { commands.push(word); state.work = word === 'work' ? 'pulling' : null
      state.ask = word === 'ask' ? 'pulling' : null; return true },
    pointer(type) { state.pressing = type === 'down'; if (type === 'down') state.work = state.ask = null },
    drop() { state.pressing = false; state.mode = 'air'; state.busy = true },
    walk() { return false }, dispose() {} }
  const body = withActionRecovery(original)
  const press = () => body.pointer('down', { x: 20, y: 20 })
  return { body, original, state, commands, holds, press }
}

test('dragged work and ask resume only after all landing or dizzy recovery completes', async () => {
  for (const word of ['work', 'ask']) {
    const { body, state, commands, holds, press } = await setup()
    state.work = word === 'work' ? 'typing' : null
    state.ask = word === 'ask' ? 'waiting' : null
    press(); body.drop({ x: 30, y: 40 })
    for (const mode of ['drag', 'air', 'land', 'dizzy', 'wake']) {
      Object.assign(state, { mode, busy: ['drag', 'air'].includes(mode) })
      body.step(.05)
      assert.deepEqual(commands, [], mode)
    }
    Object.assign(state, { mode: 'idle', busy: false })
    body.step(.05)
    assert.deepEqual(commands, [word])
    body.step(.05)
    assert.deepEqual(commands, [word], 'restore once, do not loop a finite pack animation')
    assert.ok(holds.length > 0, 'prevent roaming during the recovery boundary')
  }
})

test('latest flow requested while carried replaces the suspended flow', async () => {
  const { body, state, commands, press } = await setup()
  press(); body.drop({})
  assert.equal(body.do('ask'), true)
  Object.assign(state, { mode: 'idle', busy: false })
  body.step(.05)
  assert.deepEqual(commands, ['ask'])
})

test('idle or a new non-flow command cancels stale drag recovery', async () => {
  for (const word of ['neutral', 'stand', 'happy', 'sad']) {
    const { body, state, commands, press } = await setup()
    press(); body.drop({}); body.do(word)
    Object.assign(state, { mode: 'idle', busy: false })
    body.step(.05)
    assert.deepEqual(commands, [word])
    assert.equal(body.layout().recovering, null)
  }
})

test('natural flow completion does not restart work and unknown methods/getters retain their contract', async () => {
  const { body, original, state, commands } = await setup()
  state.work = null
  body.step(.05)
  assert.deepEqual(commands, [])
  assert.deepEqual(body.words, original.words)
  assert.equal(body.walk(), false)
  assert.equal(body.z, null)
  body.dispose(); body.step(.05)
  assert.deepEqual(commands, [])
})

test('real kit stops existing walks for business states and success/failure expressions', async () => {
  const { createPet } = await import('../vendor/coopanion/runtime/node_modules/cortico-world-desktop-pet/web/kit/body.js')
  const make = () => createPet({}, { figure: {}, sfx: { play() {} },
    bounds: () => ({ W: 960, H: 600, floorY: 600, S: .5 }), startX: 300 })
  for (const key of ['setStationary', 'setThinking', 'setStatus']) {
    const pet = make()
    pet.walkTo(750, false, 'existing-walk')
    pet.step(.05)
    pet[key](key === 'setStatus' ? 'work' : true)
    assert.equal(pet.layout().mode, 'idle', key + ' stops an existing walk')
    assert.equal(pet.walkTo(750, false, 'blocked'), false)
    const x = pet.layout().x
    for (let i = 0; i < 1800; i++) pet.step(.05)
    assert.equal(pet.layout().x, x, key + ' never roams during a long task')
    pet[key](key === 'setStatus' ? null : false)
    assert.equal(pet.walkTo(750, false, 'idle-walk'), true, 'idle restores movement')
  }
  for (const word of ['happy', 'sad']) {
    const pet = make()
    pet.walkTo(750, false, 'expression-walk')
    pet.doWord(word)
    assert.equal(pet.layout().mode, 'idle', word + ' stops walking')
    const x = pet.layout().x
    for (let i = 0; i < 60; i++) pet.step(.05)
    assert.equal(pet.layout().x, x, word + ' stays in place for its animation')
  }
  const off = make()
  off.setRoam('off'); off.setStationary(true); off.setStationary(false)
  assert.equal(off.roam, 'off', 'business states never overwrite the user roaming preference')
})
