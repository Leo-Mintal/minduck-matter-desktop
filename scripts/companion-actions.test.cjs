const assert = require('node:assert/strict')
const { test } = require('node:test')
const { createMatterActionBridge, sendMatterAction, activateMatterWindow,
  watchMatterOutput, normalizeMatterOutput } = require('../src/companion/matter-actions.cjs')

test('task output boundary allows only active lifecycle and bounded public display fields', () => {
  assert.deepEqual(normalizeMatterOutput({ active: true, status: 'done', token: 'secret' }), {
    active: false, status: '', text: '', detail: '', conversationId: '', turnId: '', tasks: [], activity: { kind: 'idle' },
    notificationCount: 0,
  })
  const result = normalizeMatterOutput({ active: true, status: 'waiting', text: '字'.repeat(300),
    detail: '等你确认', conversationId: 'conv-one', credentials: 'secret' })
  assert.equal(result.text.length, 200)
  assert.equal(result.active, true)
  assert.ok(!JSON.stringify(result).includes('secret'))
  const many = normalizeMatterOutput({ tasks: [
    { active: true, status: 'running', conversationId: 'one', text: '工作中' },
    { active: true, status: 'waiting', conversationId: 'two', detail: '等你回答', token: 'secret' },
    { active: true, status: 'running', conversationId: 'one' },
    { active: true, status: 'done', conversationId: 'three' },
  ] })
  assert.deepEqual(many.tasks.map(task => task.conversationId), ['one', 'two'])
  assert.ok(!JSON.stringify(many).includes('secret'))
  assert.equal(normalizeMatterOutput({ tasks: Array.from({ length: 250 }, (_, i) => ({
    active: true, status: 'running', conversationId: String(i),
  })) }).tasks.length, 200)
})

test('notification count is bounded public metadata independent of active tasks and survives both native passes', () => {
  for (const [input, expected] of [[undefined, 0], [-1, 0], [0, 0], [2, 2], [100000, 99999],
    [1.5, 0], ['2', 0], [NaN, 0], [Infinity, 0]]) {
    const output = normalizeMatterOutput({ notificationCount: input, token: 'secret' })
    assert.equal(output.notificationCount, expected)
    assert.equal(output.active, false, 'notifications do not create an active task or an animation')
    assert.deepEqual(normalizeMatterOutput(output), output)
    assert.ok(!JSON.stringify(output).includes('secret'))
  }
})

test('activity is derived from every active task, with bounded expiring terminal cues only when idle', () => {
  const task = status => ({ active: true, status, conversationId: status })
  assert.equal(normalizeMatterOutput({ tasks: [task('pending')] }).activity.kind, 'ask')
  assert.equal(normalizeMatterOutput({ tasks: [task('waiting'), task('running')] }).activity.kind, 'work')
  const cue = { kind: 'error', id: 'settled-1', expiresAt: Date.now() + 9000, token: 'secret' }
  const output = normalizeMatterOutput({ activity: cue })
  assert.equal(output.activity.kind, 'error')
  assert.deepEqual(normalizeMatterOutput(output), output, 'both native boundary passes preserve the cue')
  assert.ok(!JSON.stringify(output).includes('secret'))
  assert.equal(normalizeMatterOutput({ tasks: [task('running')], activity: cue }).activity.kind, 'work')
  for (const activity of [{ ...cue, expiresAt: Date.now() - 1 }, { ...cue, id: '../bad' },
    { ...cue, kind: 'arbitrary' }, { ...cue, expiresAt: Infinity }]) {
    assert.equal(normalizeMatterOutput({ activity }).activity.kind, 'idle')
  }
})

test('authenticated task stream receives initial state, updates and closes with its parent', async (t) => {
  const bridge = createMatterActionBridge(() => {})
  const environment = await bridge.start()
  t.after(() => bridge.stop())
  assert.equal((await fetch(environment.MINDUCK_COMPANION_ACTION_ORIGIN + '/task-output')).status, 403)
  const values = []
  let resolve
  let changed = new Promise(done => { resolve = done })
  const stop = watchMatterOutput(value => { values.push(value); resolve() }, environment)
  t.after(stop)
  await changed
  assert.equal(values.at(-1).active, false)
  changed = new Promise(done => { resolve = done })
  bridge.setOutput({ active: true, status: 'running', text: '思考中' })
  await changed
  assert.equal(values.at(-1).text, '思考中')
  changed = new Promise(done => { resolve = done })
  bridge.setOutput({ notificationCount: 2, tasks: [{ active: true, status: 'waiting', conversationId: 'one' },
    { active: true, status: 'running', conversationId: 'two', text: '执行中' }] })
  await changed
  assert.equal(values.at(-1).tasks.length, 2)
  assert.equal(values.at(-1).notificationCount, 2)
  changed = new Promise(done => { resolve = done })
  await bridge.stop()
  await changed
  assert.equal(values.at(-1).active, false)
  assert.equal(values.at(-1).notificationCount, 0, 'disconnect clears stale notification badges')
})

test('pet actions reach the host only through the authenticated loopback allow-list', async (t) => {
  const actions = []
  const bridge = createMatterActionBridge((action) => actions.push(action))
  t.after(() => bridge.stop())
  const environment = await bridge.start()
  assert.deepEqual(await bridge.start(), environment, 'starting twice reuses one listener')
  const origin = environment.MINDUCK_COMPANION_ACTION_ORIGIN
  const authorization = `Bearer ${environment.MINDUCK_COMPANION_ACTION_TOKEN}`
  assert.equal((await fetch(origin + '/open-app', { method: 'POST' })).status, 403)
  assert.equal((await fetch(origin + '/open-app', { headers: { authorization } })).status, 403)
  assert.equal((await fetch(origin + '/open-app', {
    method: 'POST', headers: { authorization, origin: 'https://example.com' },
  })).status, 403)
  assert.equal((await fetch(origin + '/arbitrary', { method: 'POST', headers: { authorization } })).status, 404)
  assert.deepEqual(actions, [])
  await sendMatterAction('open-app', environment)
  await sendMatterAction('new-chat', environment)
  assert.deepEqual(actions, ['open-app', 'new-chat'])
})

test('pet action client refuses arbitrary actions, missing configuration and remote hosts', async () => {
  await assert.rejects(sendMatterAction('quit', {}), /Unsupported/)
  await assert.rejects(sendMatterAction('open-app', {}), /unavailable/)
  await assert.rejects(sendMatterAction('open-app', {
    MINDUCK_COMPANION_ACTION_ORIGIN: 'https://example.com', MINDUCK_COMPANION_ACTION_TOKEN: 'test',
  }), /unavailable/)
})

function windowFixture(minimized = false) {
  const calls = []
  return { calls, app: { focus: () => calls.push('app-focus') },
    window: { isMinimized: () => minimized, restore: () => calls.push('restore'),
      show: () => calls.push('show'), focus: () => calls.push('window-focus') },
    contents: { focus: () => calls.push('contents-focus'), loadURL: async (url) => calls.push(url) },
    origin: 'https://matter.example.com' }
}

test('open-app restores and focuses Matter without navigating its current page', async () => {
  const fixture = windowFixture(true)
  await activateMatterWindow(fixture, 'open-app')
  assert.deepEqual(fixture.calls, ['restore', 'show',
    ...process.platform === 'darwin' ? ['app-focus'] : [], 'window-focus', 'contents-focus'])
})

test('new-chat focuses Matter and navigates only its fixed view to the configured new-chat route', async () => {
  const fixture = windowFixture()
  await activateMatterWindow(fixture, 'new-chat')
  assert.ok(fixture.calls.includes('window-focus'))
  assert.equal(fixture.calls.at(-1), 'https://matter.example.com/new-chat')
  assert.ok(!fixture.calls.includes('restore'))
})

test('invalid pet actions cannot focus or navigate Matter', async () => {
  const fixture = windowFixture()
  await assert.rejects(activateMatterWindow(fixture, 'quit'), /Unsupported/)
  assert.deepEqual(fixture.calls, [])
})

test('conversation shortcuts accept bounded IDs only and keep their separate target over the native bridge', async (t) => {
  const received = []
  const bridge = createMatterActionBridge((action, target) => received.push({ action, target }))
  t.after(() => bridge.stop())
  const environment = await bridge.start()
  for (const conversationId of ['conv-one', 'conv-two']) await sendMatterAction('open-conversation', environment,
    { conversationId, turnId: 'turn-' + conversationId, token: 'never-forward' })
  assert.deepEqual(received.map(value => value.target.conversationId), ['conv-one', 'conv-two'])
  assert.ok(!JSON.stringify(received).includes('never-forward'))
  for (const conversationId of ['', '../other', 'https://example.com', 'a'.repeat(201)]) {
    await assert.rejects(sendMatterAction('open-conversation', environment, { conversationId }), /Invalid/)
  }
  await assert.rejects(sendMatterAction('open-conversation', environment,
    { conversationId: 'valid', turnId: 'bad/turn' }), /Invalid/)
})

test('conversation activation constructs its own route, focuses its turn and avoids reloading the same conversation', async () => {
  const fixture = windowFixture()
  let current = 'https://matter.example.com/c/existing'
  fixture.contents.getURL = () => current
  fixture.contents.loadURL = async value => { current = value; fixture.calls.push(value) }
  fixture.contents.executeJavaScriptInIsolatedWorld = async (world, scripts) => {
    assert.equal(world, 1002)
    assert.ok(scripts[0].code.includes('turn-two'))
    fixture.calls.push('focus-turn')
  }
  await activateMatterWindow(fixture, 'open-conversation', { conversationId: 'conv-two', turnId: 'turn-two' })
  await activateMatterWindow(fixture, 'open-conversation', { conversationId: 'conv-two', turnId: 'turn-two' })
  assert.equal(fixture.calls.filter(value => value === current).length, 1)
  assert.equal(fixture.calls.filter(value => value === 'focus-turn').length, 2)
  const before = fixture.calls.length
  await assert.rejects(activateMatterWindow(fixture, 'open-conversation', { conversationId: '../bad' }), /Invalid/)
  assert.equal(fixture.calls.length, before, 'invalid targets cannot activate Matter')
})
