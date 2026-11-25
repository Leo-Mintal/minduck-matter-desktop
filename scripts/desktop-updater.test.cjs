const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const test = require('node:test')
const { createDesktopUpdater, macUpdateRuntime, prepareNativeUpdate, validateUpdateInfo } = require('../src/desktopUpdater.cjs')

function updateInfo(version = '0.1.8') {
  return { version, files: [{ url: `MinduckMatter-${version}-arm64.zip`,
    sha512: Buffer.alloc(64, 1).toString('base64'), size: 1024 }] }
}

function fixture(overrides = {}) {
  const updater = new EventEmitter(), nativeUpdater = new EventEmitter()
  const calls = [], states = [], dialogs = []
  updater.checkForUpdates = async () => {
    calls.push('check'); return { isUpdateAvailable: true, updateInfo: updateInfo() }
  }
  updater.downloadUpdate = async () => {
    calls.push('download'); updater.emit('download-progress', { percent: 57.9 }); return ['/cache/update.zip']
  }
  updater.quitAndInstall = () => calls.push('install')
  nativeUpdater.checkForUpdates = () => { calls.push('verify'); queueMicrotask(() => nativeUpdater.emit('update-downloaded')) }
  const controller = createDesktopUpdater({ updater, nativeUpdater, currentVersion: '0.1.7',
    showDialog: async (options) => { dialogs.push(options); return { response: 0 } },
    onState: (state) => states.push(state), prepareToQuit: async () => calls.push('stop'), logger: { error() {} },
    ...overrides })
  return { updater, nativeUpdater, controller, calls, states, dialogs }
}

test('silent checks are shared, validate the feed, and never download or prompt', async () => {
  const f = fixture()
  const first = f.controller.check(), second = f.controller.check()
  assert.equal(first, second)
  await first
  assert.equal(f.controller.snapshot().phase, 'available')
  assert.deepEqual(f.calls, ['check'])
  assert.deepEqual(f.dialogs, [])
})

test('checks reject untrusted URLs, mismatched versions, duplicate files and missing integrity data', async () => {
  for (const url of ['https://evil.example/update.zip', '../update.zip', 'MinduckMatter-0.1.6-arm64.zip',
    'MinduckMatter-0.1.8-arm64.zip?next=1', 'MinduckMatter-0.1.8-x64.zip']) {
    const info = updateInfo(); info.files[0].url = url
    assert.throws(() => validateUpdateInfo(info))
  }
  for (const change of [info => { info.files[0].sha512 = '' }, info => { info.files[0].size = -1 },
    info => { info.files.push(info.files[0]) }, info => { info.files = [] }]) {
    const info = updateInfo(); change(info); assert.throws(() => validateUpdateInfo(info))
  }
  const f = fixture()
  f.updater.checkForUpdates = async () => ({ isUpdateAvailable: true,
    updateInfo: { version: '0.1.8', files: [{ url: 'https://evil.example/update.zip' }] } })
  await f.controller.run()
  assert.equal(f.controller.snapshot().phase, 'error')
  assert.ok(!f.calls.includes('download'))
})

test('default confirmation offers only in-app update and downloads without opening a browser', async () => {
  const opened = [], confirmations = []
  const f = fixture({ openExternal: async url => opened.push(url), showDialog: async options => {
    confirmations.push(options)
    return { response: options.defaultId }
  } })
  await Promise.all([f.controller.run(), f.controller.run()])
  assert.equal(confirmations.length, 1)
  assert.deepEqual(confirmations[0].buttons, ['应用内更新并重启', '稍后'])
  assert.equal(confirmations[0].defaultId, 0)
  assert.equal(confirmations[0].cancelId, 1)
  assert.deepEqual(opened, [])
  assert.deepEqual(f.calls, ['check', 'download', 'verify', 'stop', 'install'])
  assert.equal(f.controller.snapshot().phase, 'installing')
})

test('one explicit in-app update downloads, verifies natively, stops children, then installs once', async () => {
  const f = fixture()
  const first = f.controller.run()
  await Promise.all([first, f.controller.run()])
  assert.deepEqual(f.calls, ['check', 'download', 'verify', 'stop', 'install'])
  assert.ok(f.states.some(state => state.phase === 'downloading' && state.percent === 57))
  assert.equal(f.controller.snapshot().phase, 'installing')
  assert.equal(f.nativeUpdater.listenerCount('error'), 0)
  await f.controller.run()
  assert.equal(f.calls.filter(call => call === 'install').length, 1)
})

test('cancelling the initial prompt leaves the installed app and download untouched', async () => {
  const f = fixture({ showDialog: async () => ({ response: 1 }) })
  await f.controller.run()
  assert.deepEqual(f.calls, ['check'])
  assert.equal(f.controller.snapshot().phase, 'available')
})

test('active tasks defer restart, and a later explicit action uses the downloaded package', async () => {
  let active = true
  const f = fixture({ hasActiveTasks: () => active,
    showDialog: async options => ({ response: options.title === '重启更新' ? 1 : 0 }) })
  await f.controller.run()
  assert.deepEqual(f.calls, ['check', 'download'])
  assert.equal(f.controller.snapshot().phase, 'downloaded')
  active = false
  await f.controller.run()
  assert.deepEqual(f.calls, ['check', 'download', 'verify', 'stop', 'install'])
})

test('a task starting during native preparation receives confirmation before any child stops', async () => {
  let active = false
  const f = fixture({ hasActiveTasks: () => active,
    showDialog: async options => ({ response: options.title === '重启更新' ? 1 : 0 }) })
  f.nativeUpdater.checkForUpdates = () => {
    active = true; queueMicrotask(() => f.nativeUpdater.emit('update-downloaded'))
  }
  await f.controller.run()
  assert.equal(f.controller.snapshot().phase, 'downloaded')
  assert.deepEqual(f.calls, ['check', 'download'])
})

test('background refresh cannot replace the selected update while its confirmation is open', async () => {
  let respond
  const f = fixture({ showDialog: () => new Promise(resolve => { respond = resolve }) })
  const action = f.controller.run()
  while (!respond) await new Promise(resolve => setImmediate(resolve))
  await f.controller.check()
  assert.deepEqual(f.calls, ['check'])
  respond({ response: 1 })
  await action
})

test('checksum/download failures never prepare native installation or stop the app, and can retry', async () => {
  const f = fixture()
  const download = f.updater.downloadUpdate
  f.updater.downloadUpdate = async () => { throw new Error('sha512 mismatch') }
  await f.controller.run()
  assert.equal(f.controller.snapshot().phase, 'error')
  assert.deepEqual(f.calls, ['check'])
  f.updater.downloadUpdate = download
  await f.controller.run()
  assert.equal(f.controller.snapshot().phase, 'installing')
})

test('native signature failure keeps children running and supports a fresh preparation attempt', async () => {
  const f = fixture()
  const prepare = f.nativeUpdater.checkForUpdates
  f.nativeUpdater.checkForUpdates = () => queueMicrotask(() => f.nativeUpdater.emit('error', new Error('signature mismatch')))
  await f.controller.run()
  assert.equal(f.controller.snapshot().phase, 'error')
  assert.equal(f.controller.snapshot().error, true)
  assert.ok(!f.calls.includes('stop'))
  assert.ok(!f.calls.includes('install'))
  f.nativeUpdater.checkForUpdates = prepare
  f.updater.checkForUpdates = async () => {
    f.calls.push('check'); return { isUpdateAvailable: true, updateInfo: updateInfo('0.1.9') }
  }
  await f.controller.run()
  assert.deepEqual(f.calls, ['check', 'download', 'check', 'download', 'verify', 'stop', 'install'])
  assert.equal(f.controller.snapshot().version, '0.1.9', 'a failed package cannot pin retries to an obsolete release')
})

test('a failure while stopping children prevents installation', async () => {
  const f = fixture({ prepareToQuit: async () => { throw new Error('child is still running') } })
  await f.controller.run()
  assert.equal(f.controller.snapshot().phase, 'error')
  assert.ok(!f.calls.includes('install'))
})

test('native preparation timeouts release their listeners', async () => {
  const native = new EventEmitter(); native.checkForUpdates = () => {}
  await assert.rejects(prepareNativeUpdate(native, 5), /超时/)
  assert.equal(native.listenerCount('error'), 0)
  assert.equal(native.listenerCount('update-downloaded'), 0)
})

test('older releases and unsupported runtimes never install', async () => {
  const f = fixture()
  f.updater.checkForUpdates = async () => ({ isUpdateAvailable: true, updateInfo: updateInfo('0.1.6') })
  await f.controller.run()
  assert.deepEqual(f.calls, [])
  assert.equal(f.controller.snapshot().available, false)
  assert.ok(macUpdateRuntime({ isPackaged: false }).unavailableReason.includes('开发'))
  assert.ok(macUpdateRuntime({ isPackaged: true }, 'win32', 'x64').unavailableReason)
  assert.ok(macUpdateRuntime({ isPackaged: true, isInApplicationsFolder: () => false }, 'darwin', 'arm64')
    .unavailableReason.includes('应用程序'))
})
