const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { AgentBrowserCompatibility, EXTENSION_DEBUGGER_METHODS } = require('../src/agentBrowserCompatibility.cjs')

function createHarness() {
  const tabs = new Map()
  let nextTab = 1
  let activeTabId
  const window = {
    isDestroyed: () => false,
    getContentSize: () => [1280, 800],
    getPosition: () => [0, 0],
    isFocused: () => true,
    isMaximized: () => false,
    isAlwaysOnTop: () => false,
    focus() {},
  }
  const createTab = (url, { active } = {}) => {
    const tab = {
      id: `tab-${nextTab}`,
      kind: 'browser',
      url,
      title: '新标签页',
      navigationCommitted: url === 'about:blank',
      view: {
        webContents: {
          id: nextTab++,
          getURL: () => tab.url,
          getTitle: () => tab.title,
          isLoading: () => !tab.navigationCommitted,
          isDestroyed: () => false,
          loadURL: async (nextURL) => {
            tab.url = nextURL
            tab.navigationCommitted = true
            tab.pendingURL = undefined
          },
          setAudioMuted() {},
          navigationHistory: { canGoBack: () => false, canGoForward: () => false },
          debugger: { isAttached: () => false },
        },
      },
    }
    tabs.set(tab.id, tab)
    if (active) activeTabId = tab.id
    return tab
  }
  const compatibility = new AgentBrowserCompatibility({
    createTab,
    closeTab: (tabId) => tabs.delete(tabId),
    getBrowserTabs: () => [...tabs.values()],
    getMainWindow: () => window,
    getActiveTabId: () => activeTabId,
    selectTab: (tabId) => { activeTabId = tabId },
    cursorOverlayFactory: () => ({ showAt: async () => {}, withHidden: (run) => run(), dispose() {} }),
  })
  return { compatibility, tabs, activeTabId: () => activeTabId }
}

test('forwards only the page-scoped CDP methods the bundled extension sends', async () => {
  const { compatibility } = createHarness()
  const created = await compatibility.request('tabs.create', { url: 'https://example.com/' })
  const sent = []
  let attached = false
  compatibility.tabById(created.id).view.webContents.debugger = {
    isAttached: () => attached,
    attach() { attached = true },
    sendCommand: async (method) => { sent.push(method); return {} },
  }
  const target = { tabId: created.id }
  await compatibility.request('debugger.attach', { target, requiredVersion: '1.3', extensionId: 'matter' })
  for (const method of ['Target.getTargets', 'Target.attachToTarget', 'Target.sendMessageToTarget', 'Browser.close', 'Page.navigate', 'Storage.getCookies']) {
    await assert.rejects(compatibility.request('debugger.sendCommand', { target, method, extensionId: 'matter' }), /not allowed/)
  }
  await compatibility.request('debugger.sendCommand', { target, method: 'Runtime.evaluate', commandParams: { expression: '1' }, extensionId: 'matter' })
  assert.deepEqual(sent, ['Runtime.evaluate'])

  const source = fs.readFileSync(path.join(__dirname, '..', 'extensions', 'matter-browser', 'background.js'), 'utf8')
  const used = new Set(source.match(/"(?:Page|Runtime|Input|Emulation)\.[a-z][A-Za-z]+"/g).map((value) => value.slice(1, -1)))
  assert.deepEqual([...used].filter((method) => !EXTENSION_DEBUGGER_METHODS.has(method)), [])
  assert.equal(/"(?:Target|Browser|Storage)\.[a-z][A-Za-z]+"/.test(source), false)
})

test('foregrounds URL navigation and reports a committed page as complete', async () => {
  const { compatibility, activeTabId } = createHarness()
  const tab = await compatibility.request('tabs.create', {
    url: 'https://www.douyin.com/',
    active: false,
  })

  assert.equal(tab.active, true)
  assert.equal(activeTabId(), 'tab-1')
  assert.equal(tab.status, 'loading')

  const created = compatibility.tabById(tab.id)
  created.navigationCommitted = true
  const committed = await compatibility.request('tabs.get', { tabId: tab.id })
  assert.equal(committed.status, 'complete')
  assert.equal(committed.url, 'https://www.douyin.com/')
})

test('foregrounds a direct URL update in the browser sidebar', async () => {
  const { compatibility, activeTabId } = createHarness()
  const initial = await compatibility.request('tabs.create', { active: false })
  const updated = await compatibility.request('tabs.update', {
    tabId: initial.id,
    updateProperties: { url: 'https://www.douyin.com/jingxuan' },
  })

  assert.equal(updated.active, true)
  assert.equal(activeTabId(), 'tab-1')
  assert.equal(updated.url, 'https://www.douyin.com/jingxuan')
  assert.equal(updated.status, 'complete')
})

test('opens only HTTP(S) or blank pages for extension tab and window requests', async () => {
  const { compatibility, tabs } = createHarness()
  for (const url of ['file:///etc/hosts', 'javascript:alert(1)', 'data:text/html,x', 'chrome://settings', 'not a url', ['https://example.com/']]) {
    await assert.rejects(compatibility.request('tabs.create', { url }), /HTTP\(S\)/)
    await assert.rejects(compatibility.request('windows.create', { url }), /HTTP\(S\)/)
  }
  assert.equal(tabs.size, 0)

  const blank = await compatibility.request('tabs.create', {})
  await assert.rejects(compatibility.request('tabs.update', {
    tabId: blank.id,
    updateProperties: { url: 'file:///etc/hosts' },
  }), /HTTP\(S\)/)
  assert.equal((await compatibility.request('tabs.get', { tabId: blank.id })).url, 'about:blank')
  assert.equal((await compatibility.request('tabs.create', { url: 'http://localhost:3000/' })).url, 'http://localhost:3000/')
})

test('queries browser-owned tabs instead of unrelated native extension tabs', async () => {
  const { compatibility } = createHarness()
  const douyin = await compatibility.request('tabs.create', { url: 'https://www.douyin.com/jingxuan' })
  const other = await compatibility.request('tabs.create', { url: 'https://example.com/' })
  const groupId = await compatibility.request('tabs.group', { tabIds: [douyin.id] })

  const grouped = await compatibility.request('tabs.query', { queryInfo: { groupId } })
  const matched = await compatibility.request('tabs.query', { queryInfo: { url: 'https://www.douyin.com/*' } })
  const active = await compatibility.request('tabs.query', { queryInfo: { active: true, currentWindow: true } })

  assert.deepEqual(grouped.map((tab) => tab.id), [douyin.id])
  assert.deepEqual(matched.map((tab) => tab.id), [douyin.id])
  assert.deepEqual(active.map((tab) => tab.id), [other.id])
})
