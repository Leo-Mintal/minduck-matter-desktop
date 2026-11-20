const test = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const { createService, signingText } = require('../src/desktop-access/service.cjs')
const { createAccessController } = require('../src/desktop-access/controller.cjs')
const { createKeyProvider } = require('../src/desktop-access/keys.cjs')
const origin = 'https://matter.example'

function fixture() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
  const pub = publicKey.export({ type: 'spki', format: 'der' }).toString('base64url')
  const calls = [], events = [], nonces = new Map()
  let saved = false, active = false, failSave = false
  const keys = { publicKey: async create => {
    if (create) { events.push('save-key'); if (failSave) throw new Error('Keychain unavailable'); saved = true }
    return saved ? pub : null
  }, sign: async text => { events.push('sign'); return crypto.sign('sha256', Buffer.from(text), privateKey).toString('base64url') } }
  const response = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } })
  const fetchImpl = async (url, options) => {
    url = new URL(url)
    calls.push({ url: url.href, ...options })
    if (url.pathname.endsWith('/policy')) return response({ required: true, protocol: 1 })
    if (url.pathname.endsWith('/challenges')) {
      const value = JSON.parse(options.body)
      const challenge = { id: crypto.randomUUID(), nonce: crypto.randomBytes(32).toString('base64url'), purpose: value.purpose, expiresAt: new Date(Date.now() + 120000).toISOString() }
      assert.equal(value.publicKey, pub); nonces.set(challenge.id, challenge)
      return response(challenge)
    }
    const challenge = nonces.get(options.headers['X-Desktop-Challenge'])
    assert.ok(challenge)
    assert.equal(options.headers['X-Desktop-Key'], pub)
    assert.ok(crypto.verify('sha256', Buffer.from(signingText(origin, challenge.purpose, 'POST', url.pathname, challenge, options.body)), publicKey,
      Buffer.from(options.headers['X-Desktop-Signature'], 'base64url')))
    nonces.delete(challenge.id)
    if (url.pathname.endsWith('/activate')) { events.push('consume-code'); active = true }
    return active ? response({ id: 'activation-id', status: 'active' }) : response({ code: 'device_unactivated', error: '未激活' }, 403)
  }
  return { service: createService({ origin, keys, fetchImpl }), keys, calls, events, nonces, publicKey,
    failSave() { failSave = true } }
}

test('activation persists a key before consuming a code, restores by key and binds auth body', async () => {
  const f = fixture()
  await assert.rejects(f.service.restore(), { code: 'device_unactivated' })
  assert.equal(f.calls.length, 0)
  await f.service.policy()
  await f.service.activate(' abc234 ')
  assert.ok(f.events.indexOf('save-key') < f.events.indexOf('consume-code'))
  assert.deepEqual(await f.service.restore(), { id: 'activation-id', status: 'active' })
  await f.service.renew()
  const body = '{ "email": "person@example.test", "password": "test-only" }'
  const request = new Request(origin + '/api/auth/login', { method: 'POST', body, headers: { 'Content-Type': 'application/json', 'X-Org-ID': 'org-test' } })
  const prepared = await f.service.prepareAuth(request)
  assert.equal(prepared.url, origin + '/api/desktop/auth/login')
  assert.equal(await prepared.clone().text(), body)
  assert.equal(prepared.headers.get('X-Org-ID'), 'org-test')
  const challenge = f.nonces.get(prepared.headers.get('X-Desktop-Challenge'))
  assert.ok(crypto.verify('sha256', Buffer.from(signingText(origin, 'auth', 'POST', '/api/desktop/auth/login', challenge, body)), f.publicKey,
    Buffer.from(prepared.headers.get('X-Desktop-Signature'), 'base64url')))
  const outside = new Request('https://outside.example/api/auth/login', { method: 'POST', body: '{}' })
  assert.equal(await f.service.prepareAuth(outside), outside)
  const regular = new Request(origin + '/api/me')
  assert.equal(await f.service.prepareAuth(regular), regular)
})

test('keychain failure never consumes an invite; runtime proof binds runtime and account token', async () => {
  const failed = fixture(); failed.failSave()
  await assert.rejects(failed.service.activate('ABC234'), /Keychain/)
  assert.equal(failed.calls.length, 0)
  const f = fixture(); await f.service.activate('ABC234')
  const proof = await f.service.runtimeProof('rt_device', 'jwt-test-token')
  const body = JSON.parse(proof.body)
  assert.equal(body.runtimeId, 'rt_device')
  assert.equal(body.tokenHash, crypto.createHash('sha256').update('jwt-test-token').digest('hex'))
  assert.equal(proof.body.includes('jwt-test-token'), false)
  const challenge = f.nonces.get(proof.challengeId)
  assert.ok(crypto.verify('sha256', Buffer.from(signingText(origin, 'runtime_connect', 'WS', '/api/client-runtime/ws', challenge, proof.body)),
    f.publicKey, Buffer.from(proof.signature, 'base64url')))
})

test('policy failure is closed; an explicit disabled server policy preserves Web-style auth', async () => {
  const failed = createService({ origin, keys: {}, fetchImpl: async () => new Response('not deployed', { status: 404 }) })
  await assert.rejects(failed.policy(), /格式错误/)
  const service = createService({ origin, keys: { publicKey() { assert.fail('disabled policy must not access keychain') } },
    fetchImpl: async () => new Response(JSON.stringify({ required: false, protocol: 1 })) })
  assert.equal(await service.policy(), false)
  assert.equal(await service.runtimeProof('rt', 'jwt'), undefined)
  const req = new Request(origin + '/api/auth/login', { method: 'POST', body: '{}' })
  assert.equal(await service.prepareAuth(req), req)
})

test('startup requires online activation, and an activated session survives a temporary outage', async () => {
  const unavailable = Object.assign(new Error('network unavailable'), { code: 'desktop_access_unavailable' })
  let activated = false, outage = true, starts = 0, stops = 0, consumes = 0, renewalError
  const service = { policy: async () => { if (outage) throw unavailable; return true },
    restore: async () => { if (!activated) throw Object.assign(new Error('邀请码'), { code: 'device_unactivated' }) },
    activate: async () => { consumes++; activated = true }, renew: async () => { if (renewalError) throw renewalError } }
  const controller = createAccessController({ service, onActive: async () => { starts++ }, onBlocked: async () => { stops++ } })
  assert.equal(controller.snapshot().status, 'checking')
  await controller.check(); assert.equal(controller.snapshot().status, 'retryable_error'); assert.equal(starts, 0)
  outage = false
  await controller.check(); assert.equal(controller.snapshot().status, 'unactivated'); assert.equal(starts, 0)
  await Promise.all([controller.activate('ABC234'), controller.activate('ABC234')])
  assert.equal(consumes, 1); assert.equal(starts, 1)
  await controller.check(); assert.equal(starts, 1)
  outage = true; await controller.check(); assert.equal(controller.snapshot().status, 'active')
  assert.ok(controller.snapshot().message)
  outage = false; renewalError = unavailable
  await controller.check(); assert.equal(controller.snapshot().status, 'active'); assert.equal(stops, 0)
  renewalError = undefined
  await controller.check(); assert.deepEqual(controller.snapshot(), { status: 'active', message: '' }); assert.equal(starts, 1)
  renewalError = Object.assign(new Error('revoked'), { code: 'device_revoked' })
  await controller.check(); assert.equal(controller.snapshot().status, 'revoked'); assert.equal(stops, 1)
  controller.dispose()
})

test('temporary HTTP and socket errors are distinct from validation failures', async () => {
  const service = fetchImpl => createService({ origin, keys: {}, fetchImpl })
  const socketError = new TypeError('transport failure', { cause: Object.assign(new Error(), { code: 'ENOTFOUND' }) })
  const tlsError = new TypeError('transport failure', { cause: Object.assign(new Error(), { code: 'CERT_HAS_EXPIRED' }) })
  await assert.rejects(service(async () => { throw socketError }).policy(), { code: 'desktop_access_unavailable' })
  await assert.rejects(service(async () => new Response('bad gateway', { status: 502 })).policy(), { code: 'desktop_access_unavailable' })
  await assert.rejects(service(async () => new Response('not deployed', { status: 404 })).policy(),
    error => error.code !== 'desktop_access_unavailable')
  await assert.rejects(service(async () => { throw tlsError }).policy(), error => error.code !== 'desktop_access_unavailable')
})

test('revocation and unsupported signing stay blocked; disposal prevents late startup', async () => {
  for (const [code, status] of [['device_revoked', 'revoked'], ['secure_key_unsupported', 'unsupported']]) {
    const controller = createAccessController({ service: { policy: async () => true, restore: async () => { throw Object.assign(new Error(code), { code }) } },
      onActive: async () => assert.fail('blocked device started') })
    await controller.check(); assert.equal(controller.snapshot().status, status); controller.dispose()
  }
  let resolve
  const controller = createAccessController({ service: { policy: () => new Promise(done => { resolve = done }) }, onActive: async () => assert.fail('disposed startup') })
  const pending = controller.check(); controller.dispose(); resolve(false); await pending
  const keys = createKeyProvider({ app: { isPackaged: false }, origin })
  await assert.rejects(keys.publicKey(true), { code: 'secure_key_unsupported' })
})

test('a malformed successful activation response never grants desktop access', async () => {
  for (const result of [{}, { id: 'device', status: 'revoked' }, { status: 'active' }, null]) {
    const service = createService({ origin, keys: { publicKey: async () => 'test-public-key', sign: async () => 'test-signature' },
      fetchImpl: async url => new Response(JSON.stringify(new URL(url).pathname.endsWith('/challenges')
        ? { id: 'challenge', nonce: 'nonce', purpose: 'restore', expiresAt: new Date(Date.now() + 120000).toISOString() } : result)) })
    await assert.rejects(service.restore(), /设备状态无效/)
  }
})
