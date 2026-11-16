'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { webcrypto } = require('node:crypto');
const { ALPHABET, DEMO_KEY, generateCode, createDemoAdapter, createApiAdapter, createIssuer } = require('./core.js');

function memoryStorage() {
  const map = new Map();
  return { getItem: (key) => map.get(key) ?? null, setItem: (key, value) => map.set(key, value), removeItem: (key) => map.delete(key) };
}

const invite = { id: 'invite-1', code: 'ABC234', status: 'active', createdAt: '2026-11-16T08:00:00.000Z' };
const response = (value, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => value });

test('demo codes use six readable characters and contain both letters and digits', () => {
  assert.equal(ALPHABET.length, 32);
  for (let i = 0; i < 100; i += 1) {
    const code = generateCode(webcrypto);
    assert.match(code, /^[A-HJ-NP-Z2-9]{6}$/);
    assert.match(code, /[A-Z]/);
    assert.match(code, /[2-9]/);
  }
});

test('demo issuance is idempotent, persists, and a revoked code stays revoked on retry', async () => {
  const storage = memoryStorage();
  const adapter = createDemoAdapter({ storage, cryptoImpl: webcrypto });
  const first = await adapter.issue('request-1');
  assert.deepEqual(await adapter.issue('request-1'), first);
  const second = await adapter.issue('request-2');
  assert.notEqual(first.code, second.code);
  await adapter.revoke(first.id);
  const reopened = createDemoAdapter({ storage, cryptoImpl: webcrypto });
  assert.equal((await reopened.list()).length, 2);
  assert.equal((await reopened.issue('request-1')).status, 'revoked');
});

test('single-flight coalesces concurrent calls before reaching the adapter', async () => {
  let calls = 0;
  let resolve;
  const issuer = createIssuer({
    adapter: { issue: () => { calls += 1; return new Promise((done) => { resolve = done; }); } },
    storage: memoryStorage(), pendingKey: 'pending', randomUUID: () => 'request-1',
  });
  const first = issuer.issue();
  const second = issuer.issue();
  assert.strictEqual(first, second);
  await Promise.resolve();
  assert.equal(calls, 1);
  resolve(invite);
  assert.deepEqual(await first, invite);
  assert.equal(issuer.hasPending(), false);
});

test('uncertain request survives reload and retries with its original idempotency key', async () => {
  const storage = memoryStorage();
  const ids = [];
  const first = createIssuer({
    adapter: { issue: async (id) => { ids.push(id); throw new Error('connection lost'); } },
    storage, pendingKey: 'pending', randomUUID: () => 'request-original',
  });
  await assert.rejects(first.issue(), /connection lost/);
  const reloaded = createIssuer({
    adapter: { issue: async (id) => { ids.push(id); return invite; } },
    storage, pendingKey: 'pending', randomUUID: () => 'must-not-use',
  });
  assert.equal(reloaded.hasPending(), true);
  await reloaded.issue();
  assert.deepEqual(ids, ['request-original', 'request-original']);
  assert.equal(storage.getItem('pending'), null);
});

test('a failed local recovery write prevents issuing a code', () => {
  let calls = 0;
  const storage = { ...memoryStorage(), setItem() { throw new Error('quota'); } };
  const issuer = createIssuer({ adapter: { issue() { calls += 1; } }, storage, pendingKey: 'pending' });
  assert.throws(() => issuer.issue(), /quota/);
  assert.equal(calls, 0);
});

test('demo collision is retried without replacing an existing invite', async () => {
  const storage = memoryStorage();
  const old = { ...invite, code: 'ABC234' };
  storage.setItem(DEMO_KEY, JSON.stringify({ items: [old], requests: {} }));
  let calls = 0;
  const indices = (value) => Uint8Array.from(value, (char) => ALPHABET.indexOf(char));
  const adapter = createDemoAdapter({ storage, cryptoImpl: {
    randomUUID: () => 'invite-2',
    getRandomValues(bytes) { bytes.set(indices(calls++ === 0 ? old.code : 'XYZ789')); return bytes; },
  } });
  assert.equal((await adapter.issue('new')).code, 'XYZ789');
  assert.deepEqual((await adapter.list()).find((item) => item.id === old.id), old);
});

test('API adapter sends the existing Bearer login, pagination and idempotency headers', async () => {
  const requests = [];
  const adapter = createApiAdapter({ basePath: '/api/admin/desktop-invites', accessToken: () => 'test-jwt', fetchImpl: async (url, options) => {
    requests.push({ url, ...options });
    return response(options.method === 'GET' ? { items: [invite] } : invite);
  } });
  assert.deepEqual(await adapter.listPage({ status: 'active', query: 'ABC234', cursor: 'next' }), { items: [invite], nextCursor: '' });
  assert.equal(requests[0].url, '/api/admin/desktop-invites?status=active&q=ABC234&cursor=next');
  await adapter.issue('request-1');
  assert.equal(requests[1].headers['Idempotency-Key'], 'request-1');
  assert.equal(requests[1].headers.Authorization, 'Bearer test-jwt');
  assert.equal(requests[0].headers.Authorization, 'Bearer test-jwt');
  assert.equal(requests[1].credentials, 'omit');
  assert.equal(requests[1].redirect, 'error');
  assert.equal(requests[1].cache, 'no-store');
  assert.equal(requests[1].body, '{}');
});

test('API configuration rejects remote endpoints and requests without a login', async () => {
  for (const basePath of ['https://example.test/invites', '//example.test/invites', '/api?token=x', '/api\\evil']) {
    assert.throws(() => createApiAdapter({ basePath }), /同源/);
  }
  let calls = 0;
  const adapter = createApiAdapter({ basePath: '/api/invites', accessToken: () => '', fetchImpl: async () => { calls += 1; } });
  await assert.rejects(adapter.issue('request-1'), /登录管理员/);
  assert.equal(calls, 0);
});

test('API errors and malformed success responses never produce a local invite', async () => {
  for (const status of [401, 403, 409, 429, 500]) {
    const adapter = createApiAdapter({ basePath: '/api/invites', accessToken: () => 'test', fetchImpl: async () => response({}, status) });
    await assert.rejects(adapter.issue('request-1'));
  }
  const adapter = createApiAdapter({ basePath: '/api/invites', accessToken: () => 'test', fetchImpl: async () => response({ ...invite, code: '<img>' }) });
  await assert.rejects(adapter.issue('request-1'), /格式/);
});

test('API timeout aborts the transport and reports a retriable result', async () => {
  const adapter = createApiAdapter({ basePath: '/api/invites', accessToken: () => 'test', timeoutMs: 5,
    fetchImpl: (_url, { signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(new DOMException('Timeout', 'AbortError')));
    }),
  });
  await assert.rejects(adapter.issue('request-1'), /请求超时/);
});

test('demo paging and full-code search match the server list contract', async () => {
  const storage = memoryStorage();
  const items = Array.from({ length: 25 }, (_, index) => ({
    ...invite, id: 'item-' + index, code: 'ABC2' + ALPHABET[index] + '3',
    status: index % 2 ? 'active' : 'used', createdAt: new Date(1700000000000 + index * 1000).toISOString(),
  }));
  storage.setItem(DEMO_KEY, JSON.stringify({ items, requests: {} }));
  const adapter = createDemoAdapter({ storage });
  const first = await adapter.listPage();
  assert.equal(first.items.length, 20); assert.equal(first.nextCursor, '20');
  const last = await adapter.listPage({ cursor: first.nextCursor });
  assert.equal(last.items.length, 5); assert.equal(last.nextCursor, '');
  assert.equal(new Set([...first.items, ...last.items].map(item => item.id)).size, 25);
  assert.equal((await adapter.listPage({ query: 'ABC' })).items.length, 0);
  assert.deepEqual((await adapter.listPage({ query: items[0].code.toLowerCase() })).items, [items[0]]);
  assert.equal((await adapter.listPage({ status: 'active' })).items.length, 12);
  await assert.rejects(adapter.listPage({ cursor: '-1' }), /分页/);
});
