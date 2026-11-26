const test = require('node:test')
const assert = require('node:assert/strict')

async function fixture() {
  const { createPet } = await import('../vendor/coopanion/runtime/node_modules/cortico-world-desktop-pet/web/kit/body.js')
  const events = [], sounds = []
  const node = () => ({ setAttribute() {} })
  const pet = createPet({ petG: node(), shadowEl: node(), fxG: {} }, {
    figure: { draw() {} }, roam: 'off', startX: 300,
    bounds: () => ({ W: 960, H: 600, floorY: 600, S: .5 }),
    sfx: { play: name => sounds.push(name) }, onEvent: (type, detail) => events.push({ type, ...detail }) })
  const click = () => {
    const point = pet.layout().hit[0]
    assert.equal(pet.pointerDown({ ...point, t: 1000 }), true)
    pet.pointerUp({ ...point, t: 1060 })
  }
  const sample = () => Array.from({ length: 120 }, () => {
    pet.step(1 / 120); pet.render()
    return pet.pet.xf.AX - pet.pet.x
  })
  return { pet, click, sample, events, sounds }
}

test('clicks retain every native random face, hop, sound and poke event', async t => {
  let random = 0
  t.mock.method(Math, 'random', () => random)
  for (const [index, face] of ['happy', 'wink', 'surprised', 'love', 'angry'].entries()) {
    random = (index + .1) / 5
    const { pet, click, events, sounds } = await fixture()
    click()
    assert.equal(pet.layout().expression, face)
    assert.equal(pet.layout().mode, random < .5 ? 'crouch' : 'idle')
    if (random < .5) assert.equal(pet.pet.jumpV, 480)
    assert.ok(events.some(event => event.type === 'touch' && event.kind === 'poke'))
    assert.ok(sounds.includes('poke'))
    assert.equal(pet.pressing, false)
  }
})

test('an angry click keeps its expression without the lateral body shake', async t => {
  t.mock.method(Math, 'random', () => .99)
  const { pet, click, sample } = await fixture()
  click()
  assert.equal(pet.layout().expression, 'angry')
  assert.equal(pet.layout().mode, 'idle')
  assert.ok(sample().every(delta => Math.abs(delta) < 1e-9), 'rendered body x stays at its actual position')
  assert.equal(pet.layout().expression, 'angry')
})

test('an explicit expression still uses its original motion after a click', async t => {
  t.mock.method(Math, 'random', () => .99)
  const { pet, click, sample } = await fixture()
  click(); sample()
  assert.equal(pet.doWord('angry'), true)
  assert.ok(sample().some(delta => Math.abs(delta) > .1), 'explicit actions are unchanged')
})

test('clicking a seated or sleeping pet still wakes it', async () => {
  for (const mode of ['sit', 'sleep']) {
    const { pet, click, events } = await fixture()
    assert.equal(pet.doWord(mode), true)
    click()
    assert.equal(pet.layout().mode, 'wake')
    assert.equal(events.find(event => event.kind === 'poke').woke, mode === 'sleep')
    assert.equal(pet.pressing, false)
  }
})

test('dragging past the existing threshold still picks up and releases the pet', async () => {
  const { pet, events } = await fixture()
  const point = pet.layout().hit[0]
  pet.pointerDown({ ...point, t: 1000 })
  const target = { x: point.x + 80, y: point.y - 80, t: 1040 }
  pet.pointerMove(target)
  assert.equal(pet.layout().mode, 'drag')
  pet.pointerUp({ ...target, t: 1080 })
  assert.equal(pet.layout().mode, 'air')
  assert.equal(pet.pressing, false)
  assert.ok(events.some(event => event.kind === 'grab'))
  assert.ok(events.some(event => ['drop', 'throw'].includes(event.kind)))
  assert.ok(!events.some(event => event.kind === 'poke'))
})
