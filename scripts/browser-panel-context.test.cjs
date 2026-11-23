const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const vm = require('node:vm')

function fixture() {
  const module = { exports: {} }
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/electronBrowserHost.cjs'), 'utf8'), {
    module, __dirname: path.join(__dirname, '../src'),
    require: name => name.startsWith('node:') ? require(name) : {},
  })
  const changes = []
  const host = new module.exports.ElectronBrowserHost({
    rightPanelView: { removeChildView() {} }, onTabForgotten() {},
    onLayoutChange: () => changes.push('layout'), onStateChange: () => changes.push('state'),
  })
  const tab = { id: 'browser-1', view: { webContents: { isDestroyed: () => false, close() {} } } }
  host.tabs.set(tab.id, tab)
  host.selectTab(tab.id)
  changes.length = 0
  return { host, tab, changes }
}

test('temporarily suppresses an open browser and restores its existing tab on return', () => {
  const { host, tab, changes } = fixture()
  host.setPanelSuppressed(true)
  assert.equal(host.isPanelOpen(), false)
  assert.equal(host.panelHidden, false, 'route changes preserve the explicit open preference')
  assert.equal(host.getActiveTab(), tab)
  assert.equal(host.tabs.size, 1)
  host.setPanelSuppressed(true)
  assert.deepEqual(changes, ['layout', 'state'], 'repeated feature routes do not restart transitions')
  host.setPanelSuppressed(false)
  assert.equal(host.isPanelOpen(), true)
  assert.equal(host.getActiveTab(), tab)
})

test('does not reopen a browser that the user collapsed before leaving the conversation', () => {
  const { host } = fixture()
  host.closePanel()
  host.setPanelSuppressed(true)
  host.setPanelSuppressed(false)
  assert.equal(host.isPanelOpen(), false)
  assert.equal(host.panelHidden, true)
})

test('background tab selection cannot show the browser on a feature page', () => {
  const { host, tab } = fixture()
  host.setPanelSuppressed(true)
  host.selectTab(tab.id)
  assert.equal(host.isPanelOpen(), false)
  host.openPanel()
  assert.equal(host.isPanelOpen(), false)
  host.setPanelSuppressed(false)
  assert.equal(host.isPanelOpen(), true)
})

test('returning after the last tab closes does not create another browser', () => {
  const { host, tab } = fixture()
  host.setPanelSuppressed(true)
  host.closeTab(tab.id)
  host.setPanelSuppressed(false)
  assert.equal(host.isPanelOpen(), false)
  assert.equal(host.tabs.size, 0)
})
