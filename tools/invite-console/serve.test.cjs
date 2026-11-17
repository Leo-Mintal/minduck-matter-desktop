'use strict';

const assert = require('node:assert/strict');
const http = require('node:http');
const { once } = require('node:events');
const test = require('node:test');
const { createInviteServer } = require('./serve.cjs');

async function listen(t, server) {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise((resolve) => server.close(resolve)));
  return `http://127.0.0.1:${server.address().port}`;
}

test('demo preview retains asset allowlist and never serves project files', async (t) => {
  const origin = await listen(t, createInviteServer());
  assert.equal((await fetch(origin)).status, 200);
  assert.match(await (await fetch(`${origin}/config.js`)).text(), /mode: 'demo'/);
  for (const route of ['/package.json', '/api/desktop-access/invites', '/%2e%2e/package.json']) {
    assert.equal((await fetch(`${origin}${route}`)).status, 404);
  }
  assert.equal((await fetch(origin, { method: 'POST' })).status, 404);
});

test('local API mode works independently of Web and forwards only invitation requests', async (t) => {
  const api = await listen(t, http.createServer(async (req, res) => {
    let body = '';
    for await (const part of req) body += part;
    assert.equal(req.headers['x-invite-console-key'], undefined);
    assert.equal(req.headers.authorization, undefined);
    assert.equal(req.headers.cookie, undefined);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ path: req.url, method: req.method,
      retryId: req.headers['idempotency-key'], body }));
  }));
  const origin = await listen(t, createInviteServer({ apiOrigin: api }));
  assert.equal((await fetch(origin, { redirect: 'manual' })).status, 200);
  for (const route of ['/src/main.tsx', '/api/auth/login', '/api/admin/desktop-activations/id/revoke']) {
    assert.equal((await fetch(origin + route)).status, 404);
  }
  const html = await fetch(origin);
  assert.equal(html.status, 200);
  assert.equal(html.headers.get('referrer-policy'), 'no-referrer');
  assert.match(await html.text(), /app\.js/);
  const config = await fetch(`${origin}/config.js`);
  const configText = await config.text();
  assert.match(configText, /mode: 'api'/);
  assert.match(configText, /apiBasePath: '\/api\/desktop-access\/invites'/);
  assert.doesNotMatch(configText, /secret|token|key=/i);
  assert.equal(config.headers.get('cache-control'), 'no-store');
  assert.equal((await fetch(`${origin}/internal/invites/package.json`)).status, 404);
  const redirect = await fetch(`${origin}/internal/invites`, { redirect: 'manual' });
  assert.equal(redirect.headers.get('location'), '/internal/invites/');
  assert.equal((await fetch(`${origin}/api/desktop-access/invites`)).status, 200);
  const result = await (await fetch(`${origin}/api/desktop-access/invites`, { method: 'POST',
    headers: { 'Idempotency-Key': 'retry-once', 'Content-Type': 'application/json' }, body: '{}' })).json();
  assert.deepEqual(result, { path: '/api/desktop-access/invites', method: 'POST',
    retryId: 'retry-once', body: '{}' });
  const revoke = await (await fetch(`${origin}/api/desktop-access/invites/invite-id/revoke-activation`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
  })).json();
  assert.deepEqual(revoke, { path: '/api/desktop-access/invites/invite-id/revoke-activation', method: 'POST',
    body: '{}' });
  const note = await (await fetch(`${origin}/api/desktop-access/invites/invite-id/note`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ note: '张三' }),
  })).json();
  assert.deepEqual(note, { path: '/api/desktop-access/invites/invite-id/note', method: 'POST', body: JSON.stringify({ note: '张三' }) });
  await new Promise((resolve, reject) => {
    http.get(origin, { headers: { Host: 'untrusted.example' } }, (response) => {
      assert.equal(response.statusCode, 400); response.resume(); response.on('end', resolve);
    }).on('error', reject);
  });
});

test('local proxy rejects non-loopback targets and reports unavailable upstream', async (t) => {
  for (const apiOrigin of ['https://example.com', 'http://example.com', 'http://127.0.0.1/path', 'http://user:pass@localhost']) {
    assert.throws(() => createInviteServer({ apiOrigin }));
  }
  const unused = http.createServer();
  unused.listen(0, '127.0.0.1');
  await once(unused, 'listening');
  const deadOrigin = `http://127.0.0.1:${unused.address().port}`;
  await new Promise((resolve) => unused.close(resolve));
  const origin = await listen(t, createInviteServer({ apiOrigin: deadOrigin }));
  assert.equal((await fetch(`${origin}/api/desktop-access/invites`)).status, 502);
  assert.match(await (await fetch(`${origin}/internal/invites/config.js`)).text(), /mode: 'api'/);
});
