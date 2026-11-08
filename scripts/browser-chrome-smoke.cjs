// Full native-window regression: shared Web chrome + trusted pointer capture across Chromium views.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const http = require('node:http')
const os = require('node:os')
const path = require('node:path')
const electron = require('electron')
const { app, BrowserWindow, WebContentsView, webContents } = electron
const permissions = require('../src/fullDiskAccess.cjs')
let permissionPrompts = 0
const { MATTER_TOP_INSET } = require('../src/rightPanelLayout.cjs')
const { verifyNewTab, verifySettings } = require('./browser-pages-probe.cjs')

// Offscreen native surfaces keep real user mouse movement out of trusted-input assertions.
const testElectron = Object.create(electron)
Object.defineProperty(testElectron, 'dialog', { value: { ...electron.dialog, showMessageBox: async (...args) => {
  const options = args.at(-1)
  assert.equal(options.title, '完全磁盘访问'); permissionPrompts++
  return { response: 1 }
} } })
function TestWindow(options) {
  const window = new BrowserWindow({ ...options, show: false,
    webPreferences: { ...options.webPreferences, offscreen: true, backgroundThrottling: false } })
  window.show = () => {}
  window.focus = () => {}
  return window
}
Object.setPrototypeOf(TestWindow, BrowserWindow)
Object.defineProperty(testElectron, 'BrowserWindow', { value: TestWindow })
Object.defineProperty(testElectron, 'WebContentsView', { value: function (options) {
  return new WebContentsView({ ...options,
    webPreferences: { ...options.webPreferences, offscreen: true, backgroundThrottling: false } })
} })

const root = path.resolve(__dirname, '..')
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'minduck-chrome-smoke-'))
const settingsFile = path.join(temporary, 'agent-settings.json')
fs.writeFileSync(settingsFile, JSON.stringify({ fullDiskAccessPromptAcknowledged: true, rightPanelWidth: 650 }))
process.env.MINDUCK_USER_DATA_DIR = temporary
process.env.MINDUCK_MATTER_ORIGIN = 'https://matter.smoke.invalid'
app.setAppPath(root)

const server = http.createServer((request, response) => {
  response.setHeader('Content-Type', 'text/html; charset=utf-8')
  response.end(`<title>Browser fixture ${request.url}</title><body style="background:#fff;color:#111"><a href="/second">Navigation fixture</a></body>`)
})

async function waitFor(read, predicate, label) {
  const deadline = Date.now() + 20_000
  let value
  while (Date.now() < deadline) {
    value = await read()
    if (predicate(value)) return value
    await new Promise((resolve) => setTimeout(resolve, 40))
  }
  throw new Error(`Timed out: ${label}; last: ${JSON.stringify(value)}`)
}

const Module = require('node:module')
const load = Module._load
try {
  Module._load = function (request, ...args) {
    if (request.endsWith('/fullDiskAccess.cjs')) return { ...permissions, hasFullDiskAccess: () => false,
      createPermissionPrompt: options => permissions.createPermissionPrompt({ ...options, check: () => false }) }
    return request === 'electron' ? testElectron : load.call(this, request, ...args)
  }
  require('../src/main.cjs')
} finally {
  Module._load = load
}

async function probe() {
  await app.whenReady()
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const fixture = `http://127.0.0.1:${server.address().port}`
  const window = await waitFor(() => BrowserWindow.getAllWindows().find((item) => item.contentView.children.length >= 5), Boolean, 'main window')
  await waitFor(() => permissionPrompts, value => value === 1, 'native startup permission prompt')
  const labels = electron.Menu.getApplicationMenu().items.flatMap(item => item.submenu?.items.map(child => child.label) || [])
  assert.ok(!labels.includes('本机执行设置…'))
  assert.equal(BrowserWindow.getAllWindows().some(item => item.webContents.getURL().endsWith('/local-exec/settings.html')), false)
  const { getAgentBrowserSession, MATTER_BROWSER_EXTENSION_NAME } = require('../src/agentBrowser.cjs')
  assert.equal(getAgentBrowserSession().extensions.getAllExtensions().some(item => item.name === MATTER_BROWSER_EXTENSION_NAME), false,
    'default app uses the native browser device without starting a Matter Browser extension')
  const chrome = await waitFor(() => webContents.getAllWebContents().find((item) => item.getURL().includes('surface=chrome')), Boolean, 'shared chrome')
  const resizer = await waitFor(() => webContents.getAllWebContents().find((item) => item.getURL().includes('surface=resizer')), Boolean, 'shared resizer')
  const state = () => chrome.executeJavaScript('minduckBrowserShell.getState()')
  const command = (type, extra = {}) => chrome.executeJavaScript(`minduckBrowserShell.command(${JSON.stringify({ type, ...extra })})`)
  const view = (wc) => window.contentView.children.find((item) => item.webContents?.id === wc.id)
  const matterFrame = () => window.contentView.children.find((item) => item.children.some((child) => child.webContents?.getURL().startsWith('https://matter.')))
  const rightFrame = () => window.contentView.children.find((item) => item !== matterFrame() && item.children.length)

  await chrome.executeJavaScript('document.querySelector("[aria-label=打开浏览器]").click()')
  await waitFor(state, (value) => value.rightPanelOpen && value.panelMotion === 'opening' && value.tabs.length === 1, 'panel opening motion')
  assert.equal((await state()).tabs[0].url, '', 'first browser tab opens the local unbranded search page')
  await waitFor(state, (value) => value.rightPanelOpen && !value.panelMotion, 'panel open')
  await verifyNewTab({ chrome, command, state, waitFor, temporary })
  await command('new-tab')
  await waitFor(state, (value) => value.tabs.length === 2, 'local page for settings cache check')
  await verifySettings({ command, waitFor, temporary })
  await command('close-tab', { tabId: (await state()).tabs.at(-1).id })
  await command('open-address', { value: fixture })
  await waitFor(state, (value) => value.tabs[0].url === fixture + '/' && !value.tabs[0].loading, 'fixture navigation')
  const fixturePage = webContents.getAllWebContents().find((item) => item.getURL() === fixture + '/')
  const shortcut = (contents, key) => {
    // CDP dispatch targets renderer input; this offscreen probe exercises Electron's registered native event route.
    let prevented = false
    contents.emit('before-input-event', { preventDefault() { prevented = true } }, {
      type: 'keyDown', key, meta: process.platform === 'darwin', control: process.platform !== 'darwin', alt: false,
    })
    assert.ok(prevented, `native shortcut ${key} is handled`)
  }
  shortcut(fixturePage, 'l')
  await waitFor(() => chrome.executeJavaScript('document.activeElement?.id'), (id) => id === 'address', 'page shortcut focuses address')
  shortcut(fixturePage, 't')
  await waitFor(state, (value) => value.tabs.length === 2, 'page shortcut creates tab')
  const shortcutPage = await waitFor(() => webContents.getAllWebContents().find((item) => item.getURL().includes('surface=newtab')),
    Boolean, 'shortcut-created tab')
  shortcut(shortcutPage, 'w')
  await waitFor(state, (value) => value.tabs.length === 1, 'page shortcut closes active tab')
  console.log('PASS browser-page Cmd/Ctrl+L/T/W native event routing and address-focus IPC')
  await waitFor(() => chrome.executeJavaScript('document.querySelector(".desktop-chrome")?.getBoundingClientRect().height'), (height) => height > 80 && view(chrome).getBounds().height === Math.ceil(height), 'natural toolbar height')

  resizer.debugger.attach('1.3')
  chrome.debugger.attach('1.3')
  await chrome.debugger.sendCommand('DOM.enable')
  await chrome.debugger.sendCommand('CSS.enable')
  const forceTabState = async (selector, forcedPseudoClasses) => {
    const { root } = await chrome.debugger.sendCommand('DOM.getDocument')
    const { nodeId } = await chrome.debugger.sendCommand('DOM.querySelector', { nodeId: root.nodeId, selector })
    assert.ok(nodeId, selector)
    await chrome.debugger.sendCommand('CSS.forcePseudoState', { nodeId, forcedPseudoClasses })
  }
  await resizer.executeJavaScript(`window.resizeProbe = []; for (const type of ['pointerdown','pointermove','pointerup','lostpointercapture']) addEventListener(type, (event) => resizeProbe.push({ type, x: event.clientX, screenX: event.screenX, width: innerWidth }))`)
  const input = (type, x, y = 200) => resizer.debugger.sendCommand('Input.dispatchMouseEvent', {
    type, x: Math.round(x), y, button: type === 'mouseMoved' ? 'none' : 'left',
    buttons: type === 'mouseReleased' ? 0 : 1, clickCount: type === 'mouseMoved' ? 0 : 1,
  })

  for (const width of [960, 1280, 1440]) {
    window.setContentSize(width, 800)
    await waitFor(() => matterFrame().getBounds().width + rightFrame().getBounds().width, (value) => value === width, 'adjacent native surfaces')
    const [contentWidth, contentHeight] = window.getContentSize()
    assert.deepEqual(matterFrame().children[0].getBounds(), {
      x: 0,
      y: process.platform === 'darwin' ? MATTER_TOP_INSET : 0,
      width: contentWidth - rightFrame().getBounds().width,
      height: contentHeight - (process.platform === 'darwin' ? MATTER_TOP_INSET : 0),
    }, 'Matter content avoids macOS window controls')
    const start = view(resizer).getBounds()
    const before = rightFrame().getBounds().width
    window.focus()
    const savedBefore = fs.readFileSync(settingsFile, 'utf8')
    // Offscreen WebContentsViews use the parent viewport even when native bounds are narrow.
    // Their CDP screen coordinates therefore stay in parent space throughout the drag.
    await input('mouseMoved', start.x + 5)
    await input('mousePressed', start.x + 5)
    await waitFor(() => resizer.executeJavaScript('minduckPanelResizer.getState()'), (value) => value.capturing, 'drag capture')
    assert.equal(view(resizer).getBounds().width, width)
    await waitFor(() => resizer.executeJavaScript('innerWidth'), (value) => value === width, 'capture viewport')
    await input('mouseMoved', start.x + 5 + 70)
    try {
      await waitFor(() => rightFrame().getBounds().width, (value) => value === before - 70, 'live width before mouse release')
    } catch (error) {
      console.error({ before, start, window: window.getContentSize(), panel: rightFrame().getBounds(), inputs: await resizer.executeJavaScript('resizeProbe') })
      throw error
    }
    assert.equal(fs.readFileSync(settingsFile, 'utf8'), savedBefore, 'persist only after release')
    await input('mouseMoved', start.x + 5 + 120)
    await waitFor(() => rightFrame().getBounds().width, (value) => value === Math.max(380, before - 120), 'second live frame')
    await input('mouseReleased', start.x + 5 + 120)
    await waitFor(() => resizer.executeJavaScript('minduckPanelResizer.getState()'), (value) => !value.capturing, 'release capture')
    assert.equal(view(resizer).getBounds().width, 11)
    assert.equal(JSON.parse(fs.readFileSync(settingsFile, 'utf8')).rightPanelWidth, rightFrame().getBounds().width)
    await chrome.debugger.sendCommand('Emulation.setDeviceMetricsOverride', {
      width: rightFrame().getBounds().width, height: view(chrome).getBounds().height,
      deviceScaleFactor: 1, mobile: false,
    })
    const layout = await chrome.executeJavaScript(`({ scroll: document.body.scrollWidth, width: innerWidth,
      shared: Boolean(document.querySelector('.panel .input-control') && document.querySelector('.ui-icon')),
      round: [...document.querySelectorAll('.b-icon')].every((item) => parseFloat(getComputedStyle(item).borderTopLeftRadius) >= item.getBoundingClientRect().height / 2),
      pillInput: parseFloat(getComputedStyle(document.querySelector('.input-control')).borderTopLeftRadius) > 100,
      projectInput: document.querySelector('.input').classList.contains('input--pill') && !document.querySelector('.input--address'),
      addressHeight: document.querySelector('.input-control').getBoundingClientRect().height,
      addressFont: getComputedStyle(document.querySelector('.input-control')).fontSize,
      panelFont: getComputedStyle(document.querySelector('.panel')).fontSize,
      addressIcons: document.querySelectorAll('.desktop-address .ui-icon, .desktop-address button').length,
      bodyUsesOverlayScroll: document.querySelector('.desktop-chrome .pn-body')?.classList.contains('overlay-scroll'),
      horizontalThumbs: document.querySelectorAll('.desktop-chrome .overlay-scroll-thumb--horizontal').length,
      navigationOverflow: (() => {
        const body = document.querySelector('.desktop-chrome .pn-body');
        return body ? { client: body.clientWidth, scroll: body.scrollWidth } : null;
      })(),
      tabScrollbarWidth: getComputedStyle(document.querySelector('.desktop-tab-scroll')).scrollbarWidth,
      tabRadius: getComputedStyle(document.querySelector('.desktop-tab.is-active')).borderTopLeftRadius,
      tabBottomRadius: getComputedStyle(document.querySelector('.desktop-tab.is-active')).borderBottomLeftRadius,
      navigationDisplay: getComputedStyle(document.querySelector('.desktop-navigation')).display,
      headerPadding: getComputedStyle(document.querySelector('.desktop-chrome .pn-top')).paddingTop,
      closePadding: getComputedStyle(document.querySelector('.desktop-tab-close')).padding,
      closeSize: document.querySelector('.desktop-tab-close').getBoundingClientRect().width,
      tabInsets: (() => {
        const tab = document.querySelector('.desktop-tab.is-active');
        const bounds = tab.getBoundingClientRect();
        return {
          left: tab.querySelector('.desktop-tab-select').getBoundingClientRect().left - bounds.left,
          right: bounds.right - tab.querySelector('.desktop-tab-close').getBoundingClientRect().right,
        };
      })(),
      clipped: [...document.querySelectorAll('.pn-acts button,.desktop-navigation button,.input-control')].some((item) => {
        const rect = item.getBoundingClientRect(); return rect.left < 0 || rect.right > innerWidth || rect.bottom > innerHeight;
      }) })`)
    assert.ok(layout.shared && layout.round && layout.pillInput && !layout.clipped && layout.scroll <= layout.width, JSON.stringify(layout))
    assert.ok(layout.projectInput && layout.addressHeight === 36 && layout.addressFont === layout.panelFont && layout.addressIcons === 0, JSON.stringify(layout))
    assert.equal(layout.bodyUsesOverlayScroll, false, 'fixed browser navigation does not mount OverlayScroll')
    assert.equal(layout.horizontalThumbs, 0, 'browser chrome has no horizontal scroll thumb')
    assert.ok(layout.navigationOverflow && layout.navigationOverflow.scroll <= layout.navigationOverflow.client, JSON.stringify(layout))
    assert.equal(layout.tabScrollbarWidth, 'none', 'tab strip keeps native overflow available without a visible scrollbar')
    assert.ok(parseFloat(layout.tabRadius) > 100, 'original Matter tabs use the shared pill radius')
    assert.equal(layout.tabBottomRadius, layout.tabRadius, 'tabs retain a pill shape on every corner')
    assert.equal(layout.navigationDisplay, 'flex', 'navigation restores the original shared-control arrangement')
    assert.equal(layout.headerPadding, '12px', 'header restores the shared Panel spacing')
    assert.equal(layout.closePadding, '2px')
    assert.equal(layout.closeSize, 20)
    assert.deepEqual(layout.tabInsets, { left: 6, right: 6 }, 'tab keeps equal horizontal padding')
    assert.equal(matterFrame().getBounds().width, rightFrame().getBounds().x)
    console.log(`PASS ${width}px: two live native resize frames before release, no gap, shared controls fit`)
    // Restore a useful starting width for the next size.
    await chrome.executeJavaScript('document.querySelector(".pn-ib-close").click()')
    await waitFor(state, (value) => !value.rightPanelOpen && value.panelMotion === 'closing', 'collapse motion')
    assert.equal(rightFrame().getVisible(), true, 'browser page remains visible during panel exit')
    await waitFor(state, (value) => !value.rightPanelOpen && !value.panelMotion, 'collapse')
    assert.equal(matterFrame().getBounds().width, width)
    const tabs = (await state()).tabs.map((item) => item.id)
    await command('open-panel')
    await waitFor(state, (value) => value.rightPanelOpen && value.panelMotion === 'opening', 'restore motion')
    await waitFor(state, (value) => value.rightPanelOpen && !value.panelMotion, 'restore')
    assert.deepEqual((await state()).tabs.map((item) => item.id), tabs)
    if (width < 1440) {
      const small = view(resizer).getBounds()
      await input('mouseMoved', small.x + 5)
      await input('mousePressed', small.x + 5)
      await waitFor(() => view(resizer).getBounds().width, (value) => value === width, 'next capture')
      await input('mouseMoved', small.x + 5 - 120)
      await input('mouseReleased', small.x + 5 - 120)
      await waitFor(() => view(resizer).getBounds().width, (value) => value === 11, 'next release')
    }
  }

  await command('new-tab')
  await waitFor(state, (value) => value.tabs.length === 2, 'new tab')
  assert.equal((await state()).tabs.at(-1).url, '', 'new browser tab opens the local search page')
  assert.equal(await chrome.executeJavaScript('document.querySelectorAll(".desktop-chrome .overlay-scroll-thumb--horizontal").length'), 0, 'new tabs do not add a chrome scrollbar')
  assert.equal(await chrome.executeJavaScript('getComputedStyle(document.querySelector(".desktop-navigation")).animationName'), 'desktop-navigation-in')
  await chrome.executeJavaScript('document.querySelector(".desktop-tab.is-active button[title=关闭标签页]").click()')
  await waitFor(state, (value) => value.tabs.length === 1, 'close tab')

  const key = async (name, keyCode) => {
    for (const type of ['keyDown', 'keyUp']) await chrome.debugger.sendCommand('Input.dispatchKeyEvent', {
      type, key: name, code: name, windowsVirtualKeyCode: keyCode, nativeVirtualKeyCode: keyCode,
      ...(name === 'Enter' && type === 'keyDown' ? { text: '\r', unmodifiedText: '\r' } : {}),
    })
  }
  await chrome.executeJavaScript('document.querySelector("#address").focus(); document.querySelector("#address").select()')
  await chrome.debugger.sendCommand('Input.insertText', { text: fixture + '/second' })
  assert.equal(await chrome.executeJavaScript('document.querySelector("#address").value'), fixture + '/second')
  await key('Enter', 13)
  await waitFor(state, (value) => value.tabs[0].url === fixture + '/second' && !value.tabs[0].loading, 'address Enter navigates')
  await chrome.executeJavaScript('document.querySelector("#address").focus(); document.querySelector("#address").select()')
  await chrome.debugger.sendCommand('Input.insertText', { text: 'unfinished-search' })
  await key('Escape', 27)
  await waitFor(() => chrome.executeJavaScript('document.querySelector("#address").value'), (value) => value === fixture + '/second', 'Escape restores active URL')

  // A cancel/blur must remove the native full-window input layer and preserve later drags.
  for (const end of ['pointercancel', 'blur']) {
    const start = view(resizer).getBounds()
    await input('mousePressed', start.x + 5)
    await waitFor(() => resizer.executeJavaScript('minduckPanelResizer.getState()'), (value) => value.capturing, 'cancel capture')
    await input('mouseMoved', start.x + 5 + 20)
    await resizer.executeJavaScript(end === 'blur'
      ? 'dispatchEvent(new Event("blur"))'
      : 'dispatchEvent(new PointerEvent("pointercancel", { pointerId: 1 }))')
    await waitFor(() => resizer.executeJavaScript('minduckPanelResizer.getState()'), (value) => !value.capturing, end)
    await input('mouseReleased', start.x + 5)
    assert.equal(view(resizer).getBounds().width, 11)
  }

  for (const theme of ['light', 'dark']) {
    const matter = matterFrame().children[0].webContents
    await matter.executeJavaScript(`document.documentElement.dataset.theme = '${theme}'`)
    await waitFor(state, (value) => value.theme === theme, 'theme sync')
    await waitFor(() => chrome.executeJavaScript('document.documentElement.dataset.theme'), (value) => value === theme, 'shared theme')
    await waitFor(() => chrome.executeJavaScript('document.getAnimations().filter((item) => item.playState === "running").length'), (value) => value === 0, 'theme transition completes')
    const capture = await chrome.capturePage()
    assert.ok(!capture.isEmpty(), 'toolbar image has pixels')
    fs.writeFileSync(path.join(temporary, `chrome-${theme}.png`), capture.toPNG())
    const tabLabel = '.desktop-tab.is-active .desktop-tab-select'
    for (const pseudo of ['hover', 'active', 'focus-visible']) {
      await forceTabState(tabLabel, [pseudo])
      await waitFor(() => chrome.executeJavaScript('document.getAnimations().filter((item) => item.playState === "running").length'), (value) => value === 0, 'tab transition')
      assert.equal(await chrome.executeJavaScript(`getComputedStyle(document.querySelector('${tabLabel}')).backgroundColor`), 'rgba(0, 0, 0, 0)', `tab label stays transparent on ${pseudo}`)
    }
    await forceTabState(tabLabel, [])
    await forceTabState('.desktop-tab.is-active .desktop-tab-close', ['hover'])
    await waitFor(() => chrome.executeJavaScript('document.getAnimations().filter((item) => item.playState === "running").length'), (value) => value === 0, 'close hover transition')
    assert.notEqual(await chrome.executeJavaScript('getComputedStyle(document.querySelector(".desktop-tab.is-active .desktop-tab-close")).backgroundColor'), 'rgba(0, 0, 0, 0)', 'close retains compact hover feedback')
    fs.writeFileSync(path.join(temporary, `chrome-${theme}-close-hover.png`), (await chrome.capturePage()).toPNG())
    await forceTabState('.desktop-tab.is-active .desktop-tab-close', [])
    await chrome.executeJavaScript('document.querySelector("#address").focus()')
    await waitFor(() => chrome.executeJavaScript('document.getAnimations().filter((item) => item.playState === "running").length'), (value) => value === 0, 'address focus transition')
    const focused = await chrome.executeJavaScript(`(() => {
      const input = document.querySelector('#address'); const style = getComputedStyle(input);
      return { height: input.getBoundingClientRect().height, border: style.borderColor, ring: style.boxShadow };
    })()`)
    assert.equal(focused.height, 36)
    assert.equal(focused.ring, 'none', 'public inputs keep their shadow-free appearance')
    assert.equal(focused.border, 'rgb(58, 131, 247)', 'public field focus border')
    fs.writeFileSync(path.join(temporary, `chrome-${theme}-focused.png`), (await chrome.capturePage()).toPNG())
    await chrome.executeJavaScript('document.querySelector("#address").blur()')
  }
  console.log('PASS: no inline address icon, transparent tab label states, 2px close padding, equal tab insets, navigation, round buttons, live resize cleanup, light/dark; previews:', temporary)
  resizer.debugger.detach()
  chrome.debugger.detach()
}

probe().catch((error) => { console.error(error); process.exitCode = 1 }).finally(() => {
  server.close()
  app.once('will-quit', () => { if (process.exitCode) app.exit(process.exitCode) })
  app.quit()
  setTimeout(() => app.exit(process.exitCode || 0), 8_000).unref()
})
