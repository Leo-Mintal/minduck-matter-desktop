const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')
const { createController } = require('../src/local-exec/controller.cjs')
const { createNativeAccess, systemFolderFor } = require('../src/local-exec/system-folders.cjs')
const { validateCall } = require('../src/local-exec/contract.cjs')

const meta = { conversation_id: 'native-test', conversation_title: 'Native permissions', run_id: 'run1' }
async function fixture(t, probeAccess) {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'matter-native-access-')))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  let token = 'h.' + Buffer.from(JSON.stringify({ uid: 'u1', exp: Date.now() / 1000 + 600 })).toString('base64url') + '.s'
  let value = { root: path.join(root, 'Matter'), enabled: false, grants: {}, workspaces: {} }
  const controller = createController({ app: { getPath: () => path.join(root, 'profile') }, origin: 'https://matter.test', home: root,
    getContents: () => ({ isDestroyed: () => false, getURL: () => 'https://matter.test/c/native-test', executeJavaScriptInIsolatedWorld: async () => token }),
    store: { get: () => value, update: patch => (value = { ...value, ...patch }) },
    checkPermission: () => assert.fail('must not probe Full Disk Access'),
    onPermissionNeeded: () => assert.fail('must not open Full Disk Access settings'),
    resolvePath: async () => '/usr/bin:/bin:/usr/sbin:/sbin', probeAccess,
  })
  t.after(() => controller.dispose())
  await controller.refresh()
  const call = (name, args, extra = {}, signal) => controller.execute({ name, arguments: args, _matter: { ...meta, ...extra } }, signal)
  return { root, controller, call, logout: () => { token = '' } }
}

test('native access tool requires a concrete path and rejects command and permission spoofing', () => {
  assert.doesNotThrow(() => validateCall({ name: 'local_request_permission', arguments: { path: '~/Downloads', reason: '查找文件' }, _matter: meta }))
  for (const args of [{}, { path: '' }, { path: '~/Downloads', command: 'touch never' }, { path: '~/Downloads', granted: true }]) {
    assert.throws(() => validateCall({ name: 'local_request_permission', arguments: args, _matter: meta }))
  }
})

test('iCloud and third-party cloud folders route to their own file-provider resource', () => {
  const home = '/Users/example'
  assert.equal(systemFolderFor('~/Library/Mobile Documents/com~apple~CloudDocs/work/report.txt', home).label, 'iCloud 云盘')
  const drive = systemFolderFor('~/Library/CloudStorage/ExampleDrive/work', home)
  assert.equal(drive.root, home + '/Library/CloudStorage/ExampleDrive')
  assert.equal(systemFolderFor('~/Library/CloudStorage', home), null)
  assert.equal(systemFolderFor('~/Library/Mobile Documents/../Keychains', home), null)
})

test('native broker coalesces prompts, preserves denial, and never repeats it in the same run', async () => {
  let calls = 0
  const broker = createNativeAccess({ home: '/Users/example', denied: [], probeAccess: async () => {
    calls++; throw Object.assign(new Error('not permitted'), { code: 'EPERM' })
  } })
  const request = () => broker.request('~/Documents', { attempt: 'run1' })
  const results = await Promise.all([request(), request(), request()])
  assert.equal(calls, 1)
  for (const result of results) {
    assert.equal(result.status, 'os_access_denied')
    assert.equal(result.denied, true)
    assert.equal(result.denial_source, 'unknown')
    assert.equal(result.command_executed, false)
    assert.equal(result.retryable, false)
    assert.doesNotMatch(result.message, /不支持|完全磁盘访问|用户拒绝/)
  }
  await request(); assert.equal(calls, 1)
  await broker.request('~/Documents', { attempt: 'run2' }); assert.equal(calls, 2)
})

test('broker checks revocation after success and rejects forbidden paths before any native probe', async () => {
  let calls = 0, denied = false
  const broker = createNativeAccess({ home: '/Users/example', denied: ['/Users/example/.ssh'], probeAccess: async () => {
    calls++; if (denied) throw Object.assign(new Error('denied'), { code: 'EACCES' })
  } })
  assert.equal((await broker.request('~/Documents', { attempt: 'run1' })).status, 'granted')
  denied = true
  assert.equal((await broker.request('~/Documents', { attempt: 'run1' })).status, 'os_access_denied')
  await assert.rejects(broker.request('~/.ssh/key', { attempt: 'run1' }), /敏感/)
  assert.equal(calls, 2)
})

test('macOS executor becomes ready without querying FDA or opening Settings', { skip: process.platform !== 'darwin' }, async t => {
  const f = await fixture(t)
  assert.equal(f.controller.snapshot().enabled, true)
  assert.equal(f.controller.snapshot().permissionRequired, false)
  assert.equal(f.controller.snapshot().canRequestPermission, true)
  assert.equal((await f.call('local_shell', { command: 'printf workspace-ok' })).stdout, 'workspace-ok')
})

test('target denial stops before the command, preserves unrelated execution and is not unsupported', { skip: process.platform !== 'darwin' }, async t => {
  let probes = 0
  const f = await fixture(t, async () => { probes++; throw Object.assign(new Error('denied'), { code: 'EPERM' }) })
  await fs.mkdir(path.join(f.root, 'Documents'))
  const result = await f.call('local_shell', { cwd: '~/Documents', command: 'touch never' })
  assert.equal(result.status, 'os_access_denied')
  assert.equal(result.command_executed, false)
  assert.equal(result.denied, true)
  assert.equal(probes, 1)
  await assert.rejects(fs.stat(path.join(f.root, 'Documents/never')), { code: 'ENOENT' })
  await f.call('local_request_permission', { path: '~/Documents' }); assert.equal(probes, 1)
  assert.equal(f.controller.snapshot().enabled, true)
  assert.equal((await f.call('local_shell', { command: 'printf still-ready' })).stdout, 'still-ready')
})

test('native permission grant executes no command and allows the subsequent sandboxed call', { skip: process.platform !== 'darwin' }, async t => {
  const f = await fixture(t)
  await fs.mkdir(path.join(f.root, 'Documents'))
  const result = await f.call('local_request_permission', { path: '~/Documents' })
  assert.equal(result.status, 'granted')
  assert.equal(result.command_executed, false)
  assert.equal((await f.call('local_shell', { cwd: '~/Documents', command: 'printf native-ok' })).stdout, 'native-ok')
})

test('a late native result cannot continue after logout or cancellation', { skip: process.platform !== 'darwin' }, async t => {
  let release, started
  const waiting = new Promise(resolve => { started = resolve })
  const f = await fixture(t, async () => { started(); await new Promise(resolve => { release = resolve }) })
  await fs.mkdir(path.join(f.root, 'Documents'))
  const pending = f.call('local_shell', { cwd: '~/Documents', command: 'touch never' })
  await waiting; f.logout(); await f.controller.refresh(); release()
  await assert.rejects(pending, /取消|账号/)
  await assert.rejects(fs.stat(path.join(f.root, 'Documents/never')), { code: 'ENOENT' })
})

test('file worker preserves real POSIX denial without misreporting it as a user choice', { skip: process.platform !== 'darwin' }, async t => {
  const f = await fixture(t)
  const { path: filename } = await f.call('local_write_file', { path: 'no-read.txt', content: 'private' })
  await fs.chmod(filename, 0o000)
  try {
    const result = await f.call('local_read_file', { path: 'no-read.txt' })
    assert.equal(result.status, 'os_access_denied')
    assert.equal(result.error_code, 'EACCES')
    assert.equal(result.denial_source, 'unknown')
    assert.equal(result.may_have_partial_effects, false)
  } finally { await fs.chmod(filename, 0o600) }
})

test('waiting for native access does not withdraw Shell and refresh does not erase the waiting state', { skip: process.platform !== 'darwin' }, async t => {
  let release, started
  const waiting = new Promise(resolve => { started = resolve })
  const f = await fixture(t, async () => { started(); await new Promise(resolve => { release = resolve }) })
  const pending = f.call('local_request_permission', { path: '~/Documents' })
  await waiting
  assert.equal(f.controller.snapshot().state, '等待系统授权')
  assert.equal(f.controller.snapshot().ready, true)
  await f.controller.refresh()
  assert.equal(f.controller.snapshot().state, '等待系统授权')
  release(); await pending
  assert.equal(f.controller.snapshot().state, '在线')
})
