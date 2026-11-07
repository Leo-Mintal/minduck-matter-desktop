const assert = require('node:assert/strict')
const fs = require('node:fs')
const http = require('node:http')
const os = require('node:os')
const path = require('node:path')
const { app, BrowserWindow, WebContentsView, session } = require('electron')
const { AgentBrowserCompatibility } = require('../src/agentBrowserCompatibility.cjs')
const { ExtensionApiBridge } = require('../src/extensionApiBridge.cjs')

const testPartition = 'persist:minduck-matter-extension-compatibility-smoke'
const profile = path.join(os.tmpdir(), 'minduck-matter-extension-compatibility-smoke-' + process.pid)
const extensionRoot = path.join(__dirname, '..', 'extensions', 'matter-browser')
const browserTabs = new Map()
let nextTabId = 1
let activeTabId
let host
let popup

app.setPath('userData', profile)

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function startTestPage() {
  return new Promise((resolve) => {
    const streamingResponses = new Set()
    const server = http.createServer((request, response) => {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      if (request.url === '/stream') {
        streamingResponses.add(response)
        response.once('close', () => streamingResponses.delete(response))
        response.write('<!doctype html><title>Streaming Compatibility Page</title><h1>Navigation committed</h1>')
        return
      }
      response.end('<!doctype html><title>Compatibility Page</title><h1>Agent browser is ready</h1>')
    })
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const origin = 'http://127.0.0.1:' + address.port
      resolve({
        server,
        url: origin + '/',
        streamURL: origin + '/stream',
        close() {
          for (const response of streamingResponses) response.end()
          return new Promise((done) => server.close(done))
        },
      })
    })
  })
}

function createBrowserTab(url, { active = true } = {}) {
  const view = new WebContentsView({
    webPreferences: {
      partition: testPartition,
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  })
  const tab = { id: 'browser-' + nextTabId++, kind: 'browser', title: '新标签页', url, view }
  tab.navigationCommitted = url === 'about:blank'
  browserTabs.set(tab.id, tab)
  host.contentView.addChildView(view)
  view.setBounds({ x: 0, y: 0, width: 640, height: 480 })
  view.webContents.on('did-start-navigation', (_event, pendingURL, _isInPlace, isMainFrame) => {
    if (!isMainFrame) return
    tab.navigationCommitted = false
    tab.pendingURL = pendingURL
    void compatibility.emitTabUpdated(tab, { status: 'loading', pendingUrl: pendingURL })
  })
  view.webContents.on('did-navigate', (_event, nextURL) => {
    tab.url = nextURL
    tab.navigationCommitted = true
    tab.pendingURL = undefined
    void compatibility.emitTabUpdated(tab, { status: 'complete', url: nextURL })
  })
  if (active) activeTabId = tab.id
  if (url !== 'about:blank') void view.webContents.loadURL(url)
  return tab
}

function closeBrowserTab(id) {
  const tab = browserTabs.get(id)
  if (!tab) return
  host.contentView.removeChildView(tab.view)
  browserTabs.delete(id)
  tab.view.webContents.close()
  if (activeTabId === id) activeTabId = browserTabs.keys().next().value
}

// Test harness only: the app opens no DevTools port, so drive the worker through the popup's own debugger.
async function workerEvaluator(contents, scope) {
  const dbg = contents.debugger
  dbg.attach('1.3')
  const deadline = Date.now() + 15_000
  while (Date.now() < deadline) {
    const { targetInfos } = await dbg.sendCommand('Target.getTargets')
    const target = targetInfos.find((item) => item.type === 'service_worker' && item.url.startsWith(scope))
    if (target) {
      const { sessionId } = await dbg.sendCommand('Target.attachToTarget', { targetId: target.targetId, flatten: true })
      return async (expression) => {
        const response = await dbg.sendCommand('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, sessionId)
        if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception?.description || response.exceptionDetails.text)
        return response.result?.value
      }
    }
    await delay(100)
  }
  throw new Error('Matter Browser extension worker did not start')
}

async function waitForPresence(origin, expected) {
  const deadline = Date.now() + 5_000
  let value
  while (Date.now() < deadline) {
    value = await bridge.presenceDeviceId(origin)
    if (value === expected) return value
    await delay(50)
  }
  return value
}

const compatibility = new AgentBrowserCompatibility({
  createTab: createBrowserTab,
  closeTab: closeBrowserTab,
  getBrowserTabs: () => [...browserTabs.values()],
  getMainWindow: () => host,
  getActiveTabId: () => activeTabId,
  selectTab: (id) => {
    activeTabId = id
  },
})

const bridge = new ExtensionApiBridge({
  getSession: () => session.fromPartition(testPartition),
  extensionName: 'Minduck Matter 浏览器助手',
  handleRequest: (method, params) => compatibility.request(method, params),
})
compatibility.notifyGroupChanged = (tab) => bridge.notifyTabGroupChanged(tab)
compatibility.notifyTabUpdated = (tab, changeInfo) => bridge.notifyTabUpdated(tab, changeInfo)

app.whenReady().then(async () => {
  let testPage
  try {
    host = new BrowserWindow({ show: false })
    testPage = await startTestPage()
    const page = createBrowserTab(testPage.url)
    await page.view.webContents.loadURL(testPage.url)

    const browserSession = session.fromPartition(testPartition)
    bridge.start()
    const extension = await browserSession.extensions.loadExtension(extensionRoot)
    popup = new WebContentsView({
      webPreferences: {
        partition: testPartition,
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
      },
    })
    host.contentView.addChildView(popup)
    popup.setBounds({ x: 0, y: 0, width: 640, height: 480 })
    await popup.webContents.loadURL(new URL('popup.html', extension.url).toString())
    const evaluate = await workerEvaluator(popup.webContents, extension.url)
    await delay(500)
    const unpairedDeviceId = await bridge.presenceDeviceId('http://localhost:3001')
    await evaluate(`chrome.storage.local.set({
      'matter.link': {
        deviceId: 'compatibility-device',
        webOrigin: 'http://localhost:3001',
        revoked: false,
        deviceToken: 'must-not-leave-the-extension',
      },
    })`)
    const pairedDeviceId = await waitForPresence('http://localhost:3001', 'compatibility-device')
    const otherOriginDeviceId = await bridge.presenceDeviceId('http://localhost:3002')
    const result = await evaluate(`
      (async () => {
        const allTabs = await chrome.tabs.query({});
        const [tab] = await chrome.tabs.query({ url: ${JSON.stringify(testPage.url)} });
        const groupId = await chrome.tabs.group({ tabIds: [tab.id], createProperties: { windowId: tab.windowId } });
        const updatedGroup = await chrome.tabGroups.update(groupId, { title: 'Minduck Matter', color: 'blue' });
        const groups = await chrome.tabGroups.query({ title: 'Minduck Matter' });
        const groupedTab = await chrome.tabs.get(tab.id);
        const currentWindow = await chrome.windows.getLastFocused({ populate: true });
        const createdTab = await chrome.tabs.create({
          url: ${JSON.stringify(testPage.url + '?created')},
          windowId: currentWindow.id,
          active: false,
        });
        const createdTabRead = await chrome.tabs.get(createdTab.id);
        const streamingTab = await chrome.tabs.create({ url: ${JSON.stringify(testPage.streamURL)}, active: false });
        const streamDeadline = Date.now() + 5000;
        let streamingTabRead;
        while (Date.now() < streamDeadline) {
          streamingTabRead = await chrome.tabs.get(streamingTab.id);
          if (streamingTabRead.status === 'complete' && streamingTabRead.url === ${JSON.stringify(testPage.streamURL)}) break;
          await new Promise((resolve) => setTimeout(resolve, 25));
        }
        await chrome.tabs.update(createdTab.id, { active: true });
        await chrome.tabs.remove(createdTab.id);
        await chrome.debugger.attach({ tabId: tab.id }, '1.3');
        const evaluation = await chrome.debugger.sendCommand(
          { tabId: tab.id },
          'Runtime.evaluate',
          { expression: 'document.querySelector("h1").textContent', returnByValue: true },
        );
        const targets = await chrome.debugger.getTargets();
        const blockedTarget = await chrome.debugger.sendCommand({ tabId: tab.id }, 'Target.getTargets', {})
          .then(() => 'allowed', (error) => error.message);
        await chrome.debugger.detach({ tabId: tab.id });
        const blockedFile = await chrome.tabs.create({ url: 'file:///etc/hosts' }).then(() => 'allowed', (error) => error.message);
        return {
          tabId: tab.id,
          allTabCount: allTabs.length,
          groupId,
          updatedGroup,
          groups,
          groupedTab,
          currentWindow,
          createdTab,
          createdTabRead,
          streamingTabRead,
          evaluation: evaluation.result.value,
          attachedTarget: targets.find((target) => target.tabId === tab.id),
          blockedTarget,
          blockedFile,
        };
      })()
    `)

    assert.equal(result.tabId, page.view.webContents.id)
    assert.ok(result.allTabCount >= 1)
    assert.equal(result.groupedTab.groupId, result.groupId)
    assert.equal(result.updatedGroup.title, 'Minduck Matter')
    assert.equal(result.groups.length, 1)
    assert.equal(result.currentWindow.tabs.some((tab) => tab.id === result.tabId), true)
    assert.equal(result.createdTabRead.id, result.createdTab.id)
    assert.equal(result.streamingTabRead.status, 'complete')
    assert.equal(result.streamingTabRead.url, testPage.streamURL)
    assert.equal(result.streamingTabRead.active, true)
    assert.equal(result.evaluation, 'Agent browser is ready')
    assert.equal(result.attachedTarget.attached, true)
    assert.equal(unpairedDeviceId, '')
    assert.equal(pairedDeviceId, 'compatibility-device')
    assert.equal(otherOriginDeviceId, '')
    assert.match(result.blockedTarget, /not allowed/)
    assert.match(result.blockedFile, /HTTP\(S\)/)
    assert.equal(JSON.stringify(bridge.presence).includes('must-not-leave'), false)
    assert.equal(fs.existsSync(path.join(profile, 'DevToolsActivePort')), false)
    console.log(JSON.stringify({
      tabId: result.tabId,
      groupId: result.groupId,
      debuggerEvaluation: result.evaluation,
      virtualWindowId: result.currentWindow.id,
      createdTabId: result.createdTab.id,
      unpairedDeviceId,
      pairedDeviceId,
    }))
  } finally {
    bridge.stop()
    popup?.webContents.close()
    host?.destroy()
    if (testPage) await testPage.close()
    app.quit()
  }
}).catch((error) => {
  console.error(error)
  // app.exitCode is not an Electron API; exit explicitly so a failed assertion fails the command.
  app.exit(1)
})
