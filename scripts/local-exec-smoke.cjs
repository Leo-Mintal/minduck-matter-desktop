// Isolated native Electron integration; never uses the installed app profile.
if (!process.versions.electron) {
  const fs = require('node:fs'), os = require('node:os'), path = require('node:path')
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'matter-electron-local-'))
  const result = require('node:child_process').spawnSync(require('electron'), [__filename, directory], { stdio: 'inherit', timeout: 60000, killSignal: 'SIGKILL' })
  fs.rmSync(directory, { recursive: true, force: true })
  if (result.error) console.error(result.error)
  process.exit(result.status ?? 1)
}
const { app, BrowserWindow, net, protocol } = require('electron')
// Surface asynchronous native/transport failures in CI instead of Electron's modal error dialog.
process.on('uncaughtException', error => { console.error(error); app.exit(1) })
const fs = require('node:fs/promises')
const path = require('node:path')
const http = require('node:http')
const assert = require('node:assert/strict')
const { WebSocketServer } = require('../vendor/coopanion/runtime/node_modules/ws')
const { createController } = require('../src/local-exec/controller.cjs')
const { createClientRuntime } = require('../src/client-runtime.cjs')
const { createBundledFrontendHandler } = require('../src/bundledFrontend.cjs')
const { canonical } = require('../src/local-exec/workspace.cjs')

app.setPath('userData', path.join(process.argv[2], 'profile'))
let root, window, controller, runtime, server, wsServer
const pending = new Map()
const networkRequests = []
let sequence = 0
const watchdog = setTimeout(() => { console.error('local execution smoke timed out'); app.exit(1) }, 45000)
async function until(predicate) {
  for (let i = 0; i < 300; i++) { const result = await predicate(); if (result) return result; await new Promise(resolve => setTimeout(resolve, 20)) }
  throw new Error('smoke condition timed out')
}
app.whenReady().then(async () => {
  root = await canonical(process.argv[2])
  const token = 'h.' + Buffer.from(JSON.stringify({ uid: 'smoke-user', exp: Math.floor(Date.now() / 1000) + 600 })).toString('base64url') + '.s'
  await fs.mkdir(path.join(root, 'web'))
  await fs.writeFile(path.join(root, 'web/index.html'), '<!doctype html><title>Matter smoke</title><main>Test</main>')
  server = http.createServer((request, response) => {
    const chunks = []
    request.on('data', chunk => chunks.push(chunk))
    request.on('end', () => {
      response.setHeader('Content-Type', 'application/json')
      response.end(JSON.stringify({ headers: request.headers, body: Buffer.concat(chunks).toString() }))
    })
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const origin = `http://127.0.0.1:${server.address().port}`
  wsServer = new WebSocketServer({ server, path: '/api/client-runtime/ws' })
  let socket
  wsServer.on('connection', ws => {
    socket = ws
    ws.on('message', raw => {
      const value = JSON.parse(raw)
      if (value.type === 'auth') {
        ws.send(JSON.stringify({ type: 'auth_ok', runtime_id: value.runtime_id }))
        ws.send(JSON.stringify({ jsonrpc: '2.0', id: 'init', method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: { localPermissions: { version: 1, mode: 'macos-native' } } } }))
      } else if (value.id === 'init') {
        assert.equal(value.result.capabilities.clientRuntime.version, 1)
        ws.send(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })); ws.send(JSON.stringify({type:'runtime_ready',runtime_context:'smoke-runtime-proof'}))
      } else if (value.id) {
        pending.get(value.id)?.(value); pending.delete(value.id)
      }
    })
  })
  function call(name, args, run = 'smoke-run') {
    const id = 'smoke-' + ++sequence
    const result = new Promise(resolve => pending.set(id, resolve))
    socket.send(JSON.stringify({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args,
      _matter: { conversation_id: 'smoke-conv', conversation_title: '本机执行测试', run_id: run } } }))
    return result
  }
  window = new BrowserWindow({ show: false, width: 1000, height: 760, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } })
  let stored = { root: path.join(root, 'Matter'), enabled: false, grants: {}, workspaces: {} }
  const store = { get: () => stored, update: patch => (stored = { ...stored, ...patch }) }
  const external = path.join(root, 'External'); await fs.mkdir(external)
  let granted = true, prompts = 0
  const home = path.join(root, 'test-home'), documents = path.join(home, 'Documents')
  await fs.mkdir(documents, { recursive: true })
  controller = createController({ app, safeStorage: { isEncryptionAvailable: () => true, decryptString: value => value.toString() },
    fetchImpl: net.fetch.bind(net), origin, getContents: () => window.webContents, store, home,
    checkPermission: () => assert.fail('FDA must not be queried'),
    probeAccess: async () => { prompts++; if (!granted) throw Object.assign(new Error('native access denied'), { code: 'EPERM' }) } })
  runtime = createClientRuntime({app,origin,localExec:controller,getContents:()=>window.webContents,fetchImpl:net.fetch.bind(net),bridgePort:19476, toolkit:{schemas:[],release(){},execute:async()=>({content:[]})}})
  window.webContents.session.webRequest.onBeforeSendHeaders((details, callback) => {
    const own = details.webContentsId == null || details.webContentsId === window.webContents.id || details.webContentsId === -1
    if (details.url.endsWith('/api/echo')) networkRequests.push({ webContentsId: details.webContentsId, resourceType: details.resourceType, own })
    callback({ requestHeaders: runtime.headers(details.requestHeaders, own ? details.url : 'https://invalid.local/') })
  })
  protocol.handle('http', createBundledFrontendHandler({ root: path.join(root, 'web'), origin, fetchImpl: net.fetch.bind(net), backendHeaders: (headers, url) => runtime.headers(headers, url) }))
  await window.loadURL(origin + '/c/smoke-conv')
  await window.webContents.executeJavaScript(`localStorage.setItem('matter.token',${JSON.stringify(token)})`)
  await controller.refresh(); assert.equal(prompts, 0); assert.equal(controller.snapshot().enabled, true)
  await runtime.refresh(); await until(() => runtime.snapshot().available)
  const request = await window.webContents.executeJavaScript(`fetch('/api/echo',{method:'POST',body:'native payload',headers:{Authorization:'Bearer '+localStorage.getItem('matter.token'),'X-Matter-Desktop':'spoof'}}).then(r=>r.json())`)
  assert.equal(request.headers['x-matter-runtime'], 'smoke-runtime-proof', JSON.stringify(networkRequests)); assert.equal(request.headers['x-matter-desktop'], undefined)
  assert.equal(request.body, 'native payload')
  const workspace = home
  const write = await call('local_write_file', { path: 'hello.txt', content: 'hello from Electron\n' })
  assert.equal(write.result.isError, false)
  assert.ok(JSON.parse(write.result.content[0].text).diff.includes('+hello from Electron'))
  assert.equal(await fs.readFile(path.join(workspace, 'hello.txt'), 'utf8'), 'hello from Electron\n')
  const read = await call('local_read_file', { path: 'hello.txt' })
  assert.ok(JSON.parse(read.result.content[0].text).content.includes('hello from Electron'))
  const shellCall = await call('local_shell', { command: 'printf shell-ok' })
  assert.equal(JSON.parse(shellCall.result.content[0].text).stdout, 'shell-ok')
  for (let i = 0; i < 2; i++) {
    const outside = await call('local_shell', { cwd: external, command: 'printf external-ok' })
    assert.equal(JSON.parse(outside.result.content[0].text).stdout, 'external-ok')
  }
  assert.deepEqual(stored.grants, {})
  const secret = path.join(home, '.ssh'); await fs.mkdir(secret)
  await fs.writeFile(path.join(secret, 'key'), 'private')
  const blocked = await call('local_shell', { command: 'cat ' + JSON.stringify(path.join(secret, 'key')) })
  const denied = JSON.parse(blocked.result.content[0].text)
  assert.equal(denied.sandbox_denied, true)
  assert.ok(denied.permission_hint.includes('系统权限'))
  assert.deepEqual(denied.allowed_directories, [workspace, '/'])
  // Disposable home and injected grant avoid changing the user's real TCC permissions.
  const standard = await call('local_shell', { cwd: documents, command: 'printf system-folder-ok' })
  assert.equal(JSON.parse(standard.result.content[0].text).stdout, 'system-folder-ok')
  const standardWrite = await call('local_write_file', { path: path.join(documents, 'note.txt'), content: 'system file' })
  assert.equal(standardWrite.result.isError, false)
  assert.equal(await fs.readFile(path.join(documents, 'note.txt'), 'utf8'), 'system file')
  assert.deepEqual(stored.grants, {})
  assert.equal(JSON.parse((await call('local_shell', { command: 'printf network-declared', needs_network: true })).result.content[0].text).stdout, 'network-declared')
  const networkURL = `http://127.0.0.1:${server.address().port}/network`
  const command = '/usr/bin/curl --noproxy "*" --silent --show-error --max-time 2 ' + networkURL
  assert.notEqual(JSON.parse((await call('local_shell', { command })).result.content[0].text).exit_code, 0)
  assert.equal(JSON.parse((await call('local_shell', { command, needs_network: true })).result.content[0].text).exit_code, 0)
  assert.equal(BrowserWindow.getAllWindows().length, 1, 'no local execution settings window')
  assert.equal(await window.webContents.executeJavaScript('typeof window.localSettings'), 'undefined')
  const interrupted = call('local_shell', { command: 'touch started; sleep 10; touch should-not-exist' })
  await until(() => fs.stat(path.join(workspace, 'started')).then(() => true, () => false))
  await controller.setEnabled(false); await controller.refresh()
  assert.equal(controller.snapshot().enabled, false)
  assert.equal((await interrupted).result.isError, true)
  await assert.rejects(controller.execute({ name: 'local_shell', arguments: { command: 'touch never' }, _matter: { conversation_id: 'smoke-conv', conversation_title: '' } }))
  await controller.setEnabled(true)
  granted = false
  const before = prompts
  const permission = JSON.parse((await call('local_request_permission', { path: documents })).result.content[0].text)
  assert.equal(permission.status, 'os_access_denied'); assert.equal(permission.denied, true)
  assert.equal(permission.command_executed, false); assert.equal(prompts, before + 1)
  const repeated = JSON.parse((await call('local_request_permission', { path: documents })).result.content[0].text)
  assert.equal(repeated.status, 'os_access_denied'); assert.equal(prompts, before + 1)
  assert.equal(controller.snapshot().enabled, true); assert.equal(controller.snapshot().permissionRequired, false)
  const unaffected = await call('local_shell', { command: 'printf workspace-still-ready' })
  assert.equal(JSON.parse(unaffected.result.content[0].text).stdout, 'workspace-still-ready')
  granted = true
  const continued = JSON.parse((await call('local_request_permission', { path: documents }, 'user-continue')).result.content[0].text)
  assert.equal(continued.status, 'granted'); assert.equal(continued.command_executed, false)
  const cancelled = await call('local_shell', { command: 'test ! -f should-not-exist && printf cancelled' })
  assert.equal(JSON.parse(cancelled.result.content[0].text).stdout, 'cancelled')
  await controller.setEnabled(false)
  const disabled = await window.webContents.executeJavaScript(`fetch('/api/echo',{headers:{Authorization:'Bearer '+localStorage.getItem('matter.token'),'X-Matter-Desktop':'spoof'}}).then(r=>r.json())`)
  assert.equal(disabled.headers['x-matter-desktop'], undefined)
  console.log('PASS native permission protocol, no FDA prerequisite, real Electron Shell/file worker, target denial stops before execution, unrelated workspace remains ready, explicit continuation, protected credentials, network restrictions and cancellation; permission decisions injected without changing real TCC')
}).catch(error => { console.error(error); process.exitCode = 1 }).finally(async () => {
  clearTimeout(watchdog); runtime?.dispose(); controller?.dispose()
  for (const client of wsServer?.clients || []) client.terminate()
  await new Promise(resolve => wsServer ? wsServer.close(resolve) : resolve())
  await new Promise(resolve => server ? server.close(resolve) : resolve())
  for (const value of BrowserWindow.getAllWindows()) value.destroy()
  app.exit(process.exitCode || 0)
})
