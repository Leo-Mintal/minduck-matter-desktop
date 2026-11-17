// Full native-window regression: shared Web chrome + trusted pointer capture across Chromium views.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const http = require('node:http')
const os = require('node:os')
const path = require('node:path')
const electron = require('electron')
const { EventEmitter } = require('node:events')
const desktopUpdater = require('../src/desktopUpdater.cjs')
const { app, BrowserWindow, WebContentsView, webContents } = electron
const permissions = require('../src/fullDiskAccess.cjs')
let permissionPrompts = 0
const currentVersion = require('../package.json').version
const nextVersion = currentVersion.replace(/\d+$/, patch => String(Number(patch) + 1))
let updateVersion = nextVersion
let updateFails = false
const updateDownloads = []
const updateDialogs = []
let updateResponse = 1
let finishUpdateDownload
const updateLifecycle = []
const fakeUpdater = new EventEmitter(), fakeNativeUpdater = new EventEmitter()
fakeUpdater.checkForUpdates = async () => {
  if (updateFails) throw new Error('fixture unavailable')
  return { isUpdateAvailable: updateVersion !== currentVersion, updateInfo: { version: updateVersion,
    files: [{ url: `MinduckMatter-${updateVersion}-arm64.zip`, size: 1024,
      sha512: Buffer.alloc(64, 1).toString('base64') }] } }
}
fakeUpdater.downloadUpdate = () => new Promise(resolve => {
  updateLifecycle.push('download')
  fakeUpdater.emit('download-progress', { percent: 37 })
  finishUpdateDownload = () => resolve(['/isolated-test/update.zip'])
})
fakeUpdater.quitAndInstall = () => updateLifecycle.push('install')
fakeNativeUpdater.checkForUpdates = () => {
  updateLifecycle.push('verify'); queueMicrotask(() => fakeNativeUpdater.emit('update-downloaded'))
}
const connectionDialogs = []
const { MATTER_TOP_INSET, FRAME_RAIL_WIDTH, FRAME_EDGE, FRAME_GAP, FRAME_RADIUS } = require('../src/rightPanelLayout.cjs')
const permissionSettings = []
let permissionChecks = 0
const permissionSettingsOnly = process.argv.includes('--permission-settings-only')
const { verifyNewTab, verifySettings } = require('./browser-pages-probe.cjs')

// Offscreen native surfaces keep real user mouse movement out of trusted-input assertions.
const testElectron = Object.create(electron)
Object.defineProperty(testElectron, 'dialog', { value: { ...electron.dialog, showMessageBox: async (...args) => {
  const options = args.at(-1)
  if (options.title === '本机连接状态') {
    connectionDialogs.push(options); return { response: options.cancelId }
  }
  if (options.title !== '完全磁盘访问') {
    assert.ok(['检查更新', '发现新版本', '更新失败'].includes(options.title))
    updateDialogs.push(options.title); return { response: updateResponse }
  }
  permissionPrompts++
  return { response: 1 }
} } })
Object.defineProperty(testElectron, 'shell', { value: { ...electron.shell, openExternal: async url => {
  if (url === permissions.FULL_DISK_ACCESS_SETTINGS_URL) {
    assert.ok(permissionChecks > 0, 'main process probes before opening Settings')
    permissionSettings.push(url)
  } else updateDownloads.push(url)
} } })
function TestWindow(options) {
  const window = new BrowserWindow({ ...options, show: false,
    webPreferences: { ...options.webPreferences, offscreen: true, backgroundThrottling: false } })
  window.show = () => window.emit('show')
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
fs.writeFileSync(settingsFile, JSON.stringify({ fullDiskAccessPromptAcknowledged: !permissionSettingsOnly, rightPanelWidth: 650 }))
process.env.MINDUCK_USER_DATA_DIR = temporary
process.env.MINDUCK_MATTER_ORIGIN = 'https://matter.smoke.invalid'
app.setAppPath(root)
app.getVersion = () => currentVersion

const server = http.createServer((request, response) => {
  response.setHeader('Content-Type', 'text/html; charset=utf-8')
  response.end(`<title>Browser fixture ${request.url}</title><body style="background:#fff;color:#111">
    <a href="/second">Navigation fixture</a><button id="fixed-action" style="position:fixed;bottom:16px;right:16px">Fixed action</button></body>`)
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
    const check = () => { permissionChecks++; return false }
    if (request.endsWith('/fullDiskAccess.cjs')) return { ...permissions, hasFullDiskAccess: check }
    if (request === './client-runtime.cjs') {
      const runtime = load.call(this, request, ...args)
      return { ...runtime, createClientRuntime: options => runtime.createClientRuntime({ ...options, bridgePort: 0 }) }
    }
    // This UI fixture has no activation server; exercise the real public-policy path.
    // Device activation and fail-closed behavior have their own service/gate regressions.
    if (request.endsWith('/desktop-access/service.cjs')) {
      const service = load.call(this, request, ...args)
      return { ...service, createService: options => service.createService({ ...options, fetchImpl: async url => {
        assert.equal(new URL(url).pathname, '/api/desktop-access/policy')
        return new Response(JSON.stringify({ protocol: 1, required: false }), { status: 200 })
      } }) }
    }
    if (request.endsWith('/desktopUpdater.cjs')) return { ...desktopUpdater,
      macUpdateRuntime: () => ({ updater: fakeUpdater, nativeUpdater: fakeNativeUpdater }),
      createDesktopUpdater: options => desktopUpdater.createDesktopUpdater({ ...options,
        hasActiveTasks: () => false, prepareToQuit: async () => { updateLifecycle.push('stop') } }) }
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
  assert.equal(permissionPrompts, 0, 'startup never opens a permission dialog')
  assert.deepEqual(permissionSettings, [], 'startup never opens Full Disk Access settings')
  assert.equal(permissionChecks, 0, 'startup does not probe Full Disk Access')
  assert.equal(JSON.parse(fs.readFileSync(settingsFile)).fullDiskAccessPromptAcknowledged, !permissionSettingsOnly)
  const labels = electron.Menu.getApplicationMenu().items.flatMap(item => item.submenu?.items.map(child => child.label) || [])
  assert.ok(!labels.includes('本机执行设置…'))
  assert.ok(!labels.includes('内置浏览器设置…'))
  const permissionMenu = electron.Menu.getApplicationMenu().items.flatMap(item => item.submenu?.items || [])
    .find(item => item.label === '完全磁盘访问授权...')
  assert.ok(permissionMenu, 'direct permission settings remain available from the app menu')
  const windowCount = BrowserWindow.getAllWindows().length
  const openedBefore = permissionSettings.length, checksBefore = permissionChecks
  permissionMenu.click()
  await waitFor(() => permissionSettings.length, value => value === openedBefore + 1, 'direct System Settings navigation')
  assert.ok(permissionChecks > checksBefore, 'menu probes again before opening Settings')
  assert.ok(permissionSettings.every(url => url === permissions.FULL_DISK_ACCESS_SETTINGS_URL))
  assert.equal(BrowserWindow.getAllWindows().length, windowCount, 'permission navigation creates no app window')
  assert.equal(permissionPrompts, 0, 'permission navigation never shows an informational dialog')
  if (permissionSettingsOnly) {
    assert.equal(windowCount, 1, 'only the main app window exists')
    console.log('PASS fresh startup does not probe FDA or open Settings, manual menu still opens exact permission page; no app permission window or dialog, real TCC unchanged')
    return
  }
  assert.equal(BrowserWindow.getAllWindows().some(item => item.webContents.getURL().endsWith('/local-exec/settings.html')), false)
  assert.equal(BrowserWindow.getAllWindows().some(item => item.webContents.getURL().endsWith('/browser-device/settings.html')), false)
  const { getAgentBrowserSession, MATTER_BROWSER_EXTENSION_NAME } = require('../src/agentBrowser.cjs')
  assert.equal(getAgentBrowserSession().extensions.getAllExtensions().some(item => item.name === MATTER_BROWSER_EXTENSION_NAME), false,
    'default app uses the native browser device without starting a Matter Browser extension')
  const chrome = await waitFor(() => webContents.getAllWebContents().find((item) => item.getURL().includes('surface=chrome')), Boolean, 'shared chrome')
  const resizer = await waitFor(() => webContents.getAllWebContents().find((item) => item.getURL().includes('surface=resizer')), Boolean, 'shared resizer')
  const state = () => chrome.executeJavaScript('minduckBrowserShell.getState()')
  const command = (type, extra = {}) => chrome.executeJavaScript(`minduckBrowserShell.command(${JSON.stringify({ type, ...extra })})`)
  const verifyAddTabPosition = async () => {
    const position = await chrome.executeJavaScript(`(() => {
      const last = document.querySelector('.desktop-tab:last-child').getBoundingClientRect();
      const strip = document.querySelector('.desktop-tab-scroll').getBoundingClientRect();
      const add = document.querySelector('.pn-acts [aria-label="新建标签页"]').getBoundingClientRect();
      const toggle = document.querySelector('.pn-ib-close').getBoundingClientRect();
      return { gap: add.left - Math.min(last.right, strip.right), addRight: add.right,
        toggleLeft: toggle.left, viewport: innerWidth };
    })()`)
    assert.ok(Math.abs(position.gap - 8) < 1, `new-tab follows the final visible tab: ${JSON.stringify(position)}`)
    assert.ok(position.addRight <= position.toggleLeft && position.toggleLeft < position.viewport, JSON.stringify(position))
  }
  const descendants = (parent) => parent.children.flatMap(item => [item, ...descendants(item)])
  const view = (wc) => descendants(window.contentView).find((item) => item.webContents?.id === wc.id)
  const matterFrame = () => window.contentView.children.find((item) => item.children.some((child) => child.webContents?.getURL().startsWith('https://matter.')))
  const rightFrame = () => window.contentView.children.find((item) => item !== matterFrame() && item.children.length)

  const desktop = window.webContents
  await waitFor(() => desktop.executeJavaScript('window.minduckDesktopFrame?.getState()'), value => value?.update.available, 'silent update detection')
  assert.deepEqual(updateDownloads, [], 'automatic detection never opens a download')
  assert.deepEqual(updateDialogs, [], 'automatic detection stays quiet')
  const rail = await desktop.executeJavaScript(`({ buttons: document.querySelectorAll('.rail button').length,
    pages: document.querySelectorAll('.rail-pages button').length,
    tools: document.querySelectorAll('.rail-tools button').length,
    width: document.querySelector('.rail').getBoundingClientRect().width,
    border: getComputedStyle(document.querySelector('.rail')).borderRightWidth,
    gap: getComputedStyle(document.querySelector('.rail-tools')).rowGap,
    geometry: [...document.querySelectorAll('.rail button')].map(button => {
      const bounds = button.getBoundingClientRect();
      return { width: bounds.width, height: bounds.height, radius: getComputedStyle(button).borderRadius,
        icons: [...button.querySelectorAll('.icon, .available-icon')].map(icon => {
          const style = getComputedStyle(icon);
          return { width: parseFloat(style.width), height: parseFloat(style.height) };
        }) };
    }),
    home: document.querySelector('#matter-home'),
    toolsBottom: document.querySelector('.rail-tools').getBoundingClientRect().bottom,
    railBottom: document.querySelector('.rail').getBoundingClientRect().bottom,
    available: document.querySelector('#check-update').dataset.available,
    green: getComputedStyle(document.querySelector('.available-icon')).display,
    toggle: getComputedStyle(document.querySelector('.sidebar-icon')).maskImage,
    node: typeof require })`)
  assert.equal(rail.buttons, 2)
  assert.equal(rail.pages, 0)
  assert.equal(rail.tools, 2)
  assert.equal(rail.home, null, 'temporary home entry is removed')
  assert.equal(rail.toolsBottom, rail.railBottom - 4, 'settings and updates stay anchored at the bottom')
  assert.equal(rail.width, FRAME_RAIL_WIDTH)
  assert.equal(rail.width, 49)
  assert.equal(rail.border, '0px', 'fallback rail has no divider beside the chat list')
  assert.equal(rail.gap, '2px')
  for (const button of rail.geometry) {
    assert.equal(button.width, 40); assert.equal(button.height, 36); assert.equal(button.radius, '10px')
    for (const icon of button.icons) assert.deepEqual(icon, { width: 20, height: 20 })
  }
  assert.equal(rail.available, 'true')
  assert.equal(rail.green, 'block')
  assert.ok(rail.toggle.includes('sidebar-toggle.svg'))
  assert.equal(rail.node, 'undefined')
  await waitFor(matterFrame, Boolean, 'committed Matter view')
  const matter = matterFrame().children.find(item => item.webContents).webContents
  await waitFor(() => matter.executeJavaScript('!!document.querySelector("[data-desktop-update]")'), Boolean, 'shared update control')
  for (const theme of ['dark', 'light']) {
    const expectedColor = theme === 'dark' ? 'rgb(34, 198, 88)' : 'rgb(22, 139, 60)'
    for (const renderer of [desktop, matter]) {
      await renderer.executeJavaScript(`document.documentElement.dataset.theme = '${theme}'`)
      await waitFor(() => renderer.executeJavaScript(`(() => {
        const icon = document.querySelector('.desktop-workspace-update-available, #check-update .available-icon');
        return icon && getComputedStyle(icon).color;
      })()`), value => value === expectedColor, `${theme} green upgrade arrow`)
      assert.equal(await renderer.executeJavaScript(`!!document.querySelector('[data-desktop-update] .changelog-update-dot')`), false,
        'desktop upgrade uses the original green arrow without an orange dot')
    }
    fs.writeFileSync(path.join(temporary, `workspace-available-${theme}.png`),
      (await matter.capturePage({ x: 0, y: view(matter).getBounds().height - 180, width: 80, height: 180 })).toPNG())
  }
  console.log('PASS original green upgrade arrow in native and shared rails, light/dark, no orange update dot')
  const navigation = await desktop.executeJavaScript(`({ title: document.querySelector('.app-title'),
    height: document.querySelector('.titlebar').getBoundingClientRect().height,
    region: getComputedStyle(document.querySelector('.titlebar')).getPropertyValue('-webkit-app-region'),
    buttons: [...document.querySelectorAll('.page-navigation button')].map(button => {
      const bounds = button.getBoundingClientRect(); const icon = button.querySelector('.icon').getBoundingClientRect();
      return { id: button.id, x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height,
        center: bounds.y + bounds.height / 2, radius: getComputedStyle(button).borderRadius,
        icon: { width: icon.width, height: icon.height } };
    }) })`)
  assert.equal(navigation.title, null)
  assert.equal(navigation.height, 36)
  assert.equal(navigation.region, 'none', 'root titlebar cannot add a window-wide drag region beneath sibling browser controls')
  assert.deepEqual(navigation.buttons.map(button => button.id), ['matter-back', 'matter-forward', 'matter-reload'])
  const drag = await waitFor(() => window.contentView.children.find(item => item.webContents?.getURL().endsWith('window-drag-region.html')),
    Boolean, 'native titlebar drag surface')
  assert.equal(await drag.webContents.executeJavaScript(`getComputedStyle(document.body).getPropertyValue('-webkit-app-region')`), 'drag')
  for (const button of navigation.buttons) {
    assert.deepEqual(button.icon, { width: 16, height: 16 })
    assert.equal(button.width, 28); assert.equal(button.height, 28)
    assert.equal(button.radius, '50%'); assert.equal(button.center, 18)
    assert.ok(button.x + button.width < drag.getBounds().x)
  }
  assert.equal(await desktop.executeJavaScript('document.querySelector("#local-exec-status")'), null, 'desktop frame has no local capability banner')
  if (process.platform === 'darwin') assert.equal(window.getWindowButtonPosition().y, 11)
  await waitFor(() => !matter.isLoading(), Boolean, 'Matter initial load settles before history fixture')
  // Model user navigation so Chromium does not treat these as skippable script-only entries.
  await matter.executeJavaScript(`history.pushState({}, '', '/c/frame-first'); history.pushState({}, '', '/c/frame-second')`, true)
  await waitFor(() => desktop.executeJavaScript('minduckDesktopFrame.getState()'), value => value.navigation.canGoBack, 'Matter history enables back')
  await waitFor(() => desktop.executeJavaScript('!document.querySelector("#matter-back").disabled'), Boolean, 'Matter back control rendered')
  await desktop.executeJavaScript('document.querySelector("#matter-back").click()')
  await waitFor(() => matter.getURL(), value => value.endsWith('/c/frame-first'), 'top back navigates Matter')
  await waitFor(() => desktop.executeJavaScript('!document.querySelector("#matter-forward").disabled'), Boolean, 'Matter forward enabled')
  await desktop.executeJavaScript('document.querySelector("#matter-forward").click()')
  await waitFor(() => matter.getURL(), value => value.endsWith('/c/frame-second'), 'top forward navigates Matter')
  let mainReloads = 0
  matter.once('did-finish-load', () => mainReloads++)
  await desktop.executeJavaScript('document.querySelector("#matter-reload").click()')
  await waitFor(() => mainReloads, value => value === 1, 'top refresh reloads Matter')
  assert.ok(await matter.executeJavaScript(`(() => {
    const button = document.createElement('button');
    button.style.cssText = 'position:fixed;bottom:16px;right:16px;width:40px;height:24px;z-index:2147483647';
    document.body.append(button); const bounds = button.getBoundingClientRect();
    const visible = Math.abs(bounds.bottom - (innerHeight - 16)) < 1
      && document.elementFromPoint(bounds.x + 20, bounds.y + 12) === button;
    button.remove(); return visible;
  })()`), 'Matter corner clipping preserves fixed-position controls')
  console.log('PASS compact titlebar: no app title, three 16px icons, circular buttons, native alignment and Matter history/reload')
  await desktop.executeJavaScript('document.querySelector("#check-update").click()')
  await waitFor(() => updateDialogs.length, value => value === 1, 'update confirmation completed')
  assert.deepEqual(updateDownloads, [], 'update actions never open the system browser')
  assert.deepEqual(updateLifecycle, [], 'cancelling the confirmation never downloads or installs')
  updateVersion = currentVersion
  await desktop.executeJavaScript('document.querySelector("#check-update").click()')
  await waitFor(() => desktop.executeJavaScript('minduckDesktopFrame.getState()'), value => !value.update.checking && !value.update.available, 'up-to-date clears badge')
  await waitFor(() => updateDialogs.length, value => value === 2, 'up-to-date dialog completed')
  updateFails = true
  await desktop.executeJavaScript('document.querySelector("#check-update").click()')
  await waitFor(() => desktop.executeJavaScript('minduckDesktopFrame.getState()'), value => value.update.error, 'failed check exposes retry state')
  await waitFor(() => updateDialogs.length, value => value === 3, 'failed check dialog completed')
  updateFails = false
  await desktop.executeJavaScript('document.querySelector("#companion-settings").click()')
  const petSettings = await waitFor(() => BrowserWindow.getAllWindows().find(item => item.getTitle() === 'Minduck 桌宠设置'), Boolean, 'rail opens companion settings')
  petSettings.close()
  console.log('PASS fixed icon rail, real settings route, quiet update badge, update confirmation and error retry')

  await window.webContents.executeJavaScript('document.querySelector("#browser-toggle").click()')
  await waitFor(state, (value) => value.rightPanelOpen && value.panelMotion === 'opening' && value.tabs.length === 1, 'panel opening motion')
  assert.equal((await state()).tabs[0].url, '', 'first browser tab opens the local unbranded search page')
  await waitFor(state, (value) => value.rightPanelOpen && !value.panelMotion, 'panel open')
  const chromeRegions = await waitFor(() => chrome.executeJavaScript(`[...document.querySelectorAll('button, input')].map(control => ({
    label: control.getAttribute('aria-label') || control.title,
    region: getComputedStyle(control).getPropertyValue('-webkit-app-region'),
  }))`), value => value.length > 5, 'browser controls render before testing input regions')
  for (const control of chromeRegions) assert.equal(control.region, 'no-drag', control.label)
  console.log('PASS input regions: root titlebar has no drag region, bounded native drag retained and browser controls excluded')
  await verifyNewTab({ chrome, command, state, waitFor, temporary })
  await command('new-tab')
  await waitFor(state, (value) => value.tabs.length === 2, 'local page for settings cache check')
  await verifySettings({ command, waitFor, temporary })
  await command('close-tab', { tabId: (await state()).tabs.at(-1).id })
  await command('open-address', { value: fixture })
  await waitFor(state, (value) => value.tabs[0].url === fixture + '/' && !value.tabs[0].loading, 'fixture navigation')
  const fixturePage = webContents.getAllWebContents().find((item) => item.getURL() === fixture + '/')
  assert.equal(await fixturePage.executeJavaScript('getComputedStyle(document.documentElement).clipPath'), 'none')
  assert.ok(await fixturePage.executeJavaScript(`(() => {
    const button = document.querySelector('#fixed-action'); const bounds = button.getBoundingClientRect();
    return document.elementFromPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2) === button;
  })()`), 'card corners do not clip fixed controls on short documents')
  assert.ok(await fixturePage.executeJavaScript(`(() => {
    document.body.style.minHeight = '2000px'; window.scrollTo(0, 600);
    const button = document.querySelector('#fixed-action'); const bounds = button.getBoundingClientRect();
    return window.scrollY > 0 && document.elementFromPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2) === button;
  })()`), 'scrolling keeps fixed controls interactive')
  assert.equal(await fixturePage.executeJavaScript('typeof minduckDesktopFrame'), 'undefined')
  for (const sender of [
    { sender: fixturePage, senderFrame: fixturePage.mainFrame },
    { sender: desktop, senderFrame: fixturePage.mainFrame },
  ]) {
    for (const type of ['toggle-browser', 'check-update', 'companion-settings', 'matter-go-back', 'matter-go-forward', 'matter-reload']) {
      electron.ipcMain.emit('desktop-frame:command', sender, type)
    }
  }
  assert.equal((await state()).rightPanelOpen, true)
  assert.equal(updateDialogs.length, 3)
  assert.equal(BrowserWindow.getAllWindows().some(item => item.getTitle() === 'Minduck 桌宠设置'), false)
  console.log('PASS desktop frame bridge absent from browser pages and commands reject untrusted senders/subframes')
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
    await waitFor(() => matterFrame().getBounds().width + rightFrame().getBounds().width, (value) => value === width - FRAME_EDGE - FRAME_GAP, 'framed native surfaces')
    const [contentWidth, contentHeight] = window.getContentSize()
    assert.deepEqual(view(matter).getBounds(), {
      x: 0,
      y: 0,
      width: contentWidth - FRAME_EDGE - FRAME_GAP - rightFrame().getBounds().width,
      height: contentHeight - MATTER_TOP_INSET - FRAME_EDGE,
    }, 'Matter content avoids macOS window controls')
    assert.equal(matterFrame().getBounds().x, 0, 'native Matter surface includes the shared workspace rail')
    const businessBounds = await matter.executeJavaScript(`(() => {
      const r = document.querySelector('.desktop-workspace-content').getBoundingClientRect();
      return { x: r.x, width: r.width, viewport: innerWidth };
    })()`)
    // Offscreen child renderers report the parent viewport, unlike visible native views.
    assert.equal(businessBounds.x, FRAME_RAIL_WIDTH)
    assert.equal(businessBounds.width, businessBounds.viewport - FRAME_RAIL_WIDTH,
      'Web composition reserves exactly one rail inside its renderer viewport')
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
      round: getComputedStyle(document.querySelector('.pn-ib-close')).borderRadius === '8px',
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
    const opener = await desktop.executeJavaScript(`(() => {
      const button = document.querySelector('#browser-toggle');
      const bounds = button.getBoundingClientRect(); const style = getComputedStyle(button);
      const icon = button.querySelector('.icon').getBoundingClientRect();
      return { width: bounds.width, height: bounds.height, radius: style.borderRadius,
        background: style.backgroundColor, iconWidth: icon.width, iconHeight: icon.height };
    })()`)
    const headerActions = await chrome.executeJavaScript(`[...document.querySelectorAll('.pn-acts > .b')].map(button => {
      const bounds = button.getBoundingClientRect(); const style = getComputedStyle(button);
      const icon = button.classList.contains('pn-ib-close')
        ? getComputedStyle(button, '::before') : getComputedStyle(button.querySelector('.pn-icon'));
      return { width: bounds.width, height: bounds.height, radius: style.borderRadius,
        background: style.backgroundColor, iconWidth: parseFloat(icon.width), iconHeight: parseFloat(icon.height) };
    })`)
    assert.equal(headerActions.length, 2)
    assert.deepEqual(opener, { width: 28, height: 28, radius: '8px',
      background: opener.background, iconWidth: 16, iconHeight: 16 })
    for (const action of headerActions) assert.deepEqual(action, opener, 'open/close/new-tab share compact rounded squares')
    assert.ok(layout.projectInput && layout.addressHeight === 34 && layout.addressFont === layout.panelFont && layout.addressIcons === 0, JSON.stringify(layout))
    assert.equal(layout.bodyUsesOverlayScroll, false, 'fixed browser navigation does not mount OverlayScroll')
    assert.equal(layout.horizontalThumbs, 0, 'browser chrome has no horizontal scroll thumb')
    assert.ok(layout.navigationOverflow && layout.navigationOverflow.scroll <= layout.navigationOverflow.client, JSON.stringify(layout))
    assert.equal(layout.tabScrollbarWidth, 'none', 'tab strip keeps native overflow available without a visible scrollbar')
    assert.equal(layout.tabRadius, '8px', 'tabs use the reference rounded rectangle')
    assert.equal(layout.tabBottomRadius, layout.tabRadius)
    assert.equal(layout.navigationDisplay, 'flex', 'navigation restores the original shared-control arrangement')
    assert.equal(layout.headerPadding, '4px', 'tabs fit the shared native titlebar')
    assert.equal(layout.closePadding, '2px')
    assert.equal(layout.closeSize, 20)
    assert.deepEqual(layout.tabInsets, { left: 11, right: 11 }, 'tab keeps equal padding inside its border')
    assert.equal(matterFrame().getBounds().x + matterFrame().getBounds().width + FRAME_GAP, rightFrame().getBounds().x)
    assert.equal(width - rightFrame().getBounds().x - rightFrame().getBounds().width, 4, 'right frame inset is compact')
    assert.equal(window.getContentSize()[1] - rightFrame().getBounds().y - rightFrame().getBounds().height, 4, 'bottom frame inset is compact')
    assert.equal(FRAME_GAP, 1, 'joined content has only a one-pixel seam')
    assert.equal(await matter.executeJavaScript('getComputedStyle(document.querySelector(".desktop-workspace-content")).clipPath'),
      `inset(0px round ${FRAME_RADIUS}px 0px 0px ${FRAME_RADIUS}px)`, 'Matter retains only its outer left corners while joined')
    assert.ok(await matter.executeJavaScript(`getComputedStyle(document.documentElement).clipPath === 'none'
      && document.documentElement.scrollWidth <= innerWidth`), 'outer Matter corners do not alter the root viewport or add horizontal scrolling')
    assert.equal(view(chrome).getBounds().y, 0)
    const rows = await chrome.executeJavaScript(`({ tabs: document.querySelector('.pn-top').getBoundingClientRect().height,
      navigation: document.querySelector('.desktop-navigation').getBoundingClientRect().height,
      divider: getComputedStyle(document.querySelector('.pn-top')).borderBottomWidth,
      tabWidth: document.querySelector('.desktop-tab').getBoundingClientRect().width,
      gutter: getComputedStyle(document.querySelector('.pn-body')).scrollbarGutter,
      bodyRadius: getComputedStyle(document.querySelector('.pn-body')).borderTopLeftRadius,
      card: (() => { const rect = document.querySelector('.desktop-navigation').getBoundingClientRect();
        return { left: rect.left, right: rect.right, width: innerWidth, bottom: rect.bottom }; })(),
      topRadius: getComputedStyle(document.querySelector('.desktop-navigation')).borderTopRightRadius,
      innerRadius: getComputedStyle(document.querySelector('.desktop-navigation')).borderTopLeftRadius,
      bottomRadius: getComputedStyle(document.querySelector('.desktop-navigation')).borderBottomRightRadius,
      toggle: getComputedStyle(document.querySelector('.pn-ib-close'), '::before').maskImage })`)
    assert.equal(rows.tabs, MATTER_TOP_INSET)
    assert.equal(rows.navigation, 48)
    assert.equal(rows.divider, '0px', 'no divider between tabs and content')
    assert.equal(rows.tabWidth, 184, 'tabs use the narrower desktop width')
    assert.equal(rows.gutter, 'auto', 'fixed navigation does not reserve a scrollbar gutter')
    assert.equal(rows.bodyRadius, '0px', 'navigation corners are clipped only once')
    assert.ok(Math.abs(rows.card.left) < 0.1 && Math.abs(rows.card.right - rows.card.width) < 0.1,
      `navigation fills the browser card: ${JSON.stringify(rows.card)}`)
    const shellBounds = view(chrome).getBounds()
    const pageBounds = view(fixturePage).getBounds()
    const panelBounds = rightFrame().getBounds()
    assert.equal(shellBounds.x, panelBounds.x + pageBounds.x, 'navigation and page share their left edge')
    assert.equal(shellBounds.width, pageBounds.width, 'navigation and page share their right edge')
    assert.equal(shellBounds.y + rows.card.bottom, panelBounds.y + pageBounds.y, 'navigation meets the page without a gap')
    assert.equal(rows.topRadius, '12px')
    assert.equal(rows.innerRadius, '0px', 'browser navigation meets Matter with a square inner corner')
    assert.equal(rows.bottomRadius, '0px')
    assert.ok(rows.toggle.includes('sidebar-toggle.svg'))
    assert.equal(view(chrome).getBounds().height, 84, 'no extra tab row beneath the titlebar')
    await verifyAddTabPosition()
    console.log(`PASS ${width}px: titlebar tabs, continuous navigation/page card, live resize and shared controls`)
    // Restore a useful starting width for the next size.
    await chrome.executeJavaScript('document.querySelector(".pn-ib-close").click()')
    await waitFor(state, (value) => !value.rightPanelOpen && value.panelMotion === 'closing', 'collapse motion')
    assert.equal(rightFrame().getVisible(), true, 'browser page remains visible during panel exit')
    await waitFor(state, (value) => !value.rightPanelOpen && !value.panelMotion, 'collapse')
    await waitFor(() => matter.executeJavaScript('getComputedStyle(document.querySelector(".desktop-workspace-content")).clipPath'),
      value => value === `inset(0px round ${FRAME_RADIUS}px)`, 'closed Matter restores all outer corners')
    assert.equal(matterFrame().getBounds().width, width - FRAME_EDGE)
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

  await chrome.executeJavaScript('document.querySelector(".pn-acts [aria-label=新建标签页]").click()')
  await waitFor(state, (value) => value.tabs.length === 2, 'new tab')
  await verifyAddTabPosition()
  const pairedTabs = (await state()).tabs.map(tab => tab.id)
  for (let count = 3; count <= 6; count++) {
    await command('new-tab')
    await waitFor(state, value => value.tabs.length === count, 'overflow tabs')
  }
  await verifyAddTabPosition()
  for (const tab of (await state()).tabs.filter(tab => !pairedTabs.includes(tab.id))) await command('close-tab', { tabId: tab.id })
  await waitFor(state, value => value.tabs.length === 2, 'restore tab pair')
  await verifyAddTabPosition()
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
    const matter = matterFrame().children.find(item => item.webContents).webContents
    await matter.executeJavaScript(`document.documentElement.dataset.theme = '${theme}'`)
    await waitFor(state, (value) => value.theme === theme, 'theme sync')
    await waitFor(() => chrome.executeJavaScript('document.documentElement.dataset.theme'), (value) => value === theme, 'shared theme')
    await waitFor(() => desktop.executeJavaScript('document.documentElement.dataset.theme'), value => value === theme, 'frame theme')
    await waitFor(() => desktop.executeJavaScript('document.getAnimations().filter(item => item.playState === "running").length'), value => value === 0, 'frame theme transition completes')
    assert.equal(await desktop.executeJavaScript('document.querySelector("#matter-home")'), null)
    fs.writeFileSync(path.join(temporary, `rail-top-${theme}.png`),
      (await desktop.capturePage({ x: 0, y: MATTER_TOP_INSET, width: FRAME_RAIL_WIDTH, height: 64 })).toPNG())
    await waitFor(() => chrome.executeJavaScript('document.getAnimations().filter((item) => item.playState === "running").length'), (value) => value === 0, 'theme transition completes')
    assert.equal(await chrome.executeJavaScript('getComputedStyle(document.querySelector(".desktop-chrome .panel")).backgroundColor'),
      'rgba(0, 0, 0, 0)', 'panel backing preserves the navigation corners in both themes')
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
    assert.equal(focused.height, 34)
    assert.equal(focused.ring, 'none', 'public inputs keep their shadow-free appearance')
    assert.equal(focused.border, 'rgb(58, 131, 247)', 'public field focus border')
    fs.writeFileSync(path.join(temporary, `chrome-${theme}-focused.png`), (await chrome.capturePage()).toPNG())
    await chrome.executeJavaScript('document.querySelector("#address").blur()')
  }
  console.log('PASS: no inline address icon, transparent tab label states, 2px close padding, equal tab insets, navigation, round buttons, live resize cleanup, light/dark; previews:', temporary)
  updateVersion = nextVersion
  updateResponse = 0
  await desktop.executeJavaScript('document.querySelector("#check-update").click()')
  await waitFor(() => desktop.executeJavaScript('minduckDesktopFrame.getState()'),
    value => value.update.phase === 'downloading' && value.update.percent === 37, 'in-app download progress')
  for (const theme of ['dark', 'light']) {
    await desktop.executeJavaScript(`document.documentElement.dataset.theme = '${theme}'`)
    const progress = await desktop.executeJavaScript(`(() => {
      const button = document.querySelector('#check-update'), value = document.querySelector('#update-progress');
      const bounds = button.getBoundingClientRect(), text = value.getBoundingClientRect();
      return { disabled: button.getAttribute('aria-disabled') === 'true', label: button.title, percent: value.textContent.trim(),
        offset: value.querySelector('.update-progress-value').getAttribute('stroke-dashoffset'),
        value: value.getAttribute('aria-valuenow'), shown: !value.hidden && getComputedStyle(value).display !== 'none',
        stroke: getComputedStyle(value.querySelector('.update-progress-value')).stroke,
        width: bounds.width, height: bounds.height, clipped: text.left < bounds.left || text.right > bounds.right,
        icon: getComputedStyle(button.querySelector('.update-icon')).display,
        available: getComputedStyle(button.querySelector('.available-icon')).display };
    })()`)
    assert.equal(progress.percent, '')
    assert.equal(progress.label, '正在下载 37%')
    assert.equal(progress.offset, '63')
    assert.equal(progress.value, '37')
    assert.equal(progress.stroke, theme === 'dark' ? 'rgb(34, 198, 88)' : 'rgb(22, 139, 60)')
    assert.ok(progress.disabled && progress.shown && !progress.clipped, JSON.stringify(progress))
    assert.equal(progress.width, 40); assert.equal(progress.height, 36)
    assert.equal(progress.icon, 'none'); assert.equal(progress.available, 'none')
    fs.writeFileSync(path.join(temporary, `update-progress-${theme}.png`),
      (await desktop.capturePage({ x: 0, y: window.getContentSize()[1] - 100, width: 80, height: 100 })).toPNG())
    await matter.executeJavaScript(`document.documentElement.dataset.theme = '${theme}'`)
    await waitFor(() => matter.executeJavaScript('document.querySelector("[data-desktop-update]")?.getAttribute("aria-label")'),
      value => value === '正在下载 37%', 'shared workspace download ring')
    const sharedProgress = await matter.executeJavaScript(`(() => {
      const button = document.querySelector('[data-desktop-update]'), progress = button.querySelector('[role="progressbar"]');
      button.dispatchEvent(new PointerEvent('pointerover', { bubbles: true }));
      const bounds = button.getBoundingClientRect(), ring = progress.getBoundingClientRect();
      return { text: progress.textContent.trim(), value: progress.getAttribute('aria-valuenow'),
        offset: progress.querySelector('.desktop-workspace-progress-value').getAttribute('stroke-dashoffset'),
        disabled: button.getAttribute('aria-disabled'), focusable: !button.disabled && button.tabIndex === 0,
        width: ring.width, clipped: ring.left < bounds.left || ring.right > bounds.right };
    })()`)
    assert.deepEqual(sharedProgress, { text: '', value: '37', offset: '63', disabled: 'true', focusable: true, width: 20, clipped: false })
    await waitFor(() => matter.executeJavaScript(`getComputedStyle(document.querySelector('.desktop-workspace-progress-value')).stroke`),
      value => value === (theme === 'dark' ? 'rgb(34, 198, 88)' : 'rgb(22, 139, 60)'), `${theme} green download progress`)
    await waitFor(() => matter.executeJavaScript('document.querySelector("[role=tooltip]")?.textContent'),
      value => value === '正在下载 37%', 'shared hover tooltip')
    await waitFor(() => matter.executeJavaScript(`(() => {
      const button = document.querySelector('[data-desktop-update]'), tooltip = document.querySelector('[role=tooltip]');
      return getComputedStyle(tooltip).visibility === 'visible'
        && button.getAnimations({ subtree: true }).every(item => item.playState !== 'running');
    })()`), Boolean, 'settled ring theme and visible tooltip')
    const contrast = await matter.executeJavaScript(`(() => {
      const luminance = value => {
        const rgb = value.match(/[\\d.]+/g).slice(0, 3).map(x => Number(x) / 255)
          .map(x => x <= .04045 ? x / 12.92 : ((x + .055) / 1.055) ** 2.4);
        return rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722;
      };
      const ink = luminance(getComputedStyle(document.querySelector('.desktop-workspace-progress-value')).stroke);
      const bg = luminance(getComputedStyle(document.querySelector('.desktop-workspace-rail')).backgroundColor);
      return (Math.max(ink, bg) + .05) / (Math.min(ink, bg) + .05);
    })()`)
    assert.ok(contrast >= 3, `${theme} update ring contrast: ${contrast}`)
    fs.writeFileSync(path.join(temporary, `workspace-update-${theme}.png`),
      (await matter.capturePage({ x: 0, y: view(matter).getBounds().height - 180, width: 220, height: 180 })).toPNG())
  }
  const actionsBeforeRepeat = updateLifecycle.slice()
  await matter.executeJavaScript('document.querySelector("[data-desktop-update]").click()')
  await desktop.executeJavaScript('document.querySelector("#check-update").click()')
  assert.deepEqual(updateLifecycle, actionsBeforeRepeat, 'busy ring ignores repeated clicks')
  fakeUpdater.emit('download-progress', { percent: 62 })
  await waitFor(() => matter.executeJavaScript('document.querySelector("[role=tooltip]")?.textContent'),
    value => value === '正在下载 62%', 'hovered tooltip updates without moving the pointer')
  assert.deepEqual(updateDownloads, [], 'in-app downloading never launches the browser')
  finishUpdateDownload()
  await waitFor(() => updateLifecycle.at(-1), value => value === 'install', 'verified install handoff')
  assert.deepEqual(updateLifecycle, ['download', 'verify', 'stop', 'install'])
  console.log('PASS in-app progress, disabled repeat clicks, light/dark sizing, native verification before child shutdown and install handoff')
  resizer.debugger.detach()
  chrome.debugger.detach()
}

probe().catch((error) => { console.error(error); process.exitCode = 1 }).finally(() => {
  server.close()
  app.once('will-quit', () => { if (process.exitCode) app.exit(process.exitCode) })
  app.quit()
  setTimeout(() => app.exit(process.exitCode || 0), 8_000).unref()
})
