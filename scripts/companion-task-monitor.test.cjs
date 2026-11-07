const { test } = require('node:test')
const assert = require('node:assert/strict')
const vm = require('node:vm')
const { installMatterTaskMonitor } = require('../src/companion/task-monitor.cjs')

function fixture() {
  let rows = [], now = 100000, unavailable = false
  const sources = [], storage = new Map([['matter.token', 'session']])
  class Source {
    constructor(url) { this.url = url; this.listeners = {}; sources.push(this) }
    addEventListener(name, fn) { this.listeners[name] = fn }
    close() { this.closed = true }
  }
  const monitor = vm.runInNewContext(`(${installMatterTaskMonitor.toString()})()`, {
    localStorage: { getItem: key => storage.get(key) }, EventSource: Source,
    URLSearchParams, AbortController, AbortSignal, setTimeout, clearTimeout,
    Date: class extends Date { static now() { return now } },
    fetch: async () => ({ ok: !unavailable, json: async () => ({ conversations: rows }) }),
  })
  const read = () => JSON.parse(JSON.stringify(monitor.tick()))
  const update = async statuses => {
    rows = statuses.map(([id, status, fields]) => ({ id, turn_status: status, title: id, ...fields }))
    for (const source of sources) if (!source.closed && source.url.startsWith('/api/events')) {
      source.listeners['sidebar.updated']({ data: '{}' })
    }
    read(); await new Promise(setImmediate)
    return read()
  }
  return { monitor, read, update, storage, advance: ms => { now += ms },
    fail: value => { unavailable = value } }
}

test('monitor maps pending/waiting/running, ignoring historical results and missing rows', async t => {
  const f = fixture(); t.after(() => f.monitor.stop())
  assert.equal((await f.update([['old', 'failed']])).activity.kind, 'idle')
  let result = await f.update([['one', 'pending']])
  assert.equal(result.activity.kind, 'ask')
  assert.equal(result.tasks[0].text, '等你确认或补充')
  assert.equal((await f.update([['one', 'waiting'], ['two', 'running']])).activity.kind, 'work')
  assert.equal((await f.update([])).activity.kind, 'idle', 'deleted rows are not a success or failure')
})

test('notifications count unique non-archived unread, waiting and error conversations, without read side effects', async t => {
  const f = fixture(); t.after(() => f.monitor.stop())
  let result = await f.update([
    ['read', 'done'], ['working', 'running'], ['unread', 'done', { unread: true }],
    ['waiting', 'waiting', { unread: true }], ['pending', 'pending'],
    ['failed', 'failed'], ['stopped', 'stopped'], ['legacy-risk', '', { dot: 'risk' }],
    ['legacy-wait', '', { dot: 'wait' }], ['numeric-unread', 'done', { unread: 3 }],
    ['unread', 'done', { unread: true }], ['archived', 'failed', { unread: true, archived: true }],
  ])
  assert.equal(result.notificationCount, 8, 'overlapping reasons and repeated rows count only once')
  result = await f.update([['read', 'done']])
  assert.equal(result.notificationCount, 0, 'cleared backend signals clear the badge')
  assert.equal(result.active, false, 'notifications alone never show an activity capsule')
  await f.update([['unread', 'done', { unread: true }]])
  f.fail(true)
  assert.equal((await f.update([])).notificationCount, 0)
  f.storage.delete('matter.token')
  assert.equal(f.read().notificationCount, 0)
  f.fail(false); f.storage.set('matter.token', 'next-session')
  assert.equal((await f.update([['one', 'waiting']])).notificationCount, 1)
  f.storage.set('matter.org', 'another-org')
  assert.equal(f.read().notificationCount, 0, 'old organization notifications do not leak')
})

test('observed terminal transitions animate once per batch, with errors winning simultaneous results', async t => {
  const f = fixture(); t.after(() => f.monitor.stop())
  for (const status of ['done', 'failed', 'stopped']) {
    await f.update([['one', 'running']])
    const first = await f.update([['one', status]])
    assert.equal(first.active, false)
    assert.equal(first.activity.kind, status === 'done' ? 'success' : 'error')
    assert.deepEqual((await f.update([['one', status]])).activity, first.activity)
    f.advance(10001)
    assert.equal(f.read().activity.kind, 'idle')
  }
  await f.update([['one', 'running'], ['two', 'waiting']])
  assert.equal((await f.update([['one', 'failed'], ['two', 'waiting']])).activity.kind, 'ask')
  assert.equal((await f.update([['one', 'failed'], ['two', 'done']])).activity.kind, 'error')
})

test('network failure/logout/organization changes clear activity without inventing terminal results', async t => {
  const f = fixture(); t.after(() => f.monitor.stop())
  await f.update([['one', 'running']])
  f.fail(true)
  assert.equal((await f.update([['one', 'done']])).activity.kind, 'idle')
  f.storage.delete('matter.token')
  assert.equal(f.read().activity.kind, 'idle')
  f.fail(false); f.storage.set('matter.token', 'next-session')
  assert.equal((await f.update([['one', 'done']])).activity.kind, 'idle')
  await f.update([['one', 'waiting']])
  f.storage.set('matter.org', 'another-org')
  assert.equal((await f.update([['one', 'failed']])).activity.kind, 'idle')
})
