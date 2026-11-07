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

async function controllerFixture(t, choose = async () => ({ canceled: true, filePaths: [] }), options = {}) {
  const root = await temporary(t), store = memoryStore(path.join(root, 'Matter'))
  let currentToken = jwt('u1'), setup = 0, picks = 0
  const contents = { isDestroyed: () => false, getURL: () => 'https://matter.test/c/conv1', executeJavaScriptInIsolatedWorld: async () => currentToken }
  const controller = createController({ app: { getPath: () => path.join(root, 'profile'), getVersion: () => 'test' }, safeStorage,
    origin: 'https://matter.test', getContents: () => contents, getWindow: () => null, store, home: root, ...options,
    dialog: { showOpenDialog: async options => { picks++; return choose(options) } }, onSetupNeeded: () => setup++ })
  t.after(() => controller.dispose())
  await controller.refresh()
  const activate = () => store.update({ enabled: true, executionPolicy: EXECUTION_POLICY, pairing: { account: 'u1', origin: 'https://matter.test' } })
  const call = (name, args, signal) => controller.execute({ name, arguments: args, _matter: meta }, signal)
  return { root, store, controller, call, activate, token: value => { currentToken = jwt(value) }, setup: () => setup, picks: () => picks }
}

test('first login presents setup once; closing feature or changing account blocks execution', async t => {
  const f = await controllerFixture(t)
  await f.controller.refresh(); assert.equal(f.setup(), 1)
  await assert.rejects(f.call('local_shell', { command: 'touch never' }))
  f.controller.acknowledgeSetup(); assert.equal(f.store.get().setupSeen, true)
  f.activate()
  f.store.update({ allowNetwork: true })
  f.token('u2'); await f.controller.refresh()
  assert.equal(f.controller.snapshot().enabled, false)
  assert.equal(f.controller.snapshot().allowNetwork, false)
  assert.equal(JSON.stringify(f.controller.snapshot()).includes('encryptedToken'), false)
  await assert.rejects(f.call('local_shell', { command: 'touch never' }))
})

test('authorized workspace writes and Shell execute automatically; file conflicts still fail', { skip: process.platform !== 'darwin' }, async t => {
  const f = await controllerFixture(t); f.activate()
  const write = await f.call('local_write_file', { path: 'hello.txt', content: 'hello' })
  assert.ok(write.diff.includes('+hello'))
  const shell = await f.call('local_shell', { command: 'cat hello.txt' })
  assert.equal(shell.stdout, 'hello'); assert.equal(f.picks(), 0)
  const workspace = path.join(f.store.get().root, f.store.get().workspaces.conv1)
  await fs.writeFile(path.join(workspace, 'hello.txt'), 'external change')
  await assert.rejects(f.call('local_write_file', { path: 'hello.txt', content: 'stale overwrite' }))
  await f.call('local_read_file', { path: 'hello.txt' })
  const edit = await f.call('local_edit_file', { path: 'hello.txt', old_string: 'external change', new_string: 'updated' })
  assert.ok(edit.diff.includes('+updated'))
  await f.controller.setEnabled(false)
  await assert.rejects(f.call('local_shell', { command: 'touch never' }))
})

test('external cwd automatically opens native picker once and persists only for that conversation', { skip: process.platform !== 'darwin' }, async t => {
  let external
  const f = await controllerFixture(t, async options => {
    assert.equal(options.defaultPath, external)
    assert.ok(options.message.includes('无需逐次确认'))
    return { canceled: false, filePaths: [external] }
  })
  external = path.join(f.root, 'project'); await fs.mkdir(external); f.activate()
  assert.equal((await f.call('local_shell', { cwd: external, command: 'printf directory-ok' })).stdout, 'directory-ok')
  assert.equal((await f.call('local_shell', { cwd: external, command: 'printf remembered' })).stdout, 'remembered')
  assert.equal(f.picks(), 1); assert.deepEqual(f.store.get().grants.conv1, [external])
  const spaces = createWorkspaces({ store: f.store })
  assert.equal((await spaces.resolve('conv2', '', external)).authorized, false)
})

test('standard folders use system access before the sandbox and never show a picker', { skip: process.platform !== 'darwin' }, async t => {
  const requests = []
  const f = await controllerFixture(t, undefined, { requestSystemFolder: async folder => { requests.push(folder.root); return true } })
  const documents = path.join(f.root, 'Documents'); await fs.mkdir(documents); f.activate()
  assert.equal((await f.call('local_shell', { cwd: documents, command: 'printf native-ok' })).stdout, 'native-ok')
  await fs.writeFile(path.join(documents, 'note.txt'), 'native file')
  assert.ok((await f.call('local_read_file', { path: path.join(documents, 'note.txt') })).content.includes('native file'))
  assert.deepEqual(requests, [documents, documents]); assert.equal(f.picks(), 0)
  assert.deepEqual(f.store.get().grants.conv1, [documents])
  assert.equal((await createWorkspaces({ store: f.store, home: f.root }).resolve('conv2', '', documents)).authorized, false)
})

for (const mode of ['denied', 'account', 'abort', 'disable']) test(`system folder ${mode} cannot grant or execute`, async t => {
  let finish, entered = false
  const f = await controllerFixture(t, undefined, { requestSystemFolder: () => {
    entered = true; return new Promise((resolve, reject) => { finish = () => mode === 'denied'
      ? reject(Object.assign(new Error('macOS denied'), { denied: true })) : resolve(true) })
  } })
  const documents = path.join(f.root, 'Documents'); await fs.mkdir(documents); f.activate()
  const abort = new AbortController()
  const result = assert.rejects(f.call('local_shell', { cwd: documents, command: 'touch never' }, abort.signal))
  await until(() => entered)
  if (mode === 'account') f.token('u2')
  if (mode === 'abort') abort.abort()
  if (mode === 'disable') await f.controller.setEnabled(false)
  finish(); await result
  assert.deepEqual(f.store.get().grants, {}); assert.equal(f.picks(), 0)
  await assert.rejects(fs.stat(path.join(documents, 'never')))
})

for (const mode of ['cancel', 'account', 'abort', 'disable']) test(`native picker ${mode} cannot grant or execute`, async t => {
  let resolvePicker, entered = false
  const f = await controllerFixture(t, () => { entered = true; return new Promise(resolve => { resolvePicker = resolve }) })
  const external = path.join(f.root, 'outside'); await fs.mkdir(external); f.activate()
  const abort = new AbortController()
  const result = assert.rejects(f.call('local_shell', { cwd: external, command: 'touch never' }, abort.signal))
  await until(() => entered)
  if (mode === 'account') f.token('u2')
  if (mode === 'abort') abort.abort()
  if (mode === 'disable') await f.controller.setEnabled(false)
  resolvePicker({ canceled: mode === 'cancel', filePaths: mode === 'cancel' ? [] : [external] })
  await result
  assert.deepEqual(f.store.get().grants, {}); await assert.rejects(fs.stat(path.join(external, 'never')))
})

test('tilde paths resolve against home and still require a scoped grant', async t => {
  const root = await temporary(t), home = path.join(root, 'home'); await fs.mkdir(home)
  const store = memoryStore(path.join(home, 'Matter')), spaces = createWorkspaces({ store, home })
  const result = await spaces.resolve('conv1', '', '~/Desktop')
  assert.equal(result.filename, path.join(home, 'Desktop')); assert.equal(result.authorized, false)
  await assert.rejects(spaces.grant('conv1', home))
})

test('network requires persistent native consent in addition to needs_network', { skip: process.platform !== 'darwin' }, async t => {
  const f = await controllerFixture(t); f.activate()
  const denied = await f.call('local_shell', { command: 'touch never', needs_network: true })
  assert.equal(denied.permission_required, 'network')
  const spaces = createWorkspaces({ store: f.store })
  await assert.rejects(fs.stat(path.join(await spaces.folder('conv1', ''), 'never')))
  // Persistent policy change is tested through the settings IPC in the Electron smoke.
  f.store.update({ allowNetwork: true })
  assert.equal((await f.call('local_shell', { command: 'printf allowed', needs_network: true })).stdout, 'allowed')
})
