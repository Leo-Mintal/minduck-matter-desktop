const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const test = require('node:test')
const { workspaceFrameBounds, rightPanelLayout } = require('../src/rightPanelLayout.cjs')

function preload({ origin = 'https://matter.example', topFrame = true } = {}) {
  const exposed = {}, messages = [], listeners = new Map(), dom = {}
  const window = { location: { origin }, addEventListener: (name, callback) => { dom[name] = callback } }
  window.top = topFrame ? window : {}
  const document = { documentElement: { dataset: {} } }
  const ipcRenderer = {
    invoke: name => { messages.push(name); return Promise.resolve({ railWidth: 49, update: {} }) },
    send: (...args) => messages.push(args),
    on: (name, handler) => listeners.set(name, handler),
    removeListener: name => listeners.delete(name),
  }
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/workspace-preload.cjs'), 'utf8'), {
    require: () => ({ contextBridge: { exposeInMainWorld: (name, api) => { exposed[name] = api } }, ipcRenderer }),
    process: { argv: ['electron', '--minduck-workspace-origin=https://matter.example'] }, window, document,
  })
  return { exposed, messages, listeners, dom, document }
}

test('workspace UI bridge exists only in the exact Matter top-level origin', () => {
  for (const options of [{ origin: 'https://matter.example.evil.test' }, { origin: 'file://' }, { topFrame: false }]) {
    assert.deepEqual(Object.keys(preload(options).exposed), [])
  }
  const fixture = preload()
  const api = fixture.exposed.minduckWorkspaceShell
  assert.deepEqual(Object.keys(api), ['getState', 'command', 'onState'])
  assert.equal(Object.isFrozen(api), true)
  fixture.dom.DOMContentLoaded()
  assert.equal(fixture.document.documentElement.dataset.matterWorkspace, 'true')
  assert.equal(fixture.document.documentElement.dataset.matterDesktop, 'true')
})

test('workspace accepts only the two existing native UI actions and cleans up listeners', async () => {
  const fixture = preload()
  const api = fixture.exposed.minduckWorkspaceShell
  for (const command of ['check-update', 'companion-settings', 'execute', 'open-external', '../private', null, {}]) api.command(command)
  assert.deepEqual(fixture.messages, [['workspace-shell:command', 'check-update'], ['workspace-shell:command', 'companion-settings']])
  assert.equal((await api.getState()).railWidth, 49)
  let snapshot
  const unsubscribe = api.onState(value => { snapshot = value })
  fixture.listeners.get('workspace-shell:state')({ private: true }, { railWidth: 49, update: {} })
  assert.deepEqual(snapshot, { railWidth: 49, update: {} })
  unsubscribe()
  assert.equal(fixture.listeners.size, 0)
})

test('shared workspace includes the rail without changing the business content or browser geometry', () => {
  for (const width of [960, 1024, 1280, 1440]) for (const open of [true, false]) {
    const layout = rightPanelLayout(width, 800, open)
    const workspace = workspaceFrameBounds(layout.matter, true)
    assert.deepEqual(workspaceFrameBounds(layout.matter, false), layout.matter)
    assert.equal(workspace.x, 0)
    assert.equal(workspace.width - 49, layout.matter.width)
    assert.equal(workspace.y, layout.matter.y)
    assert.equal(workspace.height, layout.matter.height)
    assert.equal(workspace.x + workspace.width, layout.matter.x + layout.matter.width)
    if (open) assert.equal(workspace.width + 1, layout.panel.x)
  }
})
