const assert = require('node:assert/strict')
const http = require('node:http')
const os = require('node:os')
const path = require('node:path')
const { app, BrowserWindow, WebContentsView, session } = require('electron')

const testPartition = 'persist:minduck-matter-extension-smoke'
const extensionRoot = path.resolve(process.env.MINDUCK_EXTENSION_ROOT || path.join(__dirname, '..', 'extensions'))
app.setPath('userData', path.join(os.tmpdir(), 'minduck-matter-extension-smoke-' + process.pid))

function startTestPage() {
  return new Promise((resolve) => {
    const server = http.createServer((_request, response) => {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      response.end('<!doctype html><title>Matter Browser Extension Test</title><h1>Browser extension ready</h1>')
    })
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      resolve({ server, url: 'http://127.0.0.1:' + address.port + '/' })
    })
  })
}

app.whenReady().then(async () => {
  const testPage = await startTestPage()
  const browserSession = session.fromPartition(testPartition)
  const xiaohongshu = await browserSession.extensions.loadExtension(path.join(extensionRoot, 'xiaohongshu'))
  const extension = await browserSession.extensions.loadExtension(path.join(extensionRoot, 'matter-browser'))
  assert.equal(xiaohongshu.name, 'Minduck Xiaohongshu Agent')
  assert.equal(extension.name, 'Minduck Matter 浏览器助手')
  assert.match(extension.url, /^chrome-extension:\/\/[a-z]{32}\/$/)

  const host = new BrowserWindow({ show: false })
  const page = new WebContentsView({ webPreferences: { partition: testPartition, contextIsolation: true, sandbox: true, nodeIntegration: false } })
  const popup = new WebContentsView({ webPreferences: { partition: testPartition, contextIsolation: true, sandbox: true, nodeIntegration: false } })
  host.contentView.addChildView(page)
  host.contentView.addChildView(popup)
  page.setBounds({ x: 0, y: 0, width: 640, height: 480 })
  popup.setBounds({ x: 0, y: 0, width: 640, height: 480 })
  await page.webContents.loadURL(testPage.url)
  await popup.webContents.loadURL(new URL('popup.html', extension.url).toString())

  const result = await popup.webContents.executeJavaScript(
    'Promise.all([chrome.tabs.query({}), chrome.runtime.sendMessage({ type: "matter.link.view" }), Promise.resolve({ tabs: typeof chrome.tabs?.query, scripting: typeof chrome.scripting?.executeScript, debugger: typeof chrome.debugger?.attach, tabGroups: typeof chrome.tabGroups?.query })]).then(([tabs, link, apis]) => ({ tabs, link, apis }))',
  )
  assert.equal(result.apis.tabs, 'function')
  assert.equal(result.apis.scripting, 'function')
  assert.equal(result.apis.debugger, 'undefined')
  assert.equal(result.apis.tabGroups, 'undefined')
  assert.equal(result.link.ok, true)
  const browserTab = result.tabs.find((tab) => tab.url === testPage.url)
  assert.ok(browserTab, 'The extension could not discover the browser WebContentsView')
  const pageHeading = await popup.webContents.executeJavaScript(
    'chrome.scripting.executeScript({ target: { tabId: ' + JSON.stringify(browserTab.id) + ' }, func: () => document.querySelector("h1")?.textContent }).then((results) => results[0]?.result)',
  )
  assert.equal(pageHeading, 'Browser extension ready')

  console.log(JSON.stringify({
    extensions: [xiaohongshu.name, extension.name],
    browserWebContentsId: page.webContents.id,
    extensionBrowserTabId: browserTab.id,
    tabCount: result.tabs.length,
    apis: result.apis,
  }))
  host.destroy()
  await new Promise((resolve) => testPage.server.close(resolve))
  app.quit()
}).catch((error) => {
  console.error(error)
  app.exitCode = 1
  app.quit()
})
