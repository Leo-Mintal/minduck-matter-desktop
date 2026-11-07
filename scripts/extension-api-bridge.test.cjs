const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const bridgeModule = require('../src/extensionApiBridge.cjs')
const { ExtensionApiBridge, EVENT_CHANNEL, PRESENCE_CHANNEL, REQUEST_CHANNEL, TAB_UPDATED_CALLBACK } = bridgeModule

const EXTENSION_NAME = 'Minduck Matter 浏览器助手'
const SCOPE = 'chrome-extension://keihffbijjbgpkdgifbenekbgalegpdg/'

function fakeWorker(scope) {
  const handlers = new Map()
  const listeners = new Map()
  return {
    scope, sent: [], tasksStarted: 0, tasksEnded: 0, destroyed: false,
    isDestroyed() { return this.destroyed },
    startTask() { this.tasksStarted++; return { end: () => { this.tasksEnded++ } } },
    send(...args) { this.sent.push(args) },
    ipc: {
      handle: (channel, handler) => handlers.set(channel, handler),
      removeHandler: (channel) => handlers.delete(channel),
      on: (channel, listener) => listeners.set(channel, listener),
      removeAllListeners: (channel) => listeners.delete(channel),
    },
    invoke: (channel, value) => handlers.get(channel)({}, value),
    emit: (channel, value) => listeners.get(channel)({}, value),
    hasHandlers: () => handlers.size > 0 || listeners.size > 0,
  }
}

function fakeSession() {
  const workers = new Map()
  const session = {
    preloads: [], unregistered: [], statusListener: null,
    registerPreloadScript(script) { session.preloads.push(script); return 'preload-1' },
    unregisterPreloadScript(id) { session.unregistered.push(id) },
    extensions: { getAllExtensions: () => [{ name: EXTENSION_NAME, url: SCOPE }, { name: 'Other', url: 'chrome-extension://other/' }] },
    serviceWorkers: {
      on: (_event, listener) => { session.statusListener = listener },
      removeListener: () => { session.statusListener = null },
      getWorkerFromVersionID: (versionId) => workers.get(versionId),
    },
    start(versionId, worker) { workers.set(versionId, worker); session.statusListener({ versionId, runningStatus: 'starting' }) },
    stop(versionId) { session.statusListener({ versionId, runningStatus: 'stopped' }); workers.delete(versionId) },
  }
  return session
}

function createBridge(handleRequest = async (method, params) => ({ method, params })) {
  const session = fakeSession()
  const bridge = new ExtensionApiBridge({ getSession: () => session, extensionName: EXTENSION_NAME, handleRequest, logger: { error() {} } })
  bridge.start()
  return { bridge, session }
}

test('worker preload shares the extension name and channels with the bridge', () => {
  const preload = fs.readFileSync(bridgeModule.WORKER_PRELOAD, 'utf8')
  const constant = (name) => preload.match(new RegExp(`const ${name} = '([^']+)'`))?.[1]
  assert.equal(constant('EXTENSION_NAME'), require('../src/agentBrowser.cjs').MATTER_BROWSER_EXTENSION_NAME)
  assert.equal(constant('REQUEST_CHANNEL'), REQUEST_CHANNEL)
  assert.equal(constant('EVENT_CHANNEL'), EVENT_CHANNEL)
  assert.equal(constant('PRESENCE_CHANNEL'), PRESENCE_CHANNEL)
  assert.equal(constant('PRESENCE_REFRESH_CHANNEL'), bridgeModule.PRESENCE_REFRESH_CHANNEL)
  for (const callback of [bridgeModule.GROUP_CHANGED_CALLBACK, TAB_UPDATED_CALLBACK]) assert.ok(preload.includes(`'${callback}'`))
  assert.equal(path.basename(bridgeModule.WORKER_PRELOAD), 'extension-worker-preload.cjs')
})

test('registers a service-worker preload and attaches only to the bundled extension scope', async () => {
  const { bridge, session } = createBridge()
  assert.deepEqual(session.preloads, [{ type: 'service-worker', filePath: bridgeModule.WORKER_PRELOAD }])
  const website = fakeWorker('http://127.0.0.1:4000/')
  const otherExtension = fakeWorker('chrome-extension://other/')
  const extension = fakeWorker(SCOPE)
  session.start(1, website)
  session.start(2, otherExtension)
  session.start(3, extension)
  assert.equal(website.hasHandlers(), false)
  assert.equal(otherExtension.hasHandlers(), false)
  assert.equal(extension.tasksStarted, 1)
  assert.deepEqual(await extension.invoke(REQUEST_CHANNEL, { method: 'tabs.query', params: { queryInfo: {} } }),
    { ok: true, value: { method: 'tabs.query', params: { queryInfo: {} } } })
  session.statusListener({ versionId: 3, runningStatus: 'running' })
  assert.equal(extension.tasksStarted, 1)
  bridge.stop()
  assert.deepEqual(session.unregistered, ['preload-1'])
  assert.equal(extension.tasksEnded, 1)
  assert.equal(extension.hasHandlers(), false)
})

test('reattaches a restarted worker instance that reuses its version ID', () => {
  const { session } = createBridge()
  const first = fakeWorker(SCOPE)
  session.start(5, first)
  session.stop(5)
  assert.equal(first.tasksEnded, 1)
  const restarted = fakeWorker(SCOPE)
  session.start(5, restarted)
  assert.equal(restarted.tasksStarted, 1)
  assert.equal(restarted.hasHandlers(), true)
})

test('returns bridge errors as envelopes and validates request shape', async () => {
  const { session } = createBridge(async () => { throw new Error('Browser tab 9 was not found') })
  const worker = fakeWorker(SCOPE)
  session.start(1, worker)
  assert.deepEqual(await worker.invoke(REQUEST_CHANNEL, { method: 'tabs.get', params: { tabId: 9 } }), { ok: false, error: 'Browser tab 9 was not found' })
  assert.deepEqual(await worker.invoke(REQUEST_CHANNEL, null), { ok: false, error: 'Invalid extension bridge request' })
})

test('caches only presence fields and matches the paired Matter origin', async () => {
  const { bridge, session } = createBridge()
  const worker = fakeWorker(SCOPE)
  session.start(1, worker)
  const refreshes = () => worker.sent.filter(([channel]) => channel === bridgeModule.PRESENCE_REFRESH_CHANNEL).length
  assert.equal(refreshes(), 1)
  assert.equal(await bridge.presenceDeviceId('https://matter.minduck.com'), '')
  assert.equal(refreshes(), 2)
  worker.emit(PRESENCE_CHANNEL, { deviceId: 'device-1', webOrigin: 'https://matter.minduck.com', revoked: false, deviceToken: 'secret' })
  assert.equal(await bridge.presenceDeviceId('https://matter.minduck.com'), 'device-1')
  assert.equal(await bridge.presenceDeviceId('https://other.example.com'), '')
  assert.equal(JSON.stringify(bridge.presence).includes('secret'), false)
  worker.emit(PRESENCE_CHANNEL, { deviceId: 'device-1', webOrigin: 'https://matter.minduck.com', revoked: true })
  assert.equal(await bridge.presenceDeviceId('https://matter.minduck.com'), '')
})

test('broadcasts tab events to live extension workers only', async () => {
  const { bridge, session } = createBridge()
  const live = fakeWorker(SCOPE)
  session.start(1, live)
  const tab = { id: 4, groupId: -1, url: 'https://example.com/' }
  const events = () => live.sent.filter(([channel]) => channel === EVENT_CHANNEL)
  await bridge.notifyTabUpdated(tab, { status: 'complete' })
  assert.deepEqual(events(), [[EVENT_CHANNEL, TAB_UPDATED_CALLBACK, [4, { status: 'complete' }, tab]]])
  live.destroyed = true
  await bridge.notifyTabUpdated(tab, { status: 'loading' })
  assert.equal(events().length, 1)
})
