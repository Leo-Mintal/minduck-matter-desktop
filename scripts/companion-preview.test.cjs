const { test } = require('node:test')
const assert = require('node:assert/strict')
const web = '../vendor/coopanion/runtime/node_modules/cortico-world-desktop-pet/web/'

test('preview lists factory actions beyond the manifest without inventing unsupported actions', async () => {
  const { previewActions } = await import(web + 'minduck-preview.js')
  const { KIT_EXPRESSIONS, KIT_MOTIONS } = await import(web + 'kit/body.js')
  const pack = require('../src/companion/figures/minduck-suit-duck/figure.json')
  const words = [...new Set([...KIT_EXPRESSIONS, ...KIT_MOTIONS, ...pack.vocab.map(word => word.id)])]
  const actions = previewActions(pack, words, { pointer: true, drop: true, talk: true, set: true })
  assert.deepEqual(actions.filter(action => action.type === 'word').map(action => action.word).sort(), words.sort())
  assert.equal(new Set(actions.map(action => action.id)).size, actions.length)
  assert.ok(actions.some(action => action.id === 'word:love' && action.label === '喜欢'))
  for (const id of ['task:work', 'task:ask', 'task:success', 'task:error', 'interaction:thinking',
    'interaction:grab', 'interaction:drop', 'interaction:throw', 'state:talk', 'state:listening']) {
    assert.ok(actions.some(action => action.id === id), id)
  }
  assert.deepEqual(previewActions({ id: 'custom', vocab: [{ id: 'missing' }] }, ['wave']).map(action => action.id),
    ['auto', 'word:wave'])
})

test('preview vocabulary from the sandbox is bounded and contains only distinct printable words', async () => {
  const { readPreviewWords } = await import(web + 'body-host.js')
  assert.deepEqual(readPreviewWords(['love', 'love', null, 42, '', '\n', 'a'.repeat(65), 'work']), ['love', 'work'])
  assert.deepEqual(readPreviewWords({ words: ['love'] }), [])
  assert.equal(readPreviewWords(Array.from({ length: 300 }, (_, i) => `word${i}`)).length, 256)
})

test('preview uses real body actions once and maintains task, listening and mouth states locally', async () => {
  const { createPreviewPlayer } = await import(web + 'minduck-preview.js')
  const calls = []
  const body = Object.fromEntries(['set', 'do', 'talk'].map(key => [key, (...args) => calls.push([key, ...args])]))
  const bounds = () => ({ W: 600, H: 300, floorY: 252 })
  for (const action of [{ type: 'word', word: 'love' }, { type: 'task', kind: 'ask' },
    { type: 'listening' }, { type: 'talk' }]) {
    const player = createPreviewPlayer(body, action, bounds)
    player.step(.02); player.step(.02)
  }
  assert.equal(calls.filter(call => call[0] === 'do').length, 1)
  assert.ok(calls.some(call => call[0] === 'do' && call[1] === 'love'))
  assert.equal(calls.filter(call => call[1]?.matterActivity).length, 1)
  assert.equal(calls.find(call => call[1]?.matterActivity)[1].matterActivity.kind, 'ask')
  assert.equal(calls.filter(call => call[1]?.listening).length, 1)
  assert.equal(calls.filter(call => call[0] === 'talk').length, 1)
  const auto = createPreviewPlayer(body, { type: 'auto' }, bounds)
  const before = calls.length
  auto.step(100)
  assert.equal(calls.length, before)
  assert.deepEqual(calls.at(-1), ['set', { roam: 'calm' }])
})

test('preview interactions wait for hit geometry and use pointer/drop paths without blocking thinking', async () => {
  const { createPreviewPlayer } = await import(web + 'minduck-preview.js')
  for (const kind of ['thinking', 'grab', 'drop', 'throw']) {
    const calls = []
    const body = { layout: null, set: state => calls.push(['set', state]),
      pointer: (type, point) => calls.push([type, point]), drop: point => calls.push(['drop', point]) }
    const player = createPreviewPlayer(body, { type: 'interaction', kind, seconds: 8 },
      () => ({ floorY: 252 }))
    player.step(.02)
    assert.equal(calls.length, 1, 'wait for a rendered body')
    body.layout = { hit: [{ x: 200, y: 180, r: 40 }] }
    player.step(.02); player.step(.02)
    assert.equal(calls.filter(call => call[0] === 'down').length, 1)
    assert.equal(calls.some(call => call[0] === 'up'), ['thinking', 'throw'].includes(kind))
    assert.equal(calls.some(call => call[0] === 'drop'), kind === 'drop')
    assert.equal(calls.some(call => call[1]?.hold), kind !== 'thinking')
  }
})
