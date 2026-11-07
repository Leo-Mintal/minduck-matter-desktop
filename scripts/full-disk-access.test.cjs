const assert = require('node:assert/strict')
const test = require('node:test')
const {
  FULL_DISK_ACCESS_SETTINGS_URL,
  hasFullDiskAccess,
  shouldPromptForFullDiskAccess,
} = require('../src/fullDiskAccess.cjs')

test('opens the macOS Full Disk Access privacy pane only while acknowledgement is pending', () => {
  assert.equal(FULL_DISK_ACCESS_SETTINGS_URL, 'x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles')
  assert.equal(shouldPromptForFullDiskAccess({
    platform: 'darwin',
    promptedThisSession: false,
    settings: { fullDiskAccessPromptAcknowledged: false },
  }), true)
  assert.equal(shouldPromptForFullDiskAccess({
    platform: 'darwin',
    promptedThisSession: true,
    settings: { fullDiskAccessPromptAcknowledged: false },
  }), false)
  assert.equal(shouldPromptForFullDiskAccess({
    platform: 'darwin',
    promptedThisSession: false,
    settings: { fullDiskAccessPromptAcknowledged: true },
  }), false)
  assert.equal(shouldPromptForFullDiskAccess({
    platform: 'linux',
    promptedThisSession: false,
    settings: { fullDiskAccessPromptAcknowledged: false },
  }), false)
  assert.equal(shouldPromptForFullDiskAccess({
    platform: 'darwin',
    promptedThisSession: false,
    settings: { fullDiskAccessPromptAcknowledged: false },
    permissionGranted: true,
  }), false)
})

test('detects Full Disk Access by probing the protected TCC database', () => {
  assert.equal(hasFullDiskAccess({
    platform: 'darwin',
    accessSync: () => undefined,
  }), true)
  assert.equal(hasFullDiskAccess({
    platform: 'darwin',
    accessSync: () => { throw new Error('permission denied') },
  }), false)
  assert.equal(hasFullDiskAccess({
    platform: 'linux',
    accessSync: () => undefined,
  }), false)
})
