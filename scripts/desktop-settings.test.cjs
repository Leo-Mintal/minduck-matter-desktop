const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')
const {
  DESKTOP_SETTINGS_FILE,
  desktopSettingsPath,
  loadDesktopSettings,
  saveDesktopSettings,
} = require('../src/desktopSettings.cjs')

function withSettings(run) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'minduck-desktop-settings-'))
  try {
    run(directory)
  } finally {
    fs.rmSync(directory, { recursive: true, force: true })
  }
}

test('persists desktop service, panel and permission preferences privately', () => withSettings((directory) => {
  assert.deepEqual(loadDesktopSettings(directory), {
    fullDiskAccessPromptAcknowledged: false, rightPanelWidth: null, matterOrigin: null,
  })
  const settings = {
    fullDiskAccessPromptAcknowledged: true, rightPanelWidth: 640, matterOrigin: 'https://matter.example.com',
  }
  saveDesktopSettings(directory, settings)
  const settingsPath = desktopSettingsPath(directory)
  assert.equal(path.basename(settingsPath), DESKTOP_SETTINGS_FILE)
  assert.deepEqual(loadDesktopSettings(directory), settings)
  assert.equal(fs.statSync(settingsPath).mode & 0o077, 0)
}))

test('keeps legacy desktop preferences and ignores retired local chat switches', () => withSettings((directory) => {
  const settingsPath = path.join(directory, 'agent-settings.json')
  fs.writeFileSync(settingsPath, JSON.stringify({
    autoApproveBrowserOperations: true, allowDesktopFiles: true, allowLocalFiles: true,
    fullDiskAccessPromptAcknowledged: true, rightPanelWidth: 700, matterOrigin: 'https://matter.example.com',
  }))
  const settings = loadDesktopSettings(directory)
  assert.deepEqual(settings, {
    fullDiskAccessPromptAcknowledged: true, rightPanelWidth: 700, matterOrigin: 'https://matter.example.com',
  })
  saveDesktopSettings(directory, settings)
  assert.deepEqual(JSON.parse(fs.readFileSync(settingsPath, 'utf8')), settings)
}))

test('rejects invalid desktop settings and malformed saved data', () => withSettings((directory) => {
  const defaults = loadDesktopSettings(directory)
  for (const invalid of [
    { fullDiskAccessPromptAcknowledged: 'true' },
    { rightPanelWidth: '640' },
    { rightPanelWidth: 0 },
    { matterOrigin: 'http://untrusted.example.com' },
  ]) {
    assert.throws(() => saveDesktopSettings(directory, { ...defaults, ...invalid }))
  }
  for (const contents of ['{broken', '[]', 'null']) {
    fs.writeFileSync(desktopSettingsPath(directory), contents)
    assert.throws(() => loadDesktopSettings(directory), /设置文件无效/)
  }
}))

test('drops only a saved service address that current rules reject', () => withSettings((directory) => {
  for (const matterOrigin of ['http://untrusted.example.com', 'https://matter.example.com/path', 42]) {
    fs.writeFileSync(desktopSettingsPath(directory), JSON.stringify({
      fullDiskAccessPromptAcknowledged: true, rightPanelWidth: 700, matterOrigin,
    }))
    assert.deepEqual(loadDesktopSettings(directory), {
      fullDiskAccessPromptAcknowledged: true, rightPanelWidth: 700, matterOrigin: null,
    })
  }
}))
