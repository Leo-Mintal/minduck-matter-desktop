const { test } = require('node:test')
const assert = require('node:assert/strict')
const web = '../vendor/coopanion/runtime/node_modules/cortico-world-desktop-pet/web/'

test('preview lists the active artwork and shows each task outcome just once', async () => {
  const { previewActions } = await import(web + 'minduck-preview.js')
  const pack = require('../src/companion/figures/minduck-suit-duck/figure.json')
  const words = [...pack.vocab.map(word => word.id), 'love', 'sad', 'flag', 'think', 'carry']
  const actions = previewActions(pack, words)
  assert.deepEqual(actions.map(action => action.id), ['auto', 'word:neutral', 'word:walk', 'word:write',
    'task:work', 'task:ask', 'task:success', 'task:error'])
  assert.equal(actions.at(-1).label, '失败')
  assert.deepEqual(previewActions(pack, ['neutral', 'wave']).map(action => action.id), ['auto', 'word:neutral'])
})

test('preview vocabulary from the sandbox is bounded and contains only distinct printable words', async () => {
  const { readPreviewWords } = await import(web + 'body-host.js')
  assert.deepEqual(readPreviewWords(['love', 'love', null, 42, '', '\n', 'a'.repeat(65), 'work']), ['love', 'work'])
  assert.deepEqual(readPreviewWords({ words: ['love'] }), [])
  assert.equal(readPreviewWords(Array.from({ length: 300 }, (_, i) => `word${i}`)).length, 256)
})

test('preview starts the selected real action once and keeps automatic roaming independent', async () => {
  const { createPreviewPlayer } = await import(web + 'minduck-preview.js')
  const calls = []
  const body = { set: state => calls.push(state), do: word => calls.push(word) }
  for (const action of [{ type: 'word', word: 'write' }, { type: 'task', kind: 'error' }]) {
    const player = createPreviewPlayer(body, action)
    player.step(0); player.step(.02); player.step(.02)
  }
  assert.equal(calls.filter(value => value === 'write').length, 1)
  const tasks = calls.filter(value => value.matterActivity)
  assert.equal(tasks.length, 1)
  assert.equal(tasks[0].matterActivity.kind, 'error')
  const auto = createPreviewPlayer(body, { type: 'auto' })
  auto.step(100)
  assert.deepEqual(calls.at(-1), { roam: 'calm' })
})

test('built-in action cards use distinct real thumbnails and imported figures keep their own image', async () => {
  const fs = require('node:fs')
  const path = require('node:path')
  const { previewActions, previewThumbnail } = await import(web + 'minduck-preview.js')
  for (const id of ['minduck-duck', 'minduck-suit-duck']) {
    const root = path.resolve(__dirname, '../src/companion/figures', id)
    const pack = { ...require(path.join(root, 'figure.json')), base: `/packs/${id}/` }
    const actions = previewActions(pack, pack.vocab.map(word => word.id))
    assert.equal(previewThumbnail(pack, actions[0]), pack.base + 'previews/word-neutral.png')
    const thumbnails = actions.slice(1).map(action => {
      const url = previewThumbnail(pack, action)
      const bytes = fs.readFileSync(path.join(root, url.slice(pack.base.length)))
      assert.equal(bytes.subarray(1, 4).toString(), 'PNG')
      return bytes.toString('base64')
    })
    assert.equal(new Set(thumbnails).size, thumbnails.length)
  }
  assert.equal(previewThumbnail({ id: 'imported', base: '/packs/custom/', thumb: 'cover.webp' },
    { id: 'task:work', type: 'task' }), '/packs/custom/cover.webp')
  assert.equal(previewThumbnail({ id: 'imported' }, { type: 'auto' }), null)
})
