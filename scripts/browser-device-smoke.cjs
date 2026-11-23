// Real Electron/WS integration with disposable profiles, server and fixture pages.
if (!process.versions.electron) {
  const fs = require('node:fs'), os = require('node:os'), path = require('node:path')
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'matter-native-browser-'))
  const result = require('node:child_process').spawnSync(require('electron'), [__filename, directory], {
    stdio: 'inherit', timeout: 90000, killSignal: 'SIGKILL',
  })
  fs.rmSync(directory, { recursive: true, force: true })
  if (result.error) console.error(result.error)
  process.exit(result.status ?? 1)
}
const { app, BrowserWindow, WebContentsView, session, net, nativeImage, safeStorage } = require('electron')
const fs = require('node:fs/promises'), path = require('node:path'), http = require('node:http'), assert = require('node:assert/strict')
const { WebSocketServer } = require('../vendor/coopanion/runtime/node_modules/ws')
const { AgentBrowserCompatibility } = require('../src/agentBrowserCompatibility.cjs')
const { createClientRuntime } = require('../src/client-runtime.cjs')
app.setPath('userData', path.join(process.argv[2], 'profile'))
process.on('uncaughtException', error => { console.error(error); app.exit(1) })
const tabs = new Map(), pending = new Map(), replies = new Set()
let host, matter, device, settings, server, wss, socket, origin, activeTab, next = 0, schemas, compatibility, jwt
const watchdog = setTimeout(() => { console.error('native browser smoke timed out'); app.exit(1) }, 75000)
async function until(predicate) {
  for (let i = 0; i < 250; i++) { const value = await predicate(); if (value) return value; await new Promise(resolve => setTimeout(resolve, 20)) }
  throw new Error('native browser condition timed out')
}
function createTab(url, { active = true } = {}) {
  const view = new WebContentsView({ webPreferences: { partition: 'native-browser-smoke', offscreen: true, backgroundThrottling: false, sandbox: true, nodeIntegration: false, contextIsolation: true } })
  const tab = { id: 'tab-' + ++next, kind: 'browser', view, url, navigationCommitted: false }
  tabs.set(tab.id, tab); host.contentView.addChildView(view); view.setBounds({ x: 420, y: 0, width: 680, height: 680 })
  const notify = change => void compatibility.emitTabUpdated(tab, change)
  view.webContents.on('did-start-navigation', (_event, url, _inPlace, main) => {
    if (main) { tab.navigationCommitted = false; tab.pendingURL = url; notify({ status: 'loading' }) }
  })
  view.webContents.on('did-navigate', (_event, url) => {
    tab.url = url; tab.pendingURL = undefined; tab.navigationCommitted = true; notify({ status: 'complete', url })
  })
  if (active) selectTab(tab.id)
  void view.webContents.loadURL(url)
  return tab
}
function selectTab(id) {
  activeTab = id
  for (const tab of tabs.values()) tab.view.setVisible(tab.id === id)
  tabs.get(id)?.view.webContents.focus()
}
function closeTab(id) {
  const tab = tabs.get(id)
  compatibility.forgetTab(tab); tabs.delete(id); host.contentView.removeChildView(tab.view); tab.view.webContents.close()
  if (id === activeTab) activeTab = [...tabs.keys()].at(-1)
}
async function call(name, args = {}, error = false) {
  const id = 'call-' + ++next
  const result = new Promise(resolve => pending.set(id, resolve))
  socket.send(JSON.stringify({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } }))
  const response = await result
  assert.equal(response.result?.isError === true, error, name + ': ' + JSON.stringify(response).slice(0, 650))
  console.log('PASS', name)
  return response.result
}
const payload = result => JSON.parse(result.content.find(item => item.type === 'text').text)
app.whenReady().then(async () => {
  try {
    server = http.createServer((request, response) => {
      assert.ok(!/pairings|redeem|devices\/register/.test(request.url), 'must never register or pair')
      if (request.url === '/media/redirect') { response.writeHead(302, { location: '/page' }); response.end(); return }
      if (request.url === '/media/oversized') { response.writeHead(200, { 'content-length': 21 * 1024 * 1024 }); response.end('oversized'); return }
      if (request.url === '/media/stream') { response.writeHead(200, { 'content-type': 'text/plain' }); response.end(Buffer.alloc(20 * 1024 * 1024 + 1)); return }
      if (request.url.startsWith('/media/')) { response.setHeader('content-type', 'text/plain'); response.end('native upload bytes'); return }
      response.setHeader('content-type', 'text/html; charset=utf-8')
      if (request.url === '/frame') { response.end('<!doctype html><label>Frame name<input id="frame-name"></label><button>Frame action</button>'); return }
      if (request.url === '/matter') { response.end('<!doctype html><h1>Matter fixture</h1>'); return }
      response.end(`<!doctype html><meta charset="utf-8"><title>Native browser task</title>
        <style>body{font:18px system-ui;padding:24px}label,button,p{display:block;margin:12px 0}iframe{width:450px;height:100px}
        footer{position:fixed;bottom:0;left:24px;background:white}footer>*{display:inline-block;margin:8px}</style>
        <h1>内置浏览器任务验证</h1><label>Name<input id="name" aria-label="Name"></label>
        <button id="go" onclick="document.querySelector('#result').textContent='完成：'+document.querySelector('#name').value">Run task</button>
        <p id="result">等待执行</p><input id="file" type="file"><a href="/next">Next page</a>
        <iframe src="/frame"></iframe><iframe id="cross" src="${origin.replace('127.0.0.1', 'localhost')}/frame"></iframe>
        <footer><a href="#editor"><span>发布笔记</span></a>
        <button id="fixture-publish" onclick="this.dataset.clicked='true'"><span>发布</span><span hidden>隐藏</span></button>
        <button>保存<span>草稿</span></button><span role="button" tabindex="0"><span>设置</span></span>
        <button aria-label="确认"><span>显示文字</span></button></footer>`)
    })
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); origin = 'http://127.0.0.1:' + server.address().port
    wss = new WebSocketServer({ server, path: '/api/client-runtime/ws' })
    wss.on('connection', current => {
      socket = current
      current.on('message', raw => {
        const value = JSON.parse(raw)
        if (value.type === 'auth') {
          assert.ok(value.runtime_id.startsWith('rt_')); assert.equal(value.device_id,undefined); assert.equal(value.token,jwt)
          current.send(JSON.stringify({ type: 'auth_ok', runtime_id: value.runtime_id }))
          current.send(JSON.stringify({ jsonrpc: '2.0', id: 'init', method: 'initialize', params: { protocolVersion: '2025-06-18' } }))
        } else if (value.id === 'init') {
          assert.equal(value.result.capabilities.clientRuntime.version, 1)
          current.send(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }));current.send(JSON.stringify({type:'runtime_ready',runtime_context:'native-runtime-proof'}))
          current.send(JSON.stringify({ jsonrpc: '2.0', id: 'list', method: 'tools/list' }))
        } else if (value.id === 'list') schemas = value.result.tools
        else if (value.id) { replies.add(value.id); pending.get(value.id)?.(value); pending.delete(value.id) }
      })
    })
    host = new BrowserWindow({ show: false, width: 1100, height: 720, title: '内置浏览器集成验证', webPreferences: {offscreen:true,backgroundThrottling:false} })
    matter = new WebContentsView({ webPreferences: { offscreen: true, backgroundThrottling: false, sandbox: true, contextIsolation: true, nodeIntegration: false } })
    host.contentView.addChildView(matter); matter.setBounds({ x: 0, y: 0, width: 420, height: 680 })
    await host.loadURL('about:blank'); host.focus();
    await matter.webContents.loadURL(origin + '/matter')
    jwt = 'h.' + Buffer.from(JSON.stringify({ uid: 'native-smoke-user', exp: Date.now() / 1000 + 600 })).toString('base64url') + '.s'
    await matter.webContents.executeJavaScript(`localStorage.setItem('matter.token',${JSON.stringify(jwt)})`)
    compatibility = new AgentBrowserCompatibility({ createTab, closeTab, getBrowserTabs: () => [...tabs.values()],
      getMainWindow: () => host, getActiveTabId: () => activeTab, selectTab })
    device = createClientRuntime({ app, localExec:{snapshot:()=>({enabled:false,state:'未授权'}),execute:async()=>assert.fail('shell not permitted')},bridgePort:19477, fetchImpl: net.fetch.bind(net), origin, getContents: () => matter.webContents,
      compatibility, extensionRoot: path.join(__dirname, '..', 'extensions/matter-browser'), nativeImage })
    compatibility.notifyGroupChanged = tab => device.notifyTabUpdated(tab, { groupId: tab.groupId })
    compatibility.notifyTabUpdated = (tab, change) => device.notifyTabUpdated(tab, change)
    await device.refresh(); await until(() => schemas)
    assert.equal(schemas.length, 15)
    await until(()=>device.snapshot().available);assert.equal(device.snapshot().browser,true)
    assert.equal(session.fromPartition('native-browser-smoke').extensions.getAllExtensions().length, 0)
    const manual = createTab(origin + '/manual')
    await until(() => manual.navigationCommitted)
    assert.equal(payload(await call('get_windows_and_tabs')).tabCount, 0)
    await call('chrome_click_element', { tabId: manual.view.webContents.id, selector: '#go' }, true)
    const nav = payload(await call('chrome_navigate', { url: origin + '/page' }))
    const tabId = nav.tabId, tab = compatibility.tabById(tabId), contents = tab.view.webContents
    const tree = payload(await call('chrome_read_page', { tabId }))
    assert.ok(tree.pageContent.includes('Name'), tree.pageContent)
    const publishLine = tree.pageContent.split('\n').find(line => /- button "发布" /.test(line))
    assert.ok(publishLine, 'Nested two-character button label is missing: ' + tree.pageContent)
    assert.match(tree.pageContent, /- link "发布笔记" /)
    assert.match(tree.pageContent, /- button "保存草稿" /)
    assert.match(tree.pageContent, /- button "设置" /)
    assert.match(tree.pageContent, /- button "确认" /)
    const publishRef = publishLine.match(/\[ref=(ref_\d+)\]/)?.[1]
    assert.ok(publishRef)
    const interactiveTree = payload(await call('chrome_read_page', { tabId, filter: 'interactive' }))
    assert.match(interactiveTree.pageContent, /- button "发布" /)
    await call('chrome_click_element', { tabId, ref: publishRef })
    assert.equal(await contents.executeJavaScript("document.querySelector('#fixture-publish').dataset.clicked"), 'true')
    const ref = tree.pageContent.split('\n').find(line => line.includes('textbox') && line.includes('Name'))?.match(/\[ref=(ref_\d+)\]/)?.[1]
    assert.ok(ref, tree.pageContent)
    await call('chrome_fill_or_select', { tabId, ref, value: 'Native device' })
    await call('chrome_click_element', { tabId, selector: '#go' })
    assert.equal(await contents.executeJavaScript("document.querySelector('#result').textContent"), '完成：Native device')
    assert.equal(await contents.executeJavaScript('typeof globalThis.__claudeElementMap'), 'undefined')
    assert.equal(await contents.executeJavaScript('typeof require'), 'undefined')
    await call('chrome_get_interactive_elements', { tabId })
    await call('chrome_get_web_content', { tabId })
    await call('chrome_keyboard', { tabId, keys: 'TAB' })
    await call('chrome_keyboard', { tabId, frameId: 1, keys: 'TAB' })
    await call('chrome_keyboard', { tabId, frameId: 2, keys: 'TAB' })
    const image = payload(await call('chrome_screenshot', { tabId }))
    assert.ok(nativeImage.createFromBuffer(Buffer.from(image.base64Data, 'base64')).getSize().width > 100)
    await call('chrome_computer', { tabId, action: 'screenshot' })
    await call('chrome_computer', { tabId, action: 'hover', coordinates: { x: 100, y: 100 } })
    await call('chrome_javascript', { tabId, code: "return document.querySelector('#result').textContent" })
    await call('chrome_upload_file', { tabId, selector: '#file', mediaUrl: '/media/test.txt' })
    assert.equal(await contents.executeJavaScript("document.querySelector('#file').files[0].text()"), 'native upload bytes')
    await call('chrome_upload_file', { tabId, selector: '#file', mediaUrl: 'file:///etc/hosts' }, true)
    for (const mediaUrl of ['/media/redirect', '/media/oversized', '/media/stream']) {
      await call('chrome_upload_file', { tabId, selector: '#file', mediaUrl }, true)
    }
    await call('chrome_switch_tab', { tabId })
    await call('chrome_handle_dialog', { tabId: manual.view.webContents.id, action: 'dismiss' }, true)
    compatibility.debuggerAttach({ target: { tabId }, requiredVersion: '1.3', extensionId: 'matter-native-browser' })
    await contents.debugger.sendCommand('Page.enable')
    const dialogOpened = new Promise((resolve, reject) => {
      setTimeout(() => reject(new Error('test dialog did not open')), 5000).unref()
      const listener = (_event, method) => {
        if (method === 'Page.javascriptDialogOpening') { contents.debugger.removeListener('message', listener); resolve() }
      }
      contents.debugger.on('message', listener)
    })
    const dialog = contents.debugger.sendCommand('Runtime.evaluate', { expression: "confirm('Native dialog')", returnByValue: true })
    await dialogOpened
    await call('chrome_handle_dialog', { tabId, action: 'accept', promptText: 'native response' })
    assert.equal((await dialog).result.value, true)
    const cancelledId = 'cancel-test'
    socket.send(JSON.stringify({ jsonrpc: '2.0', id: cancelledId, method: 'tools/call', params: {
      name: 'chrome_javascript', arguments: { tabId, code: "globalThis.__cancelStarted=true; return await new Promise(resolve=>setTimeout(()=>resolve('late result'),10000))" },
    } }))
    await until(() => contents.executeJavaScript('globalThis.__cancelStarted === true'))
    const busy = new Promise(resolve => pending.set('busy-test', resolve))
    socket.send(JSON.stringify({ jsonrpc: '2.0', id: 'busy-test', method: 'tools/call', params: { name: 'get_windows_and_tabs' } }))
    assert.equal((await busy).result.isError,true)
    socket.send(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: cancelledId } }))
    await until(() => !compatibility.debuggerOwners.has(tabId))
    await new Promise(resolve => setTimeout(resolve, 100))
    await call('chrome_fill_or_select', { tabId, selector: '#name', value: 'After cancellation' })
    assert.equal(await contents.executeJavaScript("document.querySelector('#name').value"), 'After cancellation')
    assert.equal(replies.has(cancelledId), false)
    assert.equal(await contents.executeJavaScript('typeof window.browserSettings'), 'undefined')
    await matter.webContents.executeJavaScript("localStorage.removeItem('matter.token')")
    await device.refresh()
    assert.equal(device.snapshot().available, false)
    await device.refresh()
    await matter.webContents.executeJavaScript(`localStorage.setItem('matter.token',${JSON.stringify(jwt)})`)
    await device.refresh()
    await until(() => device.snapshot().state === '在线')
    assert.equal(BrowserWindow.getAllWindows().length, 1, 'automatic registration opens no settings window')
    await call('chrome_navigate', { tabId, url: origin + '/next' })
    await call('chrome_fill_or_select', { tabId, ref, value: 'stale' }, true)
    await call('chrome_close_tabs', { tabIds: [tabId] })
    assert.equal(tabs.has(manual.id), true)
    console.log('PASS login runtime without pairing, all 15 tools, task tabs, refs, isolated helpers, frames, upload, screenshots, dialogs, cancellation, and navigation')
  } catch (error) { console.error(error); process.exitCode = 1 }
  finally {
    clearTimeout(watchdog); device?.dispose()
    for (const tab of [...tabs.values()]) closeTab(tab.id)
    if (host && !host.isDestroyed()) host.destroy()
    wss?.clients.forEach(client => client.terminate()); wss?.close(); server?.close()
    app.exit(process.exitCode || 0)
  }
})
