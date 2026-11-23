'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { webcrypto } = require('node:crypto');
const { readFileSync } = require('node:fs');
const { runInNewContext } = require('node:vm');
const { ALPHABET, DEMO_KEY, generateCode, validateInvite, matchesFilter, statusLabel, createDemoAdapter, createApiAdapter, createIssuer } = require('./core.js');

function memoryStorage() {
  const map = new Map();
  return { getItem: (key) => map.get(key) ?? null, setItem: (key, value) => map.set(key, value), removeItem: (key) => map.delete(key) };
}

const invite = { id: 'invite-1', code: 'ABC234', status: 'active', createdAt: '2026-11-16T08:00:00.000Z' };
const response = (value, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => value });

function httpPageCore() {
  const context = {
    crypto: { getRandomValues: webcrypto.getRandomValues.bind(webcrypto) },
    URLSearchParams, AbortController, setTimeout, clearTimeout,
  };
  runInNewContext(readFileSync(require.resolve('./core.js'), 'utf8'), context);
  return context.InviteCore;
}

test('HTTP issuance without crypto.randomUUID preserves single-flight and retry IDs across reloads', async () => {
  const core = httpPageCore();
  const storage = memoryStorage();
  const ids = [];
  const adapter = core.createApiAdapter({ basePath: '/api/desktop-access/invites',
    fetchImpl: async (_url, options) => {
      const id = options.headers['Idempotency-Key'];
      assert.equal(storage.getItem('http-pending'), id);
      assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
      ids.push(id);
      if (ids.length === 1) throw new Error('connection lost');
      return response(invite);
    },
  });
  const issuer = core.createIssuer({ adapter, storage, pendingKey: 'http-pending' });
  const first = issuer.issue();
  assert.strictEqual(issuer.issue(), first);
  await assert.rejects(first, /connection lost/);
  assert.equal(ids.length, 1);
  const reloaded = httpPageCore().createIssuer({ adapter, storage, pendingKey: 'http-pending' });
  await reloaded.issue();
  assert.equal(ids[0], ids[1]);
  assert.equal(storage.getItem('http-pending'), null);
  await reloaded.issue();
  assert.notEqual(ids[1], ids[2]);
});

test('HTTP demo issuance without crypto.randomUUID remains persistent and idempotent', async () => {
  const core = httpPageCore();
  const storage = memoryStorage();
  const adapter = core.createDemoAdapter({ storage });
  const first = await adapter.issue('http-demo-1');
  assert.match(first.id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  const reopened = core.createDemoAdapter({ storage });
  assert.equal((await reopened.issue('http-demo-1')).id, first.id);
  assert.notEqual((await reopened.issue('http-demo-2')).id, first.id);
});

test('notes persist in demo records, can be cleared, and never revive a code', async () => {
  const storage = memoryStorage();
  const adapter = createDemoAdapter({ storage, cryptoImpl: webcrypto });
  const item = await adapter.issue('note-request');
  await adapter.revoke(item.id);
  const note = '张三 <script>仅文本</script>';
  const updated = await adapter.updateNote(item.id, `  ${note}  `);
  assert.equal(updated.note, note);
  assert.equal(updated.status, 'revoked');
  const reopened = createDemoAdapter({ storage, cryptoImpl: webcrypto });
  assert.equal((await reopened.list())[0].note, note);
  assert.equal((await reopened.updateNote(item.id, ' \n ')).note, '');
  await assert.rejects(adapter.updateNote(item.id, '鸭'.repeat(201)), /200/);
  await assert.rejects(adapter.updateNote('missing', '备注'), /没有找到/);
  assert.throws(() => validateInvite({ ...invite, note: null }), /备注/);
  assert.throws(() => validateInvite({ ...invite, note: 3 }), /备注/);
});

test('API note updates use JSON with a same-origin admin session and validate their response', async () => {
  const calls = [];
  const adapter = createApiAdapter({ basePath: '/api/desktop-access/invites', fetchImpl: async (url, options) => {
    calls.push({ url, ...options });
    return response({ ...invite, note: JSON.parse(options.body).note });
  } });
  assert.equal((await adapter.updateNote(invite.id, ' 张三 ')).note, '张三');
  assert.equal(calls[0].url, '/api/desktop-access/invites/invite-1/note');
  assert.equal(calls[0].method, 'POST');
  assert.equal(calls[0].body, JSON.stringify({ note: '张三' }));
  assert.equal(calls[0].credentials, 'same-origin');
  assert.equal(calls[0].headers.Authorization, undefined);
  assert.equal(calls[0].headers['X-Invite-Console-Key'], undefined);
  assert.equal((await adapter.updateNote(invite.id, '')).note, '');
  await assert.rejects(adapter.updateNote(invite.id, '鸭'.repeat(201)), /200/);
  assert.equal(calls.length, 2);
  assert.equal(validateInvite({ ...invite, note: '🦆'.repeat(200) }).note, '🦆'.repeat(200));
});

test('expired device history keeps the expired label after reactivation moves its device link', () => {
  const used = { ...invite, status: 'used', usedAt: invite.createdAt,
    activation: { status: 'revoked', createdAt: invite.createdAt } };
  const history = validateInvite({ ...used, status: 'revoked', activation: undefined });
  assert.equal(statusLabel(used), '已过期');
  assert.equal(statusLabel(history), '已过期');
  assert.equal(history.usedAt, invite.createdAt);
  assert.equal(matchesFilter(history), false);
  assert.equal(matchesFilter(history, 'revoked'), true);
  assert.equal(statusLabel({ ...invite, status: 'revoked' }), '已作废');
  assert.equal(statusLabel({ ...invite, status: 'used' }), '已使用');
  assert.throws(() => validateInvite({ ...invite, usedAt: 'invalid' }), /核销时间格式/);
});

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

test('API adapter works with a same-origin admin session and preserves pagination and idempotency', async () => {
  const requests = [];
  const adapter = createApiAdapter({ basePath: '/api/desktop-access/invites', fetchImpl: async (url, options) => {
    requests.push({ url, ...options });
    return response(options.method === 'GET' ? { items: [invite] } : invite);
  } });
  assert.deepEqual(await adapter.listPage({ status: 'active', query: 'ABC234', cursor: 'next' }), { items: [invite], nextCursor: '' });
  assert.equal(requests[0].url, '/api/desktop-access/invites?status=active&q=ABC234&cursor=next');
  await adapter.issue('request-1');
  assert.equal(requests[1].headers['Idempotency-Key'], 'request-1');
  for (const request of requests) {
    assert.equal(request.headers['X-Invite-Console-Key'], undefined);
    assert.equal(request.headers.Authorization, undefined);
    assert.equal(request.headers.Cookie, undefined);
  }
  assert.equal(requests[1].referrerPolicy, 'no-referrer');
  assert.equal(requests[1].credentials, 'same-origin');
  assert.equal(requests[1].redirect, 'error');
  assert.equal(requests[1].cache, 'no-store');
  assert.equal(requests[1].body, '{}');
});

test('API configuration rejects remote endpoints', () => {
  for (const basePath of ['https://example.test/invites', '//example.test/invites', '/api?token=x', '/api\\evil']) {
    assert.throws(() => createApiAdapter({ basePath }), /同源/);
  }
});

test('API errors and malformed success responses never produce a local invite', async () => {
  for (const status of [401, 403, 404, 409, 429, 500, 503]) {
    const adapter = createApiAdapter({ basePath: '/api/invites', fetchImpl: async () => response({}, status) });
    await assert.rejects(adapter.issue('request-1'));
  }
  const adapter = createApiAdapter({ basePath: '/api/invites', fetchImpl: async () => response({ ...invite, code: '<img>' }) });
  await assert.rejects(adapter.issue('request-1'), /格式/);
});

test('API timeout aborts the transport and reports a retriable result', async () => {
  const adapter = createApiAdapter({ basePath: '/api/invites', timeoutMs: 5,
    fetchImpl: (_url, { signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(new DOMException('Timeout', 'AbortError')));
    }),
  });
  await assert.rejects(adapter.issue('request-1'), /请求超时/);
});

test('demo paging and partial-code search match the server list contract', async () => {
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
  assert.equal((await adapter.listPage({ query: 'abc' })).items.length, 20);
  assert.deepEqual((await adapter.listPage({ query: items[0].code.toLowerCase() })).items, [items[0]]);
  assert.equal((await adapter.listPage({ status: 'active' })).items.length, 12);
  await assert.rejects(adapter.listPage({ cursor: '-1' }), /分页/);
});

test('note search is case-insensitive, literal, and applied before pagination and status filters', async () => {
  const storage = memoryStorage();
  const items = Array.from({ length: 23 }, (_, index) => ({
    ...invite, id: 'note-' + index, code: 'ABC2' + ALPHABET[index] + '3',
    note: '发给 Alice 团队参加灰测', createdAt: new Date(1700000000000 + index * 1000).toISOString(),
  }));
  const special = { ...invite, id: 'special', code: 'XYZ789', note: '100%_!\\ 正常文字' };
  const revoked = { ...invite, id: 'revoked-note', code: 'DEF345', note: 'Alice 已作废', status: 'revoked' };
  const codeInNote = { ...invite, id: 'code-in-note', code: 'GHJ456', note: `备注提到 ${items[0].code}` };
  storage.setItem(DEMO_KEY, JSON.stringify({ items: [special, revoked, codeInNote, ...items], requests: {} }));
  const adapter = createDemoAdapter({ storage });
  const first = await adapter.listPage({ query: ' alice ' });
  assert.equal(first.items.length, 20);
  const tail = await adapter.listPage({ query: 'ALICE', cursor: first.nextCursor });
  assert.equal(tail.items.length, 3);
  assert.equal(new Set([...first.items, ...tail.items].map(item => item.id)).size, 23);
  assert.equal((await adapter.listPage({ status: 'revoked', query: 'alice' })).items[0].id, revoked.id);
  for (const query of ['%', '_', '!', '\\']) {
    assert.deepEqual((await adapter.listPage({ query })).items, [special]);
  }
  assert.equal((await adapter.listPage({ query: items[0].code.toLowerCase() })).items.length, 2);
  assert.equal((await adapter.listPage({ query: '发给 Alice 团队' })).items.length, 20);
  assert.equal((await adapter.listPage({ query: '不存在的备注' })).items.length, 0);
});

test('current and used filters hide invalidated codes and devices before pagination', async () => {
  const storage = memoryStorage();
  const used = { ...invite, id: 'used', code: 'DEF345', status: 'used',
    activation: { status: 'active', createdAt: invite.createdAt } };
  const revoked = { ...used, id: 'revoked-device', code: 'GHJ456',
    activation: { ...used.activation, status: 'revoked', revokedAt: invite.createdAt } };
  const items = [invite, used, revoked, ...Array.from({ length: 25 }, (_, i) => ({
    ...invite, id: 'void-' + i, code: 'XYZ2' + ALPHABET[i] + '3', status: 'revoked',
    createdAt: '2026-11-16T09:00:00.000Z',
  }))];
  storage.setItem(DEMO_KEY, JSON.stringify({ items, requests: {} }));
  const adapter = createDemoAdapter({ storage });
  const page = await adapter.listPage();
  assert.equal(page.items.length, 2);
  assert.equal(page.nextCursor, '');
  assert.deepEqual((await adapter.listPage({ status: 'used' })).items, [used]);
  assert.equal((await adapter.listPage({ status: 'revoked' })).items.length, 20);
  assert.deepEqual((await adapter.listPage({ status: 'revoked', query: revoked.code })).items, [revoked]);
  assert.equal(matchesFilter(revoked), false);
  assert.equal(matchesFilter(revoked, 'revoked'), true);
  assert.equal(matchesFilter(revoked, 'all'), true);
  await assert.rejects(adapter.revoke(used.id), /已使用/);
  await assert.rejects(adapter.revokeActivation(invite.id), /没有找到/);
  const result = await adapter.revokeActivation(used.id);
  assert.equal(result.status, 'used');
  assert.equal(result.activation.status, 'revoked');
  assert.equal((await adapter.listPage()).items.length, 1);
  const repeated = await adapter.revokeActivation(used.id);
  assert.equal(repeated.activation.revokedAt, result.activation.revokedAt);
});

test('API device revocation uses a same-origin admin session and preserves activation state safely', async () => {
  const calls = [];
  const item = { ...invite, status: 'used', activation: { status: 'revoked', createdAt: invite.createdAt,
    revokedAt: invite.createdAt, publicKeySPKI: 'must-not-retain', id: 'device-id' } };
  const adapter = createApiAdapter({ basePath: '/api/desktop-access/invites',
    fetchImpl: async (url, options) => { calls.push({ url, options }); return response(item); } });
  const result = await adapter.revokeActivation('invite-1');
  assert.equal(calls[0].url, '/api/desktop-access/invites/invite-1/revoke-activation');
  assert.equal(calls[0].options.method, 'POST');
  assert.equal(calls[0].options.headers['X-Invite-Console-Key'], undefined);
  assert.equal(calls[0].options.credentials, 'same-origin');
  assert.equal(result.activation.status, 'revoked');
  assert.equal(result.activation.publicKeySPKI, undefined);
  assert.equal(result.activation.id, undefined);
  for (const activation of [{ status: 'active' }, { status: 'other', createdAt: invite.createdAt },
    { status: 'revoked', createdAt: invite.createdAt, revokedAt: 'invalid' }]) {
    assert.throws(() => validateInvite({ ...item, activation }), /设备激活/);
  }
  assert.throws(() => validateInvite({ ...invite, activation: item.activation }), /设备激活/);
});


test('admin password session uses HttpOnly transport and preserves 401 for the gate', async () => {
  const requests = [];
  const adapter = createApiAdapter({ basePath: '/api/desktop-access/invites', fetchImpl: async (url, options) => {
    requests.push({ url, ...options });
    return response({ authenticated: options.method !== 'DELETE' });
  } });
  await adapter.session();
  await adapter.login('test-password');
  await adapter.logout();
  assert.deepEqual(requests.map(({ method }) => method), ['GET', 'POST', 'DELETE']);
  assert.equal(requests[1].body, JSON.stringify({ password: 'test-password' }));
  for (const request of requests) {
    assert.equal(request.url, '/api/desktop-access/invites/session');
    assert.equal(request.credentials, 'same-origin');
    assert.equal(request.headers['X-Invite-Console'], '1');
    assert.equal(request.headers.Authorization, undefined);
  }
  const denied = createApiAdapter({ basePath: '/api/desktop-access/invites', fetchImpl: async () => response({}, 401) });
  await assert.rejects(denied.session(), (error) => error.status === 401);
  const storage = memoryStorage();
  const issuer = createIssuer({ adapter: denied, storage, pendingKey: 'pending-auth', randomUUID: () => 'retry-after-login' });
  await assert.rejects(issuer.issue(), (error) => error.status === 401);
  assert.equal(storage.getItem('pending-auth'), 'retry-after-login');
});
