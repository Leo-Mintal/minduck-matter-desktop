const assert = require('node:assert/strict')
const test = require('node:test')
const { FULL_DISK_ACCESS_SETTINGS_URL, hasFullDiskAccess, shouldPromptForFullDiskAccess, createPermissionPrompt } = require('../src/fullDiskAccess.cjs')

test('permission prompt follows actual OS grant, never a saved acknowledgement or app version', () => {
  const base = { platform: 'darwin', promptedThisSession: false, settings: { fullDiskAccessPromptAcknowledged: true } }
  assert.equal(shouldPromptForFullDiskAccess(base), true)
  assert.equal(shouldPromptForFullDiskAccess({ ...base, promptedThisSession: true }), false)
  assert.equal(shouldPromptForFullDiskAccess({ ...base, permissionGranted: true }), false)
  assert.equal(shouldPromptForFullDiskAccess({ ...base, platform: 'linux' }), false)
})

test('FDA probe actually opens protected file read-only, closes it, and never reads its contents', () => {
  let closes = 0
  assert.equal(hasFullDiskAccess({ platform: 'darwin', openSync: (filename, flags) => {
    assert.ok(filename.endsWith('/com.apple.TCC/TCC.db'))
    assert.equal(flags, require('node:fs').constants.O_RDONLY)
    return 0
  }, closeSync: fd => { assert.equal(fd, 0); closes++ } }), true)
  assert.equal(closes, 1)
  assert.equal(hasFullDiskAccess({ platform: 'darwin', openSync: () => { throw Error('denied') } }), false)
  assert.equal(hasFullDiskAccess({ platform: 'linux', openSync: () => assert.fail('not macOS') }), false)
})

test('startup uses one native prompt, opens system settings, and does not repeat on concurrent checks', async () => {
  let prompts = 0
  const opened = [], parent = { isDestroyed: () => false }
  const request = createPermissionPrompt({ check: () => false, platform: 'darwin', getWindow: () => parent,
    dialog: { showMessageBox: async (window, options) => {
      assert.equal(window, parent); assert.deepEqual(options.buttons, ['打开系统设置', '稍后']); prompts++
      return { response: 0 }
    } }, shell: { openExternal: async url => opened.push(url) } })
  await Promise.all([request(), request(), request()])
  assert.equal(prompts, 1); assert.deepEqual(opened, [FULL_DISK_ACCESS_SETTINGS_URL])
})

test('existing grants survive a new startup; revoked grants prompt on the next startup; Later opens nothing', async () => {
  let granted = true, prompts = 0
  const options = { platform: 'darwin', check: () => granted,
    dialog: { showMessageBox: async () => { prompts++; return { response: 1 } } },
    shell: { openExternal: async () => assert.fail('Later must not open settings') } }
  await createPermissionPrompt(options)(); await createPermissionPrompt(options)()
  assert.equal(prompts, 0)
  granted = false
  const restart = createPermissionPrompt(options)
  await restart(); await restart()
  assert.equal(prompts, 1)
})
