const test = require('node:test')
const assert = require('node:assert/strict')
const { createPairing } = require('../src/local-exec/pairing.cjs')
const { localExecStatus } = require('../src/local-exec/status.cjs')

const origin = 'https://matter.test'
const wsURL = 'wss://matter.test/api/extensions/device-link/ws'
const safeStorage = { isEncryptionAvailable: () => true, encryptString: value => Buffer.from(value), decryptString: value => value.toString() }
const ok = (value, status = 200) => ({ ok: true, status, json: async () => value })
const issued = { id: 'pair_test', code: 'test-code', ws_url: wsURL }
const redeemed = { device_id: 'desktop-test', device_token: 'test-secret', ws_url: wsURL }

function fixture(respond, options = {}) {
  let value = { pairing: null }
  const store = { get: () => value, update: patch => { value = { ...value, ...patch }; return value } }
  const calls = []
  const fetchImpl = async (url, init) => { calls.push({ url, ...init }); return respond(url, init) }
  const create = extra => createPairing({ origin, store, fetchImpl, safeStorage, version: 'test', ...options, ...extra })
  return { store, calls, create }
}

test('concurrent pairing helpers share one request for the same account, origin and device kind', async () => {
  let release
  const f = fixture(async url => {
    if (url.endsWith('/pairings')) { await new Promise(resolve => { release = resolve }); return ok(issued) }
    return ok(redeemed)
  })
  const first = f.create().pair('jwt', 'u1')
  const second = f.create().pair('jwt', 'u1')
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(f.calls.length, 1)
  release()
  assert.deepEqual(await first, await second)
  assert.equal(f.calls.length, 2)
})

test('an untrusted endpoint cancels the issued pairing on every failed attempt', async () => {
  const f = fixture(async (url, init) => init.method === 'DELETE' ? ok(null, 204)
    : ok({ ...issued, ws_url: 'wss://other.test/api/extensions/device-link/ws' }))
  for (let i = 0; i < 5; i++) await assert.rejects(f.create().pair('jwt', 'u1'), /不可信/)
  assert.equal(f.calls.length, 10)
  const cancellations = f.calls.filter(call => call.method === 'DELETE')
  assert.equal(cancellations.length, 5)
  assert.equal(cancellations[0].url, origin + '/api/extensions/devices/pairings/pair_test')
  assert.equal(cancellations[0].headers.Authorization, 'Bearer jwt')
  assert.equal(f.store.get().pairing, null)
})

test('redeem failure is reclaimed; failed cleanup blocks new codes across helper recreation', async () => {
  let cleanupFails = true, redeemFails = true
  const f = fixture(async (url, init) => {
    if (init.method === 'DELETE') return cleanupFails ? { ok: false, status: 503 } : ok(null, 204)
    if (url.endsWith('/pairings')) return ok(issued)
    if (redeemFails) throw new Error('redeem connection lost')
    return ok(redeemed)
  })
  await assert.rejects(f.create().pair('jwt', 'u1'), /暂未回收/)
  await assert.rejects(f.create().pair('jwt', 'u1'), /503/)
  assert.equal(f.calls.filter(call => call.url.endsWith('/pairings')).length, 1)
  cleanupFails = false; redeemFails = false
  await f.create().pair('jwt', 'u1')
  assert.equal(f.calls.filter(call => call.url.endsWith('/pairings')).length, 2)
  assert.equal(f.store.get().pairing.deviceId, 'desktop-test')
})

test('already removed pending codes are successfully reclaimed with 404 or 410', async () => {
  for (const status of [404, 410]) {
    const f = fixture(async (url, init) => init.method === 'DELETE' ? { ok: false, status }
      : ok({ ...issued, ws_url: 'wss://other.test/api/extensions/device-link/ws' }))
    await assert.rejects(f.create().pair('jwt', 'u1'), /不可信/)
    await assert.rejects(f.create().pair('jwt', 'u1'), /不可信/)
    assert.equal(f.calls.filter(call => call.url.endsWith('/pairings')).length, 2)
  }
})

test('cancellation before redeem releases the pending code and sends no redeem request', async () => {
  let current = true
  const f = fixture(async (url, init) => {
    if (init.method === 'DELETE') return ok(null, 204)
    current = false; return ok(issued)
  }, { assertCurrent: () => { if (!current) throw new Error('cancelled') } })
  await assert.rejects(f.create().pair('jwt', 'u1'), /cancelled/)
  assert.equal(f.calls.length, 2)
  assert.equal(f.calls[1].method, 'DELETE')
})

test('late cancellation and failed persistence revoke the newly issued device credentials', async () => {
  for (const failSave of [false, true]) {
    let current = true
    const f = fixture(async (url, init) => {
      if (init.method === 'DELETE') return ok(null, 204)
      if (url.endsWith('/pairings')) return ok(issued)
      if (!failSave) current = false
      return ok(redeemed)
    }, { assertCurrent: () => { if (!current) throw new Error('cancelled') } })
    if (failSave) {
      const update = f.store.update
      f.store.update = patch => { if (patch.pairing) throw new Error('cannot save credentials'); return update(patch) }
    }
    await assert.rejects(f.create().pair('jwt', 'u1'), /cancelled|cannot save/)
    const revocation = f.calls.find(call => call.url.endsWith('/device-link/self'))
    assert.equal(revocation?.headers.Authorization, 'Bearer test-secret')
    assert.equal(f.store.get().pairing, null)
  }
})

test('restart reclaims persisted pending IDs before issuing; bookkeeping never stores a pairing code or token', async () => {
  const f = fixture(async (url, init) => {
    if (init.method === 'DELETE') throw new Error('cleanup offline')
    return ok({ ...issued, ws_url: 'wss://other.test/api/extensions/device-link/ws' })
  })
  await assert.rejects(f.create().pair('jwt', 'u1'), /暂未回收/)
  const saved = JSON.parse(JSON.stringify(f.store.get()))
  assert.equal(JSON.stringify(saved).includes('test-code'), false)
  assert.equal(JSON.stringify(saved).includes('test-secret'), false)
  const resumed = fixture(async (url, init) => init.method === 'DELETE' ? ok(null, 204)
    : url.endsWith('/pairings') ? ok(issued) : ok(redeemed))
  resumed.store.update(saved)
  await resumed.create().pair('jwt', 'u1')
  assert.equal(resumed.calls[0].method, 'DELETE')
  assert.ok(resumed.calls[0].url.endsWith('/pairings/pair_test'))
  assert.deepEqual(resumed.store.get().pendingPairings, {})
})

test('429 honors Retry-After and a lost issue response waits for the unknown pairing TTL', async () => {
  const f = fixture(async () => ({ ok: false, status: 429, headers: { get: () => '120' } }))
  await assert.rejects(f.create().pair('jwt', 'u1'), error => error.retryAfterMs === 120000 && /上限/.test(error.message))
  const unknown = fixture(async () => { throw new Error('request timeout') })
  await assert.rejects(unknown.create().pair('jwt', 'u1'), error => error.retryAfterMs === 600000)
  assert.equal(unknown.calls.length, 1)
})

test('connection status distinguishes online, permission, login, reconnect and failure without credentials', () => {
  assert.equal(localExecStatus({ state: '在线' }).label, '本机已连接')
  assert.equal(localExecStatus({ state: '请在系统设置开启完全磁盘访问' }).needsPermission, true)
  assert.equal(localExecStatus({ state: '请先登录 Matter' }).label, '请先登录')
  assert.equal(localExecStatus({ state: '离线' }).label, '本机重连中')
  const status = localExecStatus({ state: '设备配对请求失败（429）', retryAt: Date.now() + 60000, canRetry: true,
    pairing: { encryptedToken: 'private-token' } })
  assert.equal(status.tone, 'warning')
  assert.equal(status.canRetry, true)
  assert.ok(status.retrySeconds > 0)
  assert.equal(JSON.stringify(status).includes('private-token'), false)
  assert.equal(localExecStatus({ state: '配对已撤销，请重新启动客户端', canRetry: false }).canRetry, false)
})
