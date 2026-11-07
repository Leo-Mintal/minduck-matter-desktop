const test = require('node:test')
const assert = require('node:assert/strict')
const { AgentBrowserCompatibility } = require('../src/agentBrowserCompatibility.cjs')

test('updates the Agent Browser cursor around CDP mouse commands and hides it for screenshots', async () => {
  const commands = []
  const cursorCalls = []
  const webContents = {
    id: 19,
    getURL: () => 'https://example.com/',
    getTitle: () => 'Example',
    isLoading: () => false,
    isDestroyed: () => false,
    debugger: {
      attached: false,
      isAttached() { return this.attached },
      attach() { this.attached = true },
      detach() { this.attached = false },
      sendCommand: async (method, params) => {
        commands.push({ method, params })
        return { ok: true }
      },
    },
  }
  const tab = {
    id: 'browser-1',
    kind: 'browser',
    url: 'https://example.com/',
    title: 'Example',
    navigationCommitted: true,
    view: { webContents },
  }
  const overlay = {
    showAt: async (x, y) => cursorCalls.push(['show', x, y]),
    withHidden: async (callback) => {
      cursorCalls.push(['hide-for-screenshot'])
      return callback()
    },
    dispose() {},
  }
  const compatibility = new AgentBrowserCompatibility({
    createTab: () => tab,
    closeTab() {},
    getBrowserTabs: () => [tab],
    getMainWindow: () => ({ isDestroyed: () => false, getContentSize: () => [1280, 800], getPosition: () => [0, 0], isFocused: () => true, isMaximized: () => false, isAlwaysOnTop: () => false }),
    getActiveTabId: () => tab.id,
    selectTab() {},
    cursorOverlayFactory: () => overlay,
  })

  await compatibility.request('debugger.attach', { target: { tabId: webContents.id }, extensionId: 'matter-browser' })
  await compatibility.request('debugger.sendCommand', {
    target: { tabId: webContents.id },
    method: 'Input.dispatchMouseEvent',
    commandParams: { type: 'mouseMoved', x: 42, y: 51 },
    extensionId: 'matter-browser',
  })
  await compatibility.request('debugger.sendCommand', {
    target: { tabId: webContents.id },
    method: 'Page.captureScreenshot',
    commandParams: {},
    extensionId: 'matter-browser',
  })

  assert.deepEqual(cursorCalls, [['show', 42, 51], ['hide-for-screenshot']])
  assert.deepEqual(commands.map(({ method }) => method), ['Input.dispatchMouseEvent', 'Page.captureScreenshot'])
})
