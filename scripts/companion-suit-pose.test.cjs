const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { createHash } = require('node:crypto')
const { spawnSync } = require('node:child_process')
const root = path.resolve(__dirname, '..')
const pack = '../src/companion/figures/minduck-suit-duck/'

async function fixture() {
  const { createFlowBody } = await import(pack + 'flow-state.js')
  const { FLOW_TIMING } = await import(pack + 'flow-player.js')
  const state = { kind: null, sourceTime: 0, elapsed: 0 }
  const events = [], calls = []
  let pressing = false, busy = false
  const base = { words: [...Object.keys(FLOW_TIMING), 'stand', 'walk', 'neutral', 'wink'],
    do(word) { calls.push(word); return true }, stopWalk() {}, set() {}, step() {},
    layout: () => ({ busy, pressing, mode: 'idle', gesture: null }),
    pointer(type) { pressing = type === 'down' }, drop() { pressing = false },
    walk(x) { calls.push(['walk', x]); return true }, dispose() {} }
  const body = createFlowBody({ createBody: () => base },
    { emit: (kind, detail) => events.push({ kind, ...detail }) }, {}, state)
  return { state, body, calls, events, setBusy(value) { busy = value } }
}

test('Suit Duck retains all six supplied source files and five complete animation tracks', async () => {
  const { FLOWS } = await import(pack + 'flow-artwork.js')
  const provenance = require('../assets/companion-suit-duck/sources.json')
  assert.deepEqual(Object.keys(FLOWS), ['idle', 'work', 'ask', 'happy', 'sad'])
  for (const [kind, source] of Object.entries(provenance)) {
    const raw = fs.readFileSync(path.join(root, 'assets/companion-suit-duck/source', source.file))
    assert.equal(createHash('sha256').update(raw).digest('hex'), source.sha256)
    if (kind === 'base') continue
    assert.equal(FLOWS[kind].duration, source.duration)
    assert.equal(FLOWS[kind].animations.length, source.tracks)
    assert.equal((FLOWS[kind].svg.match(/<path\b/g) || []).length, source.paths)
    assert.equal((FLOWS[kind].svg.match(/<filter\b/g) || []).length, source.filters)
    assert.doesNotMatch(FLOWS[kind].svg, /<style|<script|\banimation:/)
    assert.doesNotMatch(FLOWS[kind].svg, /<filter\b[^>]*\b(?:x|y|width|height)="-?(?:inf|nan)"/i)
    const ids = new Set([...FLOWS[kind].svg.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]))
    for (const track of FLOWS[kind].animations) assert.ok(ids.has(track.id), track.id)
  }
  assert.equal(FLOWS.happy.animations.filter(t => t.keyframes[0].offsetDistance != null).length, 4)
  assert.match(FLOWS.happy.svg, /offset-path:path\(/)
  assert.match(fs.readFileSync(path.join(root, 'src/companion/figures/minduck-suit-duck/artwork.svg'), 'utf8'), /id="suit-monocle"/)
})

test('Suit Duck finite source flows advance only through valid host steps and complete once', async () => {
  for (const [word, seconds] of Object.entries({ work: 6, ask: 6, happy: 3, sad: 2.6 })) {
    const { state, body, calls, events } = await fixture()
    assert.equal(body.do(word), true)
    assert.equal(body.layout().gesture, word)
    assert.ok(!calls.includes(word), 'flow should not leave a second kit pulse behind')
    for (const dt of [0, -1, NaN, Infinity]) body.step(dt)
    assert.equal(state.sourceTime, 0)
    body.step(seconds - .1)
    assert.ok(Math.abs(state.sourceTime - seconds + .1) < 1e-8)
    body.step(.1)
    assert.equal(state.kind, null)
    assert.equal(body.layout().gesture, null)
    body.step(10)
    assert.deepEqual(events, [{ kind: 'done', word }])
  }
})

test('Suit Duck repairs only measured invalid filter regions and rejects changed or unmeasured sources', () => {
  const result = spawnSync('python3', ['-c', `
import importlib.util
from copy import deepcopy
spec = importlib.util.spec_from_file_location('builder', 'scripts/build-suit-duck.py')
b = importlib.util.module_from_spec(spec)
spec.loader.exec_module(b)
for name, expected in [('idle.svg', 0), ('working.svg', 188), ('confirmation.svg', 0), ('success.svg', 4), ('failure.svg', 4)]:
    root, provenance = b.read_source(name)
    original = deepcopy(root)
    assert b.repair_filter_bounds(root, provenance) == expected
    for before, after in zip(original.iter(), root.iter()):
        if before.attrib != after.attrib:
            assert before.tag == b.TAG('filter')
            assert any('inf' in before.get(k, '') for k in ('x', 'y', 'width', 'height'))
            for key in ('x', 'y', 'width', 'height'):
                assert b.math.isfinite(float(after.get(key)))
                before.set(key, after.get(key))
    assert b.ET.tostring(original) == b.ET.tostring(root), 'Filter primitives or artwork changed'
root, provenance = b.read_source('working.svg')
for changed in [{**provenance, 'sha256': 'changed'}, {**provenance, 'file': 'unmeasured.svg'}]:
    try:
        b.repair_filter_bounds(root, changed)
    except ValueError:
        pass
    else:
        raise AssertionError('Unreviewed source was accepted')
`], { cwd: root, encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr || result.stdout)
})

test('Suit Duck stows work before the latest queued command and does not retain an old result pulse', async () => {
  const { body, state, calls } = await fixture()
  body.do('work'); body.step(2)
  body.do('ask')
  assert.equal(state.sourceTime, 4.5)
  body.do('happy')
  body.step(1.5)
  assert.equal(state.kind, 'happy')
  body.do('sad')
  assert.equal(state.kind, 'sad')
  body.do('neutral')
  assert.equal(state.kind, null)
  assert.equal(body.layout().gesture, null)
  assert.equal(calls.at(-1), 'neutral')
})

test('Suit Duck early cancellation reverses entrance; walking waits until stow', async () => {
  const { body, state, calls } = await fixture()
  body.do('work'); body.step(.4); body.do('wink'); body.step(.4)
  assert.equal(state.kind, null)
  assert.equal(calls.at(-1), 'wink')
  body.do('ask'); body.step(2); body.walk(400, false, 1)
  assert.ok(!calls.some(c => Array.isArray(c)))
  body.step(1.5)
  assert.deepEqual(calls.at(-1), ['walk', 400])
})

test('Suit Duck pointer, drop and disposal clear interrupted source state and pending commands', async () => {
  for (const cancel of [body => body.pointer('down', {}), body => body.drop({}), body => body.dispose()]) {
    const { body, state, calls } = await fixture()
    body.do('work'); body.step(2); body.do('ask'); cancel(body)
    assert.equal(state.kind, null)
    body.step(10)
    assert.ok(!calls.includes('ask'))
  }
  const { body, setBusy } = await fixture()
  setBusy(true)
  assert.equal(body.do('work'), false)
})

test('Suit Duck linear pose opacity switches retain interpolation at segment boundaries', async () => {
  const { opacityAt } = await import(pack + 'flow-player.js')
  const frames = [{ offset: 0, opacity: '0' }, { offset: .2, opacity: '0' },
    { offset: .3, opacity: '1' }, { offset: .8, opacity: '1' }, { offset: 1, opacity: '0' }]
  for (const [t, expected] of [[0, 0], [.2, 0], [.25, .5], [.3, 1], [.8, 1], [.9, .5], [1, 0]]) {
    assert.ok(Math.abs(opacityAt(frames, t) - expected) < 1e-9)
  }
})
