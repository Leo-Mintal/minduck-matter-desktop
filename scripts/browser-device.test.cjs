const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')
const { createBrowserDevice, createStore } = require('../src/browser-device/controller.cjs')
const { createTools } = require('../src/browser-device/tools.cjs')
const { connectDesktop } = require('../src/local-exec/connection.cjs')
const { WebSocketServer } = require('../vendor/coopanion/runtime/node_modules/ws')
const origin = 'https://matter.test'
const jwt = uid => 'h.' + Buffer.from(JSON.stringify({ uid, exp: Date.now() / 1000 + 600 })).toString('base64url') + '.s'
const safeStorage = { isEncryptionAvailable: () => true, encryptString: value => Buffer.from('encrypted:' + value), decryptString: value => value.toString().slice(10) }

async function fixture(t, options = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'matter-browser-test-'))
  let token = jwt('u1'), connection, stops = 0, destroyed = false
  const requests = [], store = createStore(directory)
  const fetchImpl = async (url, init) => {
    requests.push({ url, init })
    if (options.fetch) return options.fetch(url, init)
    return { ok: true, status: url.endsWith('/self') ? 204 : 200, json: async () => url.endsWith('/pairings')
      ? { code: '123456', ws_url: 'wss://matter.test/api/extensions/device-link/ws' }
      : { device_token: 'browser-secret', device_id: 'browser-test', ws_url: 'wss://matter.test/api/extensions/device-link/ws' } }
  }
  const controller = createBrowserDevice({ app: { getPath: () => directory }, safeStorage, fetchImpl, origin, store,
    getContents: () => ({ isDestroyed: () => destroyed, getURL: () => origin, executeJavaScriptInIsolatedWorld: async () => token }),
    tools: { schemas: [{ name: 'chrome_navigate' }], version: '1.3.2',
      execute: async (params, signal, check) => { await check(); return { content: [{ type: 'text', text: 'ok' }] } } },
    connect: config => { connection = config; queueMicrotask(() => config.onState('在线')); return { stop: () => { stops++ } } },
  })
  t.after(async () => { controller.dispose(); await fs.rm(directory, { recursive: true, force: true }) })
  return { directory, controller, requests, store, connection: () => connection, stops: () => stops,
    token: value => { token = value }, destroyed: value => { destroyed = value } }
}

test('browser pairs as browser, encrypts its token separately and exposes its own presence', async t => {
  const f = await fixture(t)
  await f.controller.refresh()
  assert.equal(JSON.parse(f.requests[0].init.body).kind, 'browser')
  assert.equal(f.connection().maxActive, 1)
  assert.equal(f.connection().capabilities.localExec, undefined)
  assert.equal(await f.controller.presenceDeviceId(), 'browser-test')
  const saved = await fs.readFile(path.join(f.directory, 'browser-device/settings.json'), 'utf8')
  assert.equal(saved.includes('browser-secret'), false)
  assert.equal((await fs.stat(path.join(f.directory, 'browser-device/settings.json'))).mode & 0o777, 0o600)
  await assert.rejects(fs.access(path.join(f.directory, 'local-exec/settings.json')))
  await f.controller.refresh()
  assert.equal(f.requests.length, 2)
})

test('account change blocks presence and execution before polling; revocation stays disabled', async t => {
  const f = await fixture(t)
  await f.controller.refresh()
  f.token(jwt('u2'))
  assert.equal(await f.controller.presenceDeviceId(), '')
  await assert.rejects(f.connection().execute({ name: 'chrome_navigate', arguments: {} }, new AbortController().signal), /账号/)
  await f.controller.refresh()
  assert.equal(f.store.get().enabled, false)
  assert.ok(f.stops() > 0)
  await f.controller.setEnabled(true)
  f.connection().onRevoked()
  assert.equal(f.store.get().enabled, false)
  await f.controller.refresh()
  assert.equal(f.requests.length, 4)
})

test('late pairing after disable is discarded and newly issued credentials are revoked', async t => {
  let complete, f
  f = await fixture(t, { fetch: async (url, init) => {
    if (url.endsWith('/pairings')) return { ok: true, status: 200, json: async () => ({ code: '123', ws_url: 'wss://matter.test/api/extensions/device-link/ws' }) }
    if (url.endsWith('/redeem')) {
      await new Promise(resolve => { complete = resolve })
      return { ok: true, status: 200, json: async () => ({ device_token: 'late-secret', device_id: 'late', ws_url: 'wss://matter.test/api/extensions/device-link/ws' }) }
    }
    return { ok: true, status: 204 }
  } })
  const pending = f.controller.refresh()
  while (!complete) await new Promise(resolve => setTimeout(resolve, 1))
  await f.controller.setEnabled(false)
  complete(); await pending
  assert.equal(f.store.get().pairing, null)
  assert.equal(f.connection(), undefined)
  assert.equal(f.requests.at(-1).init.method, 'DELETE')
})

test('corrupt browser settings fail closed', async t => {
  const f = await fixture(t)
  await fs.mkdir(path.join(f.directory, 'browser-device'), { recursive: true })
  await fs.writeFile(path.join(f.directory, 'browser-device/settings.json'), '{broken')
  assert.equal(createStore(f.directory).get().enabled, false)
})

test('closing and reopening the window reconnects the same device without pairing again', async t => {
  const f = await fixture(t)
  await f.controller.refresh()
  f.controller.suspend(); f.destroyed(true)
  await f.controller.refresh()
  assert.equal(f.store.get().enabled, true)
  assert.equal(await f.controller.presenceDeviceId(), '')
  f.destroyed(false)
  await f.controller.refresh()
  assert.equal(await f.controller.presenceDeviceId(), 'browser-test')
  assert.equal(f.requests.length, 2)
})

test('browser settings retain their previous state if atomic persistence fails', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'matter-browser-store-'))
  t.after(() => fs.rm(directory, { recursive: true, force: true }))
  const store = createStore(directory)
  await fs.writeFile(path.join(directory, 'browser-device'), 'blocks the settings directory')
  assert.throws(() => store.update({ enabled: false }))
  assert.equal(store.get().enabled, true)
})

test('native runtime loads all 15 pinned tools without starting an extension and rejects cancelled work', async () => {
  let operations = 0
  const tools = createTools({ extensionRoot: path.join(__dirname, '..', 'extensions/matter-browser'), origin,
    compatibility: { request: async () => { operations++; return [] } } })
  assert.equal(tools.schemas.length, 15)
  assert.equal(new Set(tools.schemas.map(tool => tool.name)).size, 15)
  const signal = AbortSignal.abort()
  await assert.rejects(tools.execute({ name: 'get_windows_and_tabs', arguments: {} }, signal, async () => {}))
  assert.equal(operations, 0)
})

test('heartbeat timeout closes a real WHATWG WebSocket with an allowed reconnect code', { timeout: 5000 }, async t => {
  const server = new WebSocketServer({ port: 0, host: '127.0.0.1' })
  await new Promise(resolve => server.once('listening', resolve))
  const closed = new Promise(resolve => server.once('connection', socket => {
    socket.once('close', resolve)
    socket.on('message', data => {
      const frame = JSON.parse(data)
      if (frame.type === 'auth') {
        socket.send(JSON.stringify({ type: 'auth_ok', device_id: 'browser-heartbeat' }))
        socket.send(JSON.stringify({ jsonrpc: '2.0', id: 'init', method: 'initialize', params: { protocolVersion: '2025-06-18' } }))
      } else if (frame.id === 'init') socket.send(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }))
    })
  }))
  let ready
  const online = new Promise(resolve => { ready = resolve })
  const client = connectDesktop({ url: `ws://127.0.0.1:${server.address().port}`, token: 'fixture-token',
    deviceId: 'browser-heartbeat', version: '1.3.2', execute: async () => ({}),
    onState: state => { if (state === '在线') ready() } })
  t.mock.timers.enable({ apis: ['setTimeout'] })
  t.after(async () => {
    client.stop(); t.mock.timers.reset()
    for (const socket of server.clients) socket.terminate()
    await new Promise(resolve => server.close(resolve))
  })
  await online
  t.mock.timers.tick(55000)
  assert.equal(await closed, 4000)
})
