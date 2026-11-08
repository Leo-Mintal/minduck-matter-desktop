const nodeTest = require('node:test')
const test = (name, options, run) => typeof options === 'function'
  ? nodeTest(name, { timeout: 10000 }, options) : nodeTest(name, { timeout: 10000, ...options }, run)
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')
const { validateCall, tokenAccount, requestHeaders } = require('../src/local-exec/contract.cjs')
const { createWorkspaces, canonical } = require('../src/local-exec/workspace.cjs')
const { operation, revision } = require('../src/local-exec/file-worker.cjs')
const { runSandboxed, runProcess } = require('../src/local-exec/shell.cjs')
const { fileOperation } = require('../src/local-exec/files.cjs')
const { createStore, EXECUTION_POLICY } = require('../src/local-exec/store.cjs')
const { createPairing, deviceSocketURL } = require('../src/local-exec/pairing.cjs')
const { connectDesktop } = require('../src/local-exec/connection.cjs')
const { createController } = require('../src/local-exec/controller.cjs')
const { WebSocketServer } = require('../vendor/coopanion/runtime/node_modules/ws')

const meta = { conversation_id: 'conv1', conversation_title: 'Project' }
const jwt = uid => 'header.' + Buffer.from(JSON.stringify({ uid, exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url') + '.signature'
const safeStorage = { isEncryptionAvailable: () => true, encryptString: value => Buffer.from('encrypted:' + value), decryptString: value => value.toString().slice(10) }
async function temporary(t) {
  const root = await canonical(await fs.mkdtemp(path.join(os.tmpdir(), 'matter-local-test-')))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  return root
}
function memoryStore(root) { let value = { root, enabled: false, pairing: null, grants: {}, workspaces: {} }; return { get: () => value, update: patch => (value = { ...value, ...patch }) } }
async function until(predicate) {
  for (let i = 0; i < 100; i++) { if (predicate()) return; await new Promise(resolve => setTimeout(resolve, 10)) }
  assert.fail('condition timed out')
}

test('local contracts reject unknown fields, forged runtime arguments and invalid metadata', () => {
  assert.equal(validateCall({ name: 'local_shell', arguments: { command: 'echo hello' }, _matter: meta }).args.command, 'echo hello')
  for (const args of [{ command: 'x', env: {} }, { command: 'x', detached: true }, { command: 'x', _run_id: 'forged' }, { command: 'x', timeout_ms: 1 }, { command: 'x\0' }]) {
    assert.throws(() => validateCall({ name: 'local_shell', arguments: args, _matter: meta }))
  }
  assert.throws(() => validateCall({ name: 'toString', arguments: {}, _matter: meta }))
  assert.throws(() => validateCall({ name: 'local_read_file', arguments: { path: 'a' }, _matter: { ...meta, conversation_id: '../x' } }))
})

test('desktop headers require exact origin, ready pairing and matching request account', () => {
  const origin = 'https://matter.test'
  const options = { origin, url: origin + '/api/conversations', account: 'u1', pairing: { account: 'u1', origin, deviceId: 'desktop' }, ready: true }
  const input = { authorization: 'Bearer ' + jwt('u1'), 'x-matter-desktop': 'spoofed' }
  assert.equal(requestHeaders(input, options)['X-Matter-Desktop'], 'desktop')
  for (const patch of [{ ready: false }, { account: 'u2' }, { url: origin + '.evil/api/x' }, { url: origin + '/media/file' }]) {
    assert.equal(requestHeaders(input, { ...options, ...patch })['X-Matter-Desktop'], undefined)
    assert.equal(requestHeaders(input, { ...options, ...patch })['x-matter-desktop'], undefined)
  }
  assert.equal(tokenAccount('bad'), '')
})

test('store defaults off and saves private settings', async t => {
  const root = await temporary(t)
  const store = createStore(root)
  assert.equal(store.get().enabled, false)
  store.update({ enabled: true, executionPolicy: EXECUTION_POLICY })
  assert.equal((await fs.stat(path.join(root, 'local-exec/settings.json'))).mode & 0o777, 0o600)
  assert.equal(createStore(root).get().enabled, true)
})

test('workspace grants are explicit, scoped and reject replaced symlinks and sensitive paths', async t => {
  const root = await temporary(t)
  const home = path.join(root, 'home'); await fs.mkdir(home)
  const store = memoryStore(path.join(home, 'Matter'))
  const spaces = createWorkspaces({ store, userData: path.join(home, 'app'), home })
  const folder = await spaces.folder('conv1', 'Title')
  assert.equal(await spaces.folder('conv1', 'Renamed'), folder)
  assert.equal((await spaces.resolve('conv1', '', '../another.txt')).authorized, false)
  await assert.rejects(spaces.grant('conv1', home))
  await fs.mkdir(path.join(home, '.ssh'))
  await assert.rejects(spaces.resolve('conv1', '', path.join(home, '.ssh/key')))
  const grant = path.join(home, 'project'); await fs.mkdir(grant)
  await spaces.grant('conv1', grant)
  assert.equal((await spaces.resolve('conv1', '', path.join(grant, 'a.txt'))).authorized, true)
  assert.equal((await spaces.resolve('conv2', '', path.join(grant, 'a.txt'))).authorized, false)
  await fs.rename(grant, grant + '-old'); await fs.symlink(root, grant)
  await assert.rejects(spaces.roots('conv1', ''))
})

test('file edits require a prior matching read, unique context, and preserve literal replacement text', async t => {
  const root = await temporary(t), filename = path.join(root, 'a.txt')
  await fs.writeFile(filename, 'one\ntwo\ntwo\n')
  assert.throws(() => operation({ action: 'prepare-write', filename, args: { content: 'bad' }, expectedRevision: null }))
  const read = operation({ action: 'read', filename, args: { offset: 1, limit: 1 } })
  assert.equal(read.content, '2: two')
  assert.throws(() => operation({ action: 'prepare-edit', filename, args: { old_string: 'two', new_string: 'x' }, expectedRevision: read.revision }))
  const prepared = operation({ action: 'prepare-edit', filename, args: { old_string: 'two', new_string: '$&', replace_all: true }, expectedRevision: read.revision })
  assert.equal(prepared.after, 'one\n$&\n$&\n')
  await fs.writeFile(filename, 'external edit')
  assert.throws(() => operation({ action: 'commit', filename, args: { content: prepared.after }, expectedRevision: prepared.revision }))
  assert.equal(await fs.readFile(filename, 'utf8'), 'external edit')
  assert.equal(revision('same'), revision('same'))
})

test('pairing uses desktop kind, pins endpoint and encrypts token; revoke failures retain retry credential', async t => {
  const store = memoryStore(await temporary(t)), calls = []
  let failRevoke = false
  const pairing = createPairing({ store, safeStorage, origin: 'https://matter.test', version: 'test', fetchImpl: async (url, options) => {
    calls.push({ url, options })
    if (options.method === 'DELETE') return { ok: !failRevoke, status: failRevoke ? 503 : 204 }
    return { ok: true, status: 200, json: async () => url.endsWith('pairings')
      ? { code: 'pair-code', ws_url: 'wss://matter.test/api/extensions/device-link/ws' }
      : { device_id: 'desktop1', device_token: 'secret-device-token', ws_url: 'wss://matter.test/api/extensions/device-link/ws' } }
  } })
  await pairing.pair(jwt('u1'), 'u1')
  assert.equal(JSON.parse(calls[0].options.body).kind, 'desktop')
  assert.equal(pairing.token(), 'secret-device-token')
  assert.equal(JSON.stringify(store.get()).includes('secret-device-token'), false)
  assert.throws(() => deviceSocketURL('wss://evil.test/api/extensions/device-link/ws', 'https://matter.test'))
  assert.throws(() => deviceSocketURL('ws://matter.test/api/extensions/device-link/ws', 'https://matter.test'))
  failRevoke = true; await assert.rejects(pairing.revoke()); assert.ok(store.get().pairing)
  failRevoke = false; await pairing.revoke(); assert.equal(store.get().pairing, null)
})

test('real WebSocket desktop handshake, request deduplication and disconnect cancellation', async t => {
  const server = new WebSocketServer({ port: 0, host: '127.0.0.1' })
  await new Promise(resolve => server.once('listening', resolve))
  let socket, online = false, calls = 0, aborted = false
  const responses = []
  server.on('connection', ws => {
    socket = ws
    ws.on('message', data => {
      const value = JSON.parse(data)
      if (value.type === 'auth') { assert.equal(value.token, 'secret'); ws.send(JSON.stringify({ type: 'auth_ok', device_id: 'd1' })); ws.send(JSON.stringify({ jsonrpc: '2.0', id: 'init', method: 'initialize', params: { protocolVersion: '2025-06-18' } })) }
      else if (value.id === 'init') { assert.equal(value.result.capabilities.localExec.sandbox, 'seatbelt'); ws.send(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })) }
      else responses.push(value)
    })
  })
  const client = connectDesktop({ url: `ws://127.0.0.1:${server.address().port}`, token: 'secret', deviceId: 'd1', version: 'test', onState: state => { online = state === '在线' },
    execute: async (_params, signal) => { calls++; await new Promise(resolve => signal.addEventListener('abort', () => { aborted = true; resolve() }, { once: true })); return { exit_code: 0 } } })
  t.after(async () => { client.stop(); for (const client of server.clients) client.terminate(); await new Promise(resolve => server.close(resolve)) })
  await until(() => online)
  const call = { jsonrpc: '2.0', id: 'call1', method: 'tools/call', params: {} }
  socket.send(JSON.stringify(call)); socket.send(JSON.stringify(call))
  await until(() => responses.length === 1)
  assert.ok(responses[0].error); assert.equal(calls, 1)
  socket.close(); await until(() => aborted)
})

test('actual macOS sandbox permits project work, blocks outside reads/writes and excludes secrets', { skip: process.platform !== 'darwin' }, async t => {
  const root = await temporary(t), workspace = path.join(root, 'workspace'), outside = path.join(root, 'outside.txt')
  await fs.mkdir(workspace); await fs.writeFile(outside, 'private')
  const options = { roots: [workspace], cwd: workspace }
  process.env.MATTER_LOCAL_TEST_SECRET = 'must-not-leak'
  try {
    const ok = await runSandboxed(options, '/bin/zsh', ['-f', '-c', 'printf okay > a.txt; cat a.txt; printenv MATTER_LOCAL_TEST_SECRET'])
    assert.equal(ok.stdout, 'okay'); assert.equal(ok.exit_code, 1)
    const denied = await runSandboxed(options, '/bin/cat', [outside]); assert.notEqual(denied.exit_code, 0)
    const write = await runSandboxed(options, '/bin/zsh', ['-f', '-c', `echo bad > '${outside}'`]); assert.notEqual(write.exit_code, 0)
    assert.equal(await fs.readFile(outside, 'utf8'), 'private')
    const read = await fileOperation({ action: 'read', filename: path.join(workspace, 'a.txt'), args: {} }, options)
    assert.equal(read.content, '1: okay')
    await fileOperation({ action: 'commit', filename: path.join(workspace, 'a.txt'), expectedRevision: read.revision, args: { content: 'updated' } }, options)
    assert.equal(await fs.readFile(path.join(workspace, 'a.txt'), 'utf8'), 'updated')
  } finally { delete process.env.MATTER_LOCAL_TEST_SECRET }
})

test('shell truncates output, times out, cancels process groups and closes background descendants', async t => {
  const root = await temporary(t)
  const output = await runProcess('/bin/zsh', ['-f', '-c', 'printf 123456789'], { cwd: root, env: {}, outputLimit: 4 })
  assert.equal(output.stdout, '1234', JSON.stringify(output)); assert.equal(output.stdout_truncated, true)
  const timeout = await runProcess('/bin/zsh', ['-f', '-c', 'sleep 10'], { cwd: root, env: {}, timeoutMs: 30 })
  assert.equal(timeout.timed_out, true, JSON.stringify(timeout))
  const controller = new AbortController()
  const cancelled = runProcess('/bin/zsh', ['-f', '-c', 'sleep 10 & wait'], { cwd: root, env: {}, signal: controller.signal })
  setTimeout(() => controller.abort(), 30)
  const receipt = await cancelled
  assert.equal(receipt.cancelled, true, JSON.stringify(receipt))
  const started = Date.now()
  await runProcess('/bin/zsh', ['-f', '-c', 'sleep 10 & echo complete'], { cwd: root, env: {}, timeoutMs: 2000 })
  assert.ok(Date.now() - started < 1000)
})

test('actual macOS sandbox denies outbound networking unless explicitly enabled', { skip: process.platform !== 'darwin' }, async t => {
  const root = await temporary(t)
  const server = require('node:http').createServer((_request, response) => response.end('network-ok'))
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise(resolve => server.close(resolve)))
  const url = `http://127.0.0.1:${server.address().port}/`
  const options = { roots: [root], cwd: root }
  const args = ['--noproxy', '*', '--silent', '--show-error', '--max-time', '2', url]
  const denied = await runSandboxed(options, '/usr/bin/curl', args)
  assert.notEqual(denied.exit_code, 0)
  const allowed = await runSandboxed({ ...options, network: true }, '/usr/bin/curl', args)
  assert.equal(allowed.exit_code, 0, allowed.stderr)
  assert.equal(allowed.stdout, 'network-ok')
})


test('old per-command consent does not enable automatic execution', async t => {
  const root = await temporary(t), store = createStore(root)
  store.update({ enabled: true, setupSeen: true, allowNetwork: true })
  const loaded = createStore(root).get()
  assert.equal(loaded.enabled, false); assert.equal(loaded.setupSeen, false); assert.equal(loaded.allowNetwork, false)
})

test('workspace-v1 consent does not silently allow the new system folder scope', async t => {
  const root = await temporary(t), store = createStore(root)
  store.update({ enabled: true, setupSeen: true, allowNetwork: true, executionPolicy: 'workspace-v1' })
  const loaded = createStore(root).get()
  assert.equal(loaded.enabled, false); assert.equal(loaded.setupSeen, false); assert.equal(loaded.allowNetwork, false)
})

async function controllerFixture(t, initiallyGranted = true, options = {}) {
  const root = await temporary(t), store = options.store || memoryStore(path.join(root, 'Matter'))
  let currentToken = jwt('u1'), permission = initiallyGranted, prompts = 0, pairs = 0, stops = 0, connectionOptions
  let url = 'https://matter.test/c/conv1'
  const contents = { isDestroyed: () => false, getURL: () => url, executeJavaScriptInIsolatedWorld: async () => currentToken }
  const controller = createController({ app: { getPath: () => path.join(root, 'profile'), getVersion: () => 'test' }, safeStorage,
    origin: 'https://matter.test', getContents: () => contents, store, home: root, checkPermission: () => permission,
    resolvePath: async () => '/usr/bin:/bin:/usr/sbin:/sbin', onPermissionNeeded: () => prompts++, connectImpl: value => { connectionOptions = value; value.onState('在线'); return { stop: () => stops++ } },
    fetchImpl: async route => { if (route.endsWith('pairings')) pairs++
      return { ok: true, status: 200, json: async () => route.endsWith('pairings')
        ? { code: 'pair', ws_url: 'wss://matter.test/api/extensions/device-link/ws' }
        : { device_id: 'test-desktop', device_token: 'secret', ws_url: 'wss://matter.test/api/extensions/device-link/ws' } }
    }, ...options })
  t.after(() => controller.dispose())
  await controller.refresh()
  const call = (name, args, signal) => controller.execute({ name, arguments: args, _matter: meta }, signal)
  return { root, store, controller, call, permission: value => { permission = value }, token: value => { currentToken = jwt(value) },
    url: value => { url = value }, prompts: () => prompts, pairs: () => pairs, stops: () => stops, revoke: () => connectionOptions.onRevoked() }
}

test('missing FDA prevents pairing and execution even with old saved enabled flags', async t => {
  const f = await controllerFixture(t, false)
  f.store.update({ enabled: true, executionPolicy: EXECUTION_POLICY })
  await f.controller.refresh()
  assert.equal(f.pairs(), 0); assert.equal(f.controller.snapshot().enabled, false)
  await assert.rejects(f.controller.setEnabled(true), /完全磁盘访问/)
  await assert.rejects(f.call('local_shell', { command: 'touch never' }))
  f.permission(true); await f.controller.refresh()
  assert.equal(f.pairs(), 1); assert.equal(f.controller.snapshot().enabled, true)
})

test('system permission automatically pairs; repeated refresh and version upgrade reuse encrypted identity', async t => {
  const f = await controllerFixture(t)
  assert.equal(f.controller.snapshot().enabled, true); assert.equal(f.pairs(), 1); assert.equal(f.prompts(), 0)
  await f.controller.refresh(); await f.controller.refresh()
  assert.equal(f.pairs(), 1)
  const previous = f.store.get().pairing
  f.controller.dispose()
  const restarted = await controllerFixture(t, true, { store: f.store })
  assert.equal(restarted.pairs(), 0); assert.deepEqual(restarted.store.get().pairing, previous)
  assert.equal(JSON.stringify(restarted.controller.snapshot()).includes('encryptedToken'), false)
})

test('revocation stops transport and blocks execution; regrant reconnects without pairing again', async t => {
  const f = await controllerFixture(t)
  f.permission(false)
  await assert.rejects(f.call('local_shell', { command: 'touch never' }))
  await f.controller.refresh()
  assert.equal(f.controller.snapshot().enabled, false); assert.equal(f.stops(), 1)
  f.permission(true); await f.controller.refresh()
  assert.equal(f.controller.snapshot().enabled, true); assert.equal(f.pairs(), 1)
  f.revoke(); await f.controller.refresh()
  assert.equal(f.controller.snapshot().enabled, false); assert.equal(f.pairs(), 1, 'server revocation is not silently repaired in this session')
})

test('account or origin changes invalidate old execution and pair only the current Matter account', async t => {
  const f = await controllerFixture(t)
  f.token('u2')
  await assert.rejects(f.call('local_shell', { command: 'touch never' }))
  await f.controller.refresh()
  assert.equal(f.store.get().pairing.account, 'u2'); assert.equal(f.pairs(), 2)
  f.url('https://untrusted.test/c/conv1'); await f.controller.refresh()
  assert.equal(f.controller.snapshot().enabled, false)
  await assert.rejects(f.call('local_read_file', { path: 'hello.txt' }))
})

test('failed automatic pairing backs off and cannot enable execution', async t => {
  let requests = 0
  const f = await controllerFixture(t, true, { fetchImpl: async () => { requests++; throw Error('offline') } })
  await f.controller.refresh(); await f.controller.refresh()
  assert.equal(requests, 1); assert.equal(f.controller.snapshot().enabled, false)
})

test('automatic workspace writes and Shell preserve file conflicts and cancellation', { skip: process.platform !== 'darwin' }, async t => {
  const f = await controllerFixture(t)
  const write = await f.call('local_write_file', { path: 'hello.txt', content: 'hello' })
  assert.ok(write.diff.includes('+hello'))
  assert.equal((await f.call('local_shell', { command: 'cat hello.txt' })).stdout, 'hello')
  const workspace = path.join(f.store.get().root, f.store.get().workspaces.conv1)
  await fs.writeFile(path.join(workspace, 'hello.txt'), 'external change')
  await assert.rejects(f.call('local_write_file', { path: 'hello.txt', content: 'stale overwrite' }))
  await f.call('local_read_file', { path: 'hello.txt' })
  assert.ok((await f.call('local_edit_file', { path: 'hello.txt', old_string: 'external change', new_string: 'updated' })).diff.includes('+updated'))
  const abort = new AbortController(); abort.abort()
  await assert.rejects(f.call('local_shell', { command: 'touch never' }, abort.signal))
  await f.controller.setEnabled(false)
  await assert.rejects(f.call('local_shell', { command: 'touch never' }))
})

test('FDA mode accesses external projects and standard folders without a picker or per-folder consent', { skip: process.platform !== 'darwin' }, async t => {
  const f = await controllerFixture(t)
  for (const folder of ['project', 'Desktop', 'Documents', 'Downloads']) {
    const directory = path.join(f.root, folder); await fs.mkdir(directory)
    assert.equal((await f.call('local_shell', { cwd: directory, command: 'printf system-ok' })).stdout, 'system-ok')
    const filename = path.join(directory, 'note.txt')
    await f.call('local_write_file', { path: filename, content: 'hello' })
    assert.ok((await f.call('local_read_file', { path: filename })).content.includes('hello'))
  }
  assert.deepEqual(f.store.get().grants, {})
})

test('FDA retains sensitive path and symlink protections for reads and writes, including Shell', { skip: process.platform !== 'darwin' }, async t => {
  const f = await controllerFixture(t)
  const secret = path.join(f.root, '.ssh'); await fs.mkdir(secret)
  const filename = path.join(secret, 'key'); await fs.writeFile(filename, 'private')
  await fs.symlink(secret, path.join(f.root, 'alias'))
  for (const target of [filename, path.join(f.root, 'alias/key')]) {
    await assert.rejects(f.call('local_read_file', { path: target }), /敏感路径/)
    await assert.rejects(f.call('local_write_file', { path: target, content: 'bad' }), /敏感路径/)
    const shell = await f.call('local_shell', { command: 'cat ' + JSON.stringify(target) + '; echo bad > ' + JSON.stringify(target) })
    assert.notEqual(shell.exit_code, 0); assert.equal(shell.sandbox_denied, true)
  }
  assert.equal(await fs.readFile(filename, 'utf8'), 'private')
})

test('tilde resolves against home; scoped workspaces remain available for callers without system access', async t => {
  const root = await temporary(t), home = path.join(root, 'home'); await fs.mkdir(home)
  const store = memoryStore(path.join(home, 'Matter')), spaces = createWorkspaces({ store, home })
  const result = await spaces.resolve('conv1', '', '~/Desktop')
  assert.equal(result.filename, path.join(home, 'Desktop')); assert.equal(result.authorized, false)
  await assert.rejects(spaces.grant('conv1', home))
})
