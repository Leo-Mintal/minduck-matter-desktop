const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { createController } = require('../src/local-exec/controller.cjs')

async function fixture(t, overrides = {}) {
  const home = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'matter-path-access-')))
  t.after(() => fs.rm(home, { recursive: true, force: true }))
  let settings = { root: path.join(home, 'Matter'), enabled: false, grants: {}, workspaces: {} }
  const { prepare, ...options } = overrides
  if (prepare) await prepare({ home, settings })
  let token = 'h.' + Buffer.from(JSON.stringify({ uid: 'owner', exp: Date.now() / 1000 + 600 })).toString('base64url') + '.s'
  const questions = [], opened = []
  const controller = createController({
    app: { getPath: () => path.join(home, 'Library/Application Support/Minduck Matter') },
    home, origin: 'https://matter.test',
    getContents: () => ({ isDestroyed: () => false, getURL: () => 'https://matter.test/c/conv1', executeJavaScriptInIsolatedWorld: async () => token }),
    store: { get: () => settings, update: patch => (settings = { ...settings, ...patch }) },
    resolvePath: async () => '/usr/bin:/bin:/usr/sbin:/sbin',
    confirmAccess: async question => { questions.push(question); return true },
    openPath: async filename => { opened.push(filename); return '' }, ...options,
  })
  t.after(() => controller.dispose())
  await controller.refresh()
  const call = (name, args, meta = {}, signal) => controller.execute({ name, arguments: args,
    _matter: { conversation_id: 'conv1', conversation_title: 'File task', run_id: 'run1', ...meta } }, signal)
  return { home, controller, call, questions, opened, settings: () => settings, logout: () => { token = '' } }
}

test('read, permission, open and read-only Shell calls create no workspace or cache directories', { skip: process.platform !== 'darwin' }, async t => {
  const f = await fixture(t)
  const input = path.join(f.home, 'input.txt'); await fs.writeFile(input, 'hello')
  for (let i = 0; i < 3; i++) {
    const meta = { conversation_id: 'conv' + i }
    assert.equal((await f.call('local_read_file', { path: input }, meta)).content, '1: hello')
    assert.equal((await f.call('local_request_permission', { path: input }, meta)).status, 'granted')
    assert.equal((await f.call('local_open_file', { path: input }, meta)).status, 'open_requested')
    assert.equal((await f.call('local_shell', { command: 'pwd' }, meta)).stdout.trim(), f.home)
  }
  assert.deepEqual(await fs.readdir(f.home), ['input.txt'])
  assert.deepEqual(f.settings().workspaces, {})
})

test('only an actual write creates requested output directories and existing legacy files stay intact', { skip: process.platform !== 'darwin' }, async t => {
  const f = await fixture(t)
  const legacy = path.join(f.home, 'Matter/Old-conv1')
  await fs.mkdir(legacy, { recursive: true }); await fs.writeFile(path.join(legacy, 'keep.txt'), 'keep')
  const output = await f.call('local_write_file', { path: 'results/report.txt', content: 'report' })
  assert.equal(output.path, path.join(f.home, 'results/report.txt'))
  assert.equal(await fs.readFile(output.path, 'utf8'), 'report')
  assert.deepEqual(await fs.readdir(path.join(f.home, 'Matter')), ['Old-conv1'])
  assert.equal(await fs.readFile(path.join(legacy, 'keep.txt'), 'utf8'), 'keep')
})

test('selected config paths ask before reading, separate write access and constrain Shell outside cwd', { skip: process.platform !== 'darwin' }, async t => {
  const f = await fixture(t)
  await fs.writeFile(path.join(f.home, '.netrc'), 'example')
  await fs.writeFile(path.join(f.home, '.npmrc'), 'other')
  assert.equal((await f.call('local_read_file', { path: '~/.netrc' })).content, '1: example')
  assert.equal(f.questions.length, 1); assert.equal(f.questions[0].access, 'read')
  assert.equal((await f.call('local_shell', { command: 'cat .netrc' })).stdout, 'example')
  assert.notEqual((await f.call('local_shell', { command: 'cat .netrc' }, { conversation_id: 'conv2' })).exit_code, 0)
  assert.notEqual((await f.call('local_shell', { command: 'printf never > .netrc' })).exit_code, 0)
  assert.equal(await fs.readFile(path.join(f.home, '.netrc'), 'utf8'), 'example')
  const blocked = await f.call('local_shell', { command: 'cat .npmrc' })
  assert.notEqual(blocked.exit_code, 0)
  assert.equal(f.questions.length, 1)
  await f.call('local_write_file', { path: '~/.netrc', content: 'updated' })
  assert.equal(f.questions.length, 2); assert.equal(f.questions[1].access, 'write')
  assert.equal(await fs.readFile(path.join(f.home, '.netrc'), 'utf8'), 'updated')
  await f.call('local_read_file', { path: '~/.netrc' }, { run_id: 'run2' })
  assert.equal(f.questions.length, 3)
  await assert.rejects(f.call('local_request_permission', { path: '~/.ssh/key' }), /敏感路径/)
})

test('application data grants stay within the approved target, including Matter userData', { skip: process.platform !== 'darwin' }, async t => {
  const f = await fixture(t)
  const appData = path.join(f.home, 'Library/Application Support')
  for (const name of ['Example', 'Minduck Matter']) {
    const dir = path.join(appData, name); await fs.mkdir(dir, { recursive: true })
    await fs.writeFile(path.join(dir, 'note.txt'), name)
  }
  await f.call('local_request_permission', { path: path.join(appData, 'Example'), reason: '处理指定应用数据' })
  assert.equal(f.questions.length, 1); assert.equal(f.questions[0].reason, '处理指定应用数据')
  assert.equal((await f.call('local_shell', { command: 'cat "Library/Application Support/Example/note.txt"' })).stdout, 'Example')
  assert.notEqual((await f.call('local_shell', { command: 'cat "Library/Application Support/Minduck Matter/note.txt"' })).exit_code, 0)
  await f.call('local_read_file', { path: path.join(appData, 'Minduck Matter/note.txt') })
  assert.equal(f.questions.length, 2)
})

test('refusal stops before access and is remembered only for the current task', { skip: process.platform !== 'darwin' }, async t => {
  let questions = 0, probes = 0
  const f = await fixture(t, { confirmAccess: async () => { questions++; return false }, probeAccess: async () => { probes++ } })
  await fs.writeFile(path.join(f.home, '.pypirc'), 'private')
  for (const name of ['local_read_file', 'local_request_permission']) {
    const result = await f.call(name, { path: '~/.pypirc' })
    assert.equal(result.denied, true); assert.equal(result.command_executed, false)
    assert.equal(result.denial_source, 'matter')
  }
  assert.equal(questions, 1); assert.equal(probes, 0)
  await f.call('local_read_file', { path: '~/.pypirc' }, { run_id: 'run2' })
  assert.equal(questions, 2)
  assert.deepEqual(await fs.readdir(f.home), ['.pypirc'])
})

test('late confirmation cannot continue after logout or cancellation', { skip: process.platform !== 'darwin' }, async t => {
  let release, started
  const waiting = new Promise(resolve => { started = resolve })
  const f = await fixture(t, { confirmAccess: async () => { started(); return new Promise(resolve => { release = resolve }) } })
  await fs.writeFile(path.join(f.home, '.netrc'), 'private')
  const pending = f.call('local_write_file', { path: '~/.netrc', content: 'never' })
  await waiting; f.logout(); await f.controller.refresh(); release(true)
  await assert.rejects(pending, /取消|账号/)
  assert.equal(await fs.readFile(path.join(f.home, '.netrc'), 'utf8'), 'private')
})

test('all selected paths are available after approval and ordinary paths do not ask', { skip: process.platform !== 'darwin' }, async t => {
  const f = await fixture(t)
  for (const relative of ['.netrc', '.npmrc', '.pypirc', 'Library/Keychains/test.txt', 'Library/Messages/test.txt', 'Library/Mail/test.txt']) {
    const filename = path.join(f.home, relative)
    await fs.mkdir(path.dirname(filename), { recursive: true }); await fs.writeFile(filename, 'fixture')
    assert.equal((await f.call('local_read_file', { path: filename })).content, '1: fixture')
    assert.equal(f.questions.at(-1).path, filename)
  }
  assert.equal(f.questions.length, 6)
  await fs.writeFile(path.join(f.home, 'ordinary.txt'), 'ordinary')
  await f.call('local_read_file', { path: '~/ordinary.txt' })
  assert.equal(f.questions.length, 6)
})

test('a denied write revokes overlapping earlier grants and a cancelled approval cannot execute', { skip: process.platform !== 'darwin' }, async t => {
  let allow = true
  const f = await fixture(t, { confirmAccess: async () => allow })
  await fs.writeFile(path.join(f.home, '.netrc'), 'private')
  await f.call('local_read_file', { path: '~/.netrc' })
  allow = false
  assert.equal((await f.call('local_write_file', { path: '~/.netrc', content: 'never' })).denied, true)
  assert.notEqual((await f.call('local_shell', { command: 'cat .netrc' })).exit_code, 0)
  const abort = new AbortController(); abort.abort()
  await assert.rejects(f.call('local_read_file', { path: '~/.netrc' }, { run_id: 'run2' }, abort.signal), /取消/)
  assert.equal(await fs.readFile(path.join(f.home, '.netrc'), 'utf8'), 'private')
})

test('native access dialog defaults to refusal and preserves the exact path and task scope', async () => {
  const { createAccessDialog } = require('../src/local-exec/access-dialog.cjs')
  const calls = [], signal = new AbortController().signal
  const confirm = createAccessDialog({ dialog: { showMessageBox: async (_window, options) => { calls.push(options); return { response: 1 } } }, getWindow: () => ({ isDestroyed: () => false }) })
  assert.equal(await confirm({ path: '/example/.netrc', access: 'read', reason: '检查配置', conversation: 'Task', signal }), true)
  assert.equal(calls[0].defaultId, 0); assert.equal(calls[0].cancelId, 0)
  assert.match(calls[0].message, /读取/); assert.doesNotMatch(calls[0].message, /修改/)
  assert.match(calls[0].detail, /\/example\/\.netrc/); assert.match(calls[0].detail, /当前任务/)
  const unavailable = createAccessDialog({ dialog: { showMessageBox: () => assert.fail('must not show an unparented dialog') }, getWindow: () => null })
  assert.equal(await unavailable({ path: '/example/.netrc', access: 'read', signal }), false)
})

test('startup cleans old empty conversation folders without touching populated ones', async t => {
  const f = await fixture(t, { prepare: async ({ settings }) => {
    settings.workspaces = { conv1: 'Empty-conv1', conv2: 'Output-conv2' }
    await fs.mkdir(path.join(settings.root, 'Empty-conv1'), { recursive: true })
    await fs.mkdir(path.join(settings.root, 'Output-conv2'), { recursive: true })
    await fs.writeFile(path.join(settings.root, 'Output-conv2/report.txt'), 'report')
  } })
  assert.deepEqual(await fs.readdir(f.settings().root), ['Output-conv2'])
  await f.controller.refresh()
  assert.equal(await fs.readFile(path.join(f.settings().root, 'Output-conv2/report.txt'), 'utf8'), 'report')
})

test('an OS refusal after Matter approval cannot leave a usable Shell grant', { skip: process.platform !== 'darwin' }, async t => {
  const f = await fixture(t, { probeAccess: async () => { throw Object.assign(new Error('denied'), { code: 'EPERM' }) } })
  await fs.writeFile(path.join(f.home, '.netrc'), 'private')
  assert.equal((await f.call('local_request_permission', { path: '~/.netrc' })).status, 'os_access_denied')
  assert.notEqual((await f.call('local_shell', { command: 'cat .netrc' })).exit_code, 0)
})

test('an inaccessible unrelated config path does not block ordinary tasks', { skip: process.platform !== 'darwin' }, async t => {
  const f = await fixture(t)
  await fs.symlink('.npmrc', path.join(f.home, '.npmrc'))
  assert.equal((await f.call('local_shell', { command: 'printf ordinary-ok' })).stdout, 'ordinary-ok')
  assert.equal(f.questions.length, 0)
  assert.deepEqual(await fs.readdir(f.home), ['.npmrc'])
})
