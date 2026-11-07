const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { app, BrowserWindow, session } = require('electron')
const { ExtensionApiBridge } = require('../src/extensionApiBridge.cjs')

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'minduck-extension-bridge-probe-'))
const extensionRoot = path.join(__dirname, '..', 'extensions', 'matter-browser')
const partition = 'persist:minduck-extension-bridge-probe'

app.setPath('userData', profile)
const bridgeRequests = []
const bridge = new ExtensionApiBridge({
  getSession: () => session.fromPartition(partition),
  extensionName: 'Minduck Matter 浏览器助手',
  handleRequest(method, params) {
    bridgeRequests.push({ method, params })
    if (method === 'tabs.metadata') return { groupId: -1 }
    if (method === 'tabGroups.query') return []
    if (method === 'debugger.getTargets') return []
    throw new Error(`Unexpected bridge request: ${method}`)
  },
  logger: {
    error(...args) {
      console.error('[bridge]', ...args)
    },
  },
})

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// Probe harness only: the app opens no DevTools port, so inspect the worker through a page debugger.
async function workerEvaluator(contents, scope) {
  const dbg = contents.debugger
  dbg.attach('1.3')
  const deadline = Date.now() + 15_000
  while (Date.now() < deadline) {
    const { targetInfos } = await dbg.sendCommand('Target.getTargets')
    const target = targetInfos.find((item) => item.type === 'service_worker' && item.url.startsWith(scope))
    if (target) {
      const { sessionId } = await dbg.sendCommand('Target.attachToTarget', { targetId: target.targetId, flatten: true })
      return {
        url: target.url,
        async evaluate(expression) {
          const response = await dbg.sendCommand('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, sessionId)
          if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception?.description || response.exceptionDetails.text)
          return response.result?.value
        },
      }
    }
    await delay(100)
  }
  throw new Error('Matter Browser extension service worker did not start')
}

app.whenReady().then(async () => {
  let page
  try {
    bridge.start()
    const extension = await session.fromPartition(partition).extensions.loadExtension(extensionRoot)
    page = new BrowserWindow({ show: false, webPreferences: { partition, sandbox: true, contextIsolation: true } })
    await page.loadURL(new URL('popup.html', extension.url).toString())
    const worker = await workerEvaluator(page.webContents, extension.url)
    await delay(500)
    console.log(JSON.stringify({ bridgeWorkers: [...bridge.workers.keys()] }))
    const capabilities = await worker.evaluate(`
      Promise.all([chrome.tabGroups.query({}), chrome.debugger.getTargets()]).then(([groups, targets]) => ({
        debugger: typeof chrome.debugger?.attach,
        tabGroups: typeof chrome.tabGroups?.query,
        tabsGroup: typeof chrome.tabs.group,
        groups,
        targets,
      }))
    `)
    console.log(JSON.stringify({ target: worker.url, capabilities, bridgeRequests }))
    if (capabilities.debugger !== 'function' || capabilities.tabGroups !== 'function' || capabilities.tabsGroup !== 'function') {
      throw new Error('Electron extension worker did not receive the compatibility API shim')
    }
    if (fs.existsSync(path.join(profile, 'DevToolsActivePort'))) throw new Error('A DevTools port was opened')
  } finally {
    bridge.stop()
    page?.destroy()
    fs.rmSync(profile, { recursive: true, force: true })
    app.quit()
  }
}).catch((error) => {
  console.error(error)
  app.exit(1)
})
