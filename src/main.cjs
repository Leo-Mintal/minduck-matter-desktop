// Default fresh profiles to Chinese; Matter still honors its saved language preference.
require('electron').app.commandLine.appendSwitch('lang', 'zh-CN')

// The pet uses this executable in an isolated child, before the business shell boots.
if (process.argv.includes('--minduck-companion-host')) {
  require('./companion/host.cjs')
  return
}

const path = require('node:path')
const { pathToFileURL } = require('node:url')
const { app, BrowserWindow, dialog, ipcMain, Menu, net, protocol, shell, View, WebContentsView, safeStorage, nativeImage } = require('electron')
const { createBrowserDevice } = require('./browser-device/controller.cjs')
const { createBrowserSettings } = require('./browser-device/settings.cjs')
const { createController } = require('./local-exec/controller.cjs')
const { createSettings: createLocalExecSettings } = require('./local-exec/settings.cjs')
const { installBundledFrontend } = require('./bundledFrontend.cjs')
const { createCompanion } = require('./companion/index.cjs')
const { activateMatterWindow } = require('./companion/matter-actions.cjs')
const { createMatterTaskBridge } = require('./companion/task-bridge.cjs')
const { handleMatterQa } = require('./companion/qa-actions.cjs')
const {
  MATTER_BROWSER_EXTENSION_NAME,
  getAgentBrowserSession,
  getMatterBrowserExtension,
  loadBuiltInExtensions,
} = require('./agentBrowser.cjs')
const { AgentBrowserCompatibility } = require('./agentBrowserCompatibility.cjs')
const { ElectronBrowserHost } = require('./electronBrowserHost.cjs')
const { browserStartURL, isBrowserStartURL } = require('./browserStartPage.cjs')
const { DEFAULT_BROWSER_PREFERENCES, loadBrowserPreferences, saveBrowserPreferences } = require('./browserPreferences.cjs')
const { browserNavigationDisposition, browserURLForInput } = require('./agentBrowserPolicy.cjs')
const { ExtensionApiBridge } = require('./extensionApiBridge.cjs')
const { extensionPopupURL, isExtensionPage } = require('./extensionPage.cjs')
const {
  MATTER_TOP_INSET,
  matterContentBounds,
  rightPanelLayout,
} = require('./rightPanelLayout.cjs')
const { PANEL_TRANSITION_DURATION, interpolatePanelFrame, panelTransitionFrame } = require('./panelMotion.cjs')
const { parseChromeMetrics } = require('./chromeMetrics.cjs')
const { developmentUserDataPath } = require('./runtimePaths.cjs')
const {
  defaultDesktopSettings,
  loadDesktopSettings,
  saveDesktopSettings,
} = require('./desktopSettings.cjs')
const {
  DEFAULT_MATTER_ORIGIN,
  isMatterWebURL,
  normalizeMatterOrigin,
  resolveMatterOrigin,
} = require('./matterService.cjs')
const {
  FULL_DISK_ACCESS_SETTINGS_URL,
} = require('./fullDiskAccess.cjs')
const { checkForUpdate } = require('./updateCheck.cjs')

const MATTER_UNAVAILABLE_PAGE = path.join(__dirname, 'matter-unavailable.html')
const MATTER_UNAVAILABLE_URL = pathToFileURL(MATTER_UNAVAILABLE_PAGE).toString()
const MATTER_SERVICE_SETTINGS_PAGE = path.join(__dirname, 'matter-service-settings.html')

// A development run must not share extension workers or browser storage with an installed build.
if (!app.isPackaged) {
  app.setPath('userData', developmentUserDataPath(app.getPath('appData'), process.env.MINDUCK_USER_DATA_DIR))
}

let mainWindow
let shellView
let windowDragView
let panelResizeView
let matterFrameView
let rightPanelView
let shellReady = false
let browserHost
let matterTab
let extensionApiBridge
let matterPresenceTimer
let matterTheme = 'dark'
let matterOrigin = DEFAULT_MATTER_ORIGIN
let matterServiceSettingsWindow
let companion
let matterTasks
let matterTaskOutput = { active: false }
let desktopSettings
let panelResizeState
let panelMotion
let panelMotionTimer
let renderedPanelOpen = false
let chromeMetrics
let browserPreferences
let browserSettingsWindow
let localExec
let localExecSettings
let browserDevice
let browserDeviceSettings
let updateCheckInFlight

function nativeCanvasColor(theme = matterTheme) {
  if (chromeMetrics?.theme === theme) return chromeMetrics.canvas
  return theme === 'light' ? '#f7f7f8' : '#030303'
}

function nativeSettingsSurfaceColor(theme = matterTheme) {
  if (chromeMetrics?.theme === theme) return chromeMetrics.surface
  return theme === 'light' ? '#ffffff' : '#161719'
}

function applyNativeTheme() {
  const canvasColor = nativeCanvasColor()
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.setBackgroundColor(canvasColor)
    mainWindow.contentView.setBackgroundColor(canvasColor)
  }
  if (matterFrameView) matterFrameView.setBackgroundColor(canvasColor)
  if (rightPanelView) rightPanelView.setBackgroundColor(chromeMetrics?.theme === matterTheme ? chromeMetrics.divider : canvasColor)
  browserHost?.setBackgroundColor(canvasColor)
  browserHost?.setStartPageTheme(matterTheme)
}

function setViewVisible(view, visible) {
  if (view && view.getVisible() !== visible) view.setVisible(visible)
}

function setViewBounds(view, bounds) {
  const previous = view.getBounds()
  if (['x', 'y', 'width', 'height'].some((key) => previous[key] !== bounds[key])) view.setBounds(bounds)
}

function matterViewBounds(matterBounds) {
  return localBounds(
    matterContentBounds(matterBounds, process.platform === 'darwin' ? MATTER_TOP_INSET : 0),
    matterBounds,
  )
}

function resizerState() {
  return { theme: matterTheme, capturing: Boolean(panelResizeState) }
}

function publishResizerState() {
  if (panelResizeView && !panelResizeView.webContents.isDestroyed()) {
    panelResizeView.webContents.send('panel-resizer:state', resizerState())
  }
}

const extensionCompatibility = new AgentBrowserCompatibility({
  createTab: (url, options) => browserHost?.createBrowserTab(url, options),
  closeTab: (tabId) => browserHost?.closeTab(tabId),
  getBrowserTabs: () => browserHost?.browserTabs() ?? [],
  getMainWindow: () => mainWindow,
  getActiveTabId: () => browserHost?.getActiveTabId(),
  selectTab: (tabId) => browserHost?.selectTab(tabId),
  notifyGroupChanged: (tab) => {
    browserDevice?.notifyTabUpdated(tab, { groupId: tab.groupId })
    return extensionApiBridge?.notifyTabGroupChanged(tab)
  },
  notifyTabUpdated: (tab, changeInfo) => {
    browserDevice?.notifyTabUpdated(tab, changeInfo)
    return extensionApiBridge?.notifyTabUpdated(tab, changeInfo)
  },
})

extensionApiBridge = new ExtensionApiBridge({
  getSession: getAgentBrowserSession,
  extensionName: MATTER_BROWSER_EXTENSION_NAME,
  handleRequest: (method, params) => extensionCompatibility.request(method, params),
})

function matterDisposition(value) {
  let target
  try {
    target = new URL(value)
  } catch {
    return 'blocked'
  }

  if (target.href === MATTER_UNAVAILABLE_URL || target.href.startsWith(MATTER_UNAVAILABLE_URL + '?')) return 'navigate'

  if (target.origin === matterOrigin) {
    if (target.pathname.startsWith('/api/') || target.pathname.startsWith('/media/')) {
      return 'download'
    }
    return 'navigate'
  }

  if (target.protocol === 'http:' || target.protocol === 'https:' || target.protocol === 'mailto:') {
    return 'external'
  }

  return 'blocked'
}

async function openExternal(url) {
  try {
    await shell.openExternal(url)
    return true
  } catch (error) {
    console.error('Failed to open external URL:', error)
    return false
  }
}

function shellState() {
  const browserState = browserHost?.shellState() ?? {
    activeTabId: undefined,
    rightPanelOpen: false,
    browserControls: { canGoBack: false, canGoForward: false, canReload: false, isLoading: false, externalURL: undefined },
    tabs: [],
  }
  return {
    ...browserState,
    matterBrowserAvailable: Boolean(getMatterBrowserExtension()),
    panelMotion: panelMotion?.kind,
    theme: matterTheme,
  }
}

function publishShellState() {
  if (!shellReady || !shellView || shellView.webContents.isDestroyed()) return
  shellView.webContents.send('browser-shell:state', shellState())
}

function panelLayouts() {
  const [width, height] = mainWindow.getContentSize()
  const panelWidth = panelResizeState?.panelWidth ?? currentDesktopSettings().rightPanelWidth
  return {
    width,
    open: rightPanelLayout(width, height, true, panelWidth, chromeMetrics),
    closed: rightPanelLayout(width, height, false, panelWidth, chromeMetrics),
  }
}

function panelMotionProgress(motion, now = Date.now()) {
  return Math.min(1, Math.max(0, (now - motion.startedAt) / PANEL_TRANSITION_DURATION))
}

function motionBrowserLayout(frame, openLayout) {
  return {
    panel: frame.panel,
    browser: {
      x: frame.panel.x + 1,
      y: openLayout.browser.y,
      width: frame.panel.width - 1,
      height: frame.panel.height - openLayout.browser.y,
    },
  }
}

function applyPanelMotionFrame() {
  if (!panelMotion || !mainWindow || mainWindow.isDestroyed()) return
  const frame = interpolatePanelFrame(panelMotion.from, panelMotion.target, panelMotionProgress(panelMotion))
  if (windowDragView) setViewBounds(windowDragView, frame.dragRegion)
  if (panelResizeView) setViewVisible(panelResizeView, false)
  if (matterFrameView) {
    setViewBounds(matterFrameView, frame.matter)
    setViewVisible(matterFrameView, true)
  }
  if (rightPanelView) {
    setViewBounds(rightPanelView, frame.panel)
    setViewVisible(rightPanelView, true)
  }
  if (shellView) {
    setViewBounds(shellView, frame.shell)
    setViewVisible(shellView, true)
  }
  if (matterTab) {
    setViewBounds(matterTab.view, matterViewBounds(frame.matter))
    setViewVisible(matterTab.view, matterTab.hasPainted !== false)
  }
  browserHost?.layout(motionBrowserLayout(frame, panelMotion.openLayout), localBounds, setViewVisible)
}

function stopPanelMotion({ applyFinal = true } = {}) {
  if (!panelMotion) return
  clearTimeout(panelMotionTimer)
  panelMotionTimer = undefined
  const targetOpen = panelMotion.targetOpen
  panelMotion = undefined
  renderedPanelOpen = targetOpen
  if (applyFinal) layoutViews()
}

function schedulePanelMotionFrame() {
  clearTimeout(panelMotionTimer)
  panelMotionTimer = setTimeout(() => {
    if (!panelMotion) return
    applyPanelMotionFrame()
    if (panelMotionProgress(panelMotion) < 1) {
      schedulePanelMotionFrame()
      return
    }
    stopPanelMotion()
    publishShellState()
  }, 16)
}

function startPanelMotion(targetOpen) {
  if (!mainWindow || mainWindow.isDestroyed() || panelResizeState) return false
  const { width, open, closed } = panelLayouts()
  const kind = targetOpen ? 'opening' : 'closing'
  const from = panelMotion
    ? interpolatePanelFrame(panelMotion.from, panelMotion.target, panelMotionProgress(panelMotion))
    : panelTransitionFrame({ closedLayout: closed, kind, openLayout: open, progress: 0, windowWidth: width })
  const target = panelTransitionFrame({ closedLayout: closed, kind, openLayout: open, progress: 1, windowWidth: width })
  clearTimeout(panelMotionTimer)
  panelMotion = { from, kind, openLayout: open, startedAt: Date.now(), target, targetOpen }
  applyPanelMotionFrame()
  schedulePanelMotionFrame()
  return true
}

function requestPanelLayout() {
  if (!mainWindow || mainWindow.isDestroyed()) return
  const targetOpen = browserHost?.isPanelOpen() ?? false
  if (panelResizeState) {
    stopPanelMotion({ applyFinal: false })
    renderedPanelOpen = targetOpen
    layoutViews()
    return
  }
  if (panelMotion?.targetOpen === targetOpen) {
    applyPanelMotionFrame()
    return
  }
  if (targetOpen !== renderedPanelOpen && startPanelMotion(targetOpen)) return
  renderedPanelOpen = targetOpen
  layoutViews()
}

function layoutViews() {
  if (!mainWindow || mainWindow.isDestroyed()) return
  if (panelMotion) {
    applyPanelMotionFrame()
    return
  }
  if (panelResizeState && !browserHost?.isPanelOpen()) {
    finishPanelResize()
    return
  }
  const [width, height] = mainWindow.getContentSize()

  const layout = rightPanelLayout(
    width,
    height,
    browserHost?.isPanelOpen() ?? false,
    panelResizeState?.panelWidth ?? currentDesktopSettings().rightPanelWidth,
    chromeMetrics,
  )
  if (windowDragView) setViewBounds(windowDragView, layout.dragRegion)
  if (panelResizeView) {
    if (panelResizeState) {
      setViewBounds(panelResizeView, { x: 0, y: 0, width, height })
      setViewVisible(panelResizeView, true)
    } else if (layout.resizer) {
      setViewBounds(panelResizeView, layout.resizer)
      setViewVisible(panelResizeView, true)
    } else {
      setViewVisible(panelResizeView, false)
    }
  }
  if (matterFrameView) {
    setViewBounds(matterFrameView, layout.matter)
    setViewVisible(matterFrameView, true)
  }
  if (rightPanelView) {
    if (layout.panel) {
      setViewBounds(rightPanelView, layout.panel)
      setViewVisible(rightPanelView, true)
    } else {
      setViewVisible(rightPanelView, false)
    }
  }
  if (shellView) setViewBounds(shellView, layout.shell)
  if (matterTab) {
    setViewBounds(matterTab.view, matterViewBounds(layout.matter))
    setViewVisible(matterTab.view, matterTab.hasPainted !== false)
  }
  browserHost?.layout(layout, localBounds, setViewVisible)
}

function localBounds(bounds, parentBounds) {
  if (!bounds || !parentBounds) return bounds
  return {
    x: bounds.x - parentBounds.x,
    y: bounds.y - parentBounds.y,
    width: bounds.width,
    height: bounds.height,
  }
}

async function updateMatterPresence() {
  const { webContents } = matterTab?.view ?? {}
  if (!webContents || webContents.isDestroyed() || !isMatterWebURL(webContents.getURL(), matterOrigin)) return

  const deviceId = await browserDevice?.presenceDeviceId() || ''
  const expression = `(() => {
    const root = document.documentElement
    if (!root) return
    const deviceId = ${JSON.stringify(deviceId)}
    if (deviceId) root.dataset.matterDevice = deviceId
    else delete root.dataset.matterDevice
  })()`
  await webContents.executeJavaScript(expression, true).catch((error) => {
    console.error('Failed to synchronize Matter Browser presence:', error)
  })
  const nextTheme = await webContents.executeJavaScript(`(() => {
    const theme = document.documentElement?.dataset?.theme
    if (theme === 'light' || theme === 'dark') return theme
    try {
      return localStorage.getItem('matter.theme') === 'light' ? 'light' : 'dark'
    } catch {
      return 'dark'
    }
  })()`, true).catch(() => 'dark')
  if ((nextTheme === 'light' || nextTheme === 'dark') && nextTheme !== matterTheme) {
    matterTheme = nextTheme
    applyNativeTheme()
    publishShellState()
    publishResizerState()
  }
}

function configureMatterTab(tab) {
  const { webContents } = tab.view
  // One listener owned by this session; right-side browser tabs use another session.
  webContents.session.webRequest.onBeforeSendHeaders((details, callback) => {
    // Main-process net.fetch forwarding has no webContentsId.
    const ownRequest = details.webContentsId == null || details.webContentsId === webContents.id || details.webContentsId === -1
    const headers = localExec?.headers(details.requestHeaders, ownRequest ? details.url : 'https://invalid.local/')
    callback({ requestHeaders: headers || details.requestHeaders })
  })
  matterTasks = createMatterTaskBridge({ contents: webContents, origin: matterOrigin, onOutput: (output) => {
    matterTaskOutput = output
    companion?.setTaskOutput(output)
  } })
  let initialRequestPending = true
  const showMatterUnavailable = () => {
    if (webContents.isDestroyed() || webContents.getURL().startsWith(MATTER_UNAVAILABLE_URL)) return

    tab.hasPainted = true
    layoutViews()
    tab.url = MATTER_UNAVAILABLE_URL
    void webContents.loadFile(MATTER_UNAVAILABLE_PAGE, { query: { origin: matterOrigin } }).catch((error) => {
      console.error('Failed to show Matter unavailable page:', error)
    })
  }
  const guardNavigation = (details, legacyURL) => {
    const url = typeof details?.url === 'string' ? details.url : legacyURL
    const disposition = matterDisposition(url)
    if (disposition === 'navigate') return
    details.preventDefault()
    if (disposition === 'external') openExternal(url)
    // Same-window /api and /media links download instead of replacing Matter; subframes stay blocked.
    if (disposition === 'download' && details.isMainFrame !== false) webContents.downloadURL(url)
  }

  webContents.on('will-navigate', guardNavigation)
  webContents.on('will-redirect', guardNavigation)
  webContents.setWindowOpenHandler(({ url }) => {
    const disposition = matterDisposition(url)
    if (disposition === 'download') webContents.downloadURL(url)
    if (disposition === 'external') openExternal(url)
    if (disposition === 'navigate') void webContents.loadURL(url)
    return { action: 'deny' }
  })
  webContents.on('did-finish-load', () => {
    tab.hasPainted = true
    if (isMatterWebURL(webContents.getURL(), matterOrigin)) {
      initialRequestPending = false
      layoutViews()
      void updateMatterPresence()
    }
  })
  webContents.on('did-fail-load', (_event, errorCode, _errorDescription, url, isMainFrame) => {
    if (!isMainFrame || errorCode === -3 || !isMatterWebURL(url, matterOrigin)) return
    tab.hasPainted = true
    initialRequestPending = false
    showMatterUnavailable()
  })
  setTimeout(() => {
    if (initialRequestPending) showMatterUnavailable()
  }, 8_000)
}

function selectTab(tabId) {
  browserHost?.selectTab(tabId)
}

function createMatterTab() {
  if (matterTab) return matterTab

  const view = new WebContentsView({
    webPreferences: {
      // Task events and auth changes must continue while Matter is minimized.
      backgroundThrottling: false,
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      webviewTag: false,
    },
  })
  view.setBackgroundColor(nativeCanvasColor())
  const targetURL = matterOrigin + '/'
  const tab = matterTab = {
    id: 'matter',
    kind: 'matter',
    view,
    title: 'Matter',
    url: targetURL,
    hasPainted: false,
  }
  matterFrameView.addChildView(view)
  configureMatterTab(tab)
  void view.webContents.loadURL(targetURL).catch((error) => console.error('Failed to load Matter:', error))
  return tab
}

function createBrowserTab(url, { active = true } = {}) {
  return browserHost?.createBrowserTab(url, { active })
}

function createMatterBrowserExtensionTab() {
  const extension = getMatterBrowserExtension()
  const popupURL = extensionPopupURL(extension)
  return browserHost?.createExtensionTab(popupURL, extension)
}

function createLocalSandboxTab() {
  return browserHost?.createLocalSandboxTab()
}

function closeTab(tabId) {
  browserHost?.closeTab(tabId)
}

function openAddress(value) {
  browserHost?.openAddress(value, (input) => browserURLForInput(input, currentBrowserPreferences().browserSearchEngine))
}

function currentBrowserPreferences() {
  if (browserPreferences) return browserPreferences
  try { browserPreferences = loadBrowserPreferences(app.getPath('userData')) }
  catch (error) {
    console.error('Failed to read browser preferences:', error)
    browserPreferences = { ...DEFAULT_BROWSER_PREFERENCES }
  }
  return browserPreferences
}

function handleBrowserShortcut(event, input) {
  if (input.type !== 'keyDown' || (!input.meta && !input.control) || input.alt) return
  const key = input.key.toLowerCase()
  if (!['l', 't', 'w'].includes(key)) return
  event.preventDefault()
  if (key === 't') createBrowserTab()
  if (key === 'w') closeTab(browserHost?.getActiveTabId())
  if (key === 'l' && shellView && !shellView.webContents.isDestroyed()) {
    shellView.webContents.focus()
    shellView.webContents.send('browser-shell:focus-address')
  }
}

function isBrowserSettingsSender(contents) {
  return Boolean(browserSettingsWindow && !browserSettingsWindow.isDestroyed()
    && browserSettingsWindow.webContents === contents)
}

function openBrowserSettings() {
  if (browserSettingsWindow && !browserSettingsWindow.isDestroyed()) { browserSettingsWindow.focus(); return }
  browserSettingsWindow = new BrowserWindow({
    width: 560, height: 500, minWidth: 375, minHeight: 460, parent: mainWindow, modal: true,
    show: false, minimizable: false, maximizable: false, fullscreenable: false,
    title: '浏览器设置', backgroundColor: nativeSettingsSurfaceColor(),
    webPreferences: {
      preload: path.join(__dirname, 'browser-settings-preload.cjs'), contextIsolation: true,
      sandbox: true, nodeIntegration: false, webSecurity: true, allowRunningInsecureContent: false, webviewTag: false,
    },
  })
  const window = browserSettingsWindow
  window.setMenuBarVisibility(false)
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', (event) => event.preventDefault())
  window.webContents.on('will-redirect', (event) => event.preventDefault())
  window.once('ready-to-show', () => { if (!window.isDestroyed()) window.show() })
  window.on('closed', () => { browserSettingsWindow = undefined })
  void window.loadFile(path.join(app.getAppPath(), 'web-dist', 'desktop-shell', 'index.html'), {
    query: { surface: 'settings', theme: matterTheme },
  }).catch((error) => console.error('Failed to load browser settings:', error))
}

function saveBrowserSettings(value) {
  try {
    browserPreferences = saveBrowserPreferences(app.getPath('userData'), value)
    for (const tab of browserHost?.browserTabs() ?? []) {
      if (isBrowserStartURL(tab.pendingURL || tab.url)) {
        browserHost.loadTab(tab, browserStartURL({ ...browserPreferences, browserStartPage: 'local' }, matterTheme))
      }
    }
    return { ok: true }
  } catch (error) {
    console.error('Failed to save browser settings:', error)
    return { ok: false, error: '设置保存失败，请重试' }
  }
}

function navigateActiveBrowserTab(direction) {
  browserHost?.navigateActive(direction)
}

function reloadActiveBrowserTab() {
  browserHost?.reloadActive()
}

function openActiveBrowserExternally() {
  browserHost?.openActiveExternal()
}

function isShellSender(webContents) {
  return Boolean(shellView && !shellView.webContents.isDestroyed() && shellView.webContents === webContents)
}

function isPanelResizeSender(webContents) {
  return Boolean(panelResizeView && !panelResizeView.webContents.isDestroyed() && panelResizeView.webContents === webContents)
}

function bringPanelResizerToFront() {
  if (!mainWindow || mainWindow.isDestroyed() || !panelResizeView || panelResizeView.webContents.isDestroyed()) return
  mainWindow.contentView.removeChildView(panelResizeView)
  mainWindow.contentView.addChildView(panelResizeView)
}

function startPanelResize() {
  if (panelResizeState || !mainWindow || mainWindow.isDestroyed()) return
  stopPanelMotion({ applyFinal: false })
  const [width, height] = mainWindow.getContentSize()
  const activeTab = browserHost?.getActiveTab()
  if (!activeTab || !browserHost.isPanelOpen()) return
  const layout = rightPanelLayout(width, height, true, currentDesktopSettings().rightPanelWidth, chromeMetrics)
  if (!layout.panel) return
  panelResizeState = {
    startPanelWidth: layout.panel.width,
    panelWidth: layout.panel.width,
  }
  publishResizerState()
  layoutViews()
}

function resizePanel(deltaX) {
  if (!panelResizeState || !mainWindow || mainWindow.isDestroyed()) return
  if (typeof deltaX !== 'number' || !Number.isFinite(deltaX) || Math.abs(deltaX) > 20_000) return
  const [width, height] = mainWindow.getContentSize()
  const layout = rightPanelLayout(width, height, true, panelResizeState.startPanelWidth - deltaX, chromeMetrics)
  panelResizeState.panelWidth = layout.panel.width
  layoutViews()
}

function finishPanelResize() {
  if (!panelResizeState) return
  const width = panelResizeState.panelWidth
  panelResizeState = undefined
  publishResizerState()
  if (currentDesktopSettings().rightPanelWidth !== width) {
    const next = { ...currentDesktopSettings(), rightPanelWidth: width }
    try {
      saveDesktopSettings(app.getPath('userData'), next)
      desktopSettings = next
    } catch (error) {
      console.error('Failed to save right panel width:', error)
    }
  }
  layoutViews()
}

function currentDesktopSettings() {
  if (desktopSettings) return desktopSettings
  try {
    desktopSettings = loadDesktopSettings(app.getPath('userData'))
  } catch (error) {
    console.error('Failed to read desktop settings:', error)
    desktopSettings = defaultDesktopSettings()
  }
  return desktopSettings
}

function loadMatterOrigin() {
  const configuredOrigin = currentDesktopSettings().matterOrigin
  // Older builds persisted the local development default. Treat that value as
  // unset so an installed app uses the current packaged default instead.
  const settingsOrigin = configuredOrigin === 'http://localhost:3001'
    || configuredOrigin === 'http://127.0.0.1:3001'
    ? null
    : configuredOrigin
  const environmentOrigin = process.env.MINDUCK_MATTER_ORIGIN
  try {
    return resolveMatterOrigin(settingsOrigin, environmentOrigin)
  } catch (error) {
    console.error('Failed to resolve Matter service address:', error)
    return resolveMatterOrigin(settingsOrigin, null)
  }
}

function matterServiceSettingsState() {
  let environmentOrigin = null
  let environmentError = null
  if (process.env.MINDUCK_MATTER_ORIGIN) {
    try {
      environmentOrigin = normalizeMatterOrigin(process.env.MINDUCK_MATTER_ORIGIN)
    } catch (error) {
      environmentError = error instanceof Error ? error.message : String(error)
    }
  }
  return {
    defaultOrigin: DEFAULT_MATTER_ORIGIN,
    configuredOrigin: currentDesktopSettings().matterOrigin,
    effectiveOrigin: matterOrigin,
    environmentOrigin,
    environmentError,
  }
}

function saveMatterOrigin(origin) {
  const next = {
    ...currentDesktopSettings(),
    matterOrigin: origin === null ? null : normalizeMatterOrigin(origin),
  }
  saveDesktopSettings(app.getPath('userData'), next)
  desktopSettings = next
  return matterServiceSettingsState()
}

function restartApplication() {
  app.relaunch()
  app.exit(0)
}

function isMatterServiceSettingsSender(webContents) {
  return Boolean(
    matterServiceSettingsWindow
    && !matterServiceSettingsWindow.isDestroyed()
    && matterServiceSettingsWindow.webContents === webContents,
  )
}

function openMatterServiceSettings() {
  if (matterServiceSettingsWindow && !matterServiceSettingsWindow.isDestroyed()) {
    matterServiceSettingsWindow.focus()
    return
  }

  matterServiceSettingsWindow = new BrowserWindow({
    width: 520,
    height: 420,
    minWidth: 460,
    minHeight: 380,
    parent: mainWindow && !mainWindow.isDestroyed() ? mainWindow : undefined,
    modal: Boolean(mainWindow && !mainWindow.isDestroyed()),
    show: false,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    title: 'Matter 服务地址',
    backgroundColor: nativeSettingsSurfaceColor(),
    webPreferences: {
      preload: path.join(__dirname, 'matter-service-settings-preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      webviewTag: false,
    },
  })
  matterServiceSettingsWindow.setMenuBarVisibility(false)
  matterServiceSettingsWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  matterServiceSettingsWindow.once('ready-to-show', () => matterServiceSettingsWindow?.show())
  matterServiceSettingsWindow.on('closed', () => {
    matterServiceSettingsWindow = undefined
  })
  void matterServiceSettingsWindow.loadFile(MATTER_SERVICE_SETTINGS_PAGE).catch((error) => {
    console.error('Failed to open Matter service settings:', error)
  })
}

async function useDefaultMatterService() {
  if (process.env.MINDUCK_MATTER_ORIGIN) {
    await dialog.showMessageBox(mainWindow, {
      type: 'info',
      title: 'Matter 服务由环境变量控制',
      message: '当前地址由 MINDUCK_MATTER_ORIGIN 覆盖。',
      detail: '请移除该环境变量后重新启动应用，才能恢复默认线上服务。',
      buttons: ['知道了'],
      noLink: true,
    })
    return
  }
  if (currentDesktopSettings().matterOrigin === null) return
  const response = await dialog.showMessageBox(mainWindow, {
    type: 'question',
    title: '恢复默认 Matter 服务',
    message: '将服务地址恢复为 ' + DEFAULT_MATTER_ORIGIN + '？',
    detail: '应用会立即重新启动。',
    buttons: ['恢复并重启', '取消'],
    defaultId: 0,
    cancelId: 1,
    noLink: true,
  })
  if (response.response !== 0) return
  saveMatterOrigin(null)
  restartApplication()
}

async function openFullDiskAccessSettings() {
  if (process.platform !== 'darwin') return false
  try {
    await shell.openExternal(FULL_DISK_ACCESS_SETTINGS_URL)
    return true
  } catch (error) {
    console.error('Failed to open Full Disk Access settings:', error)
    return false
  }
}

function showUpdateDialog(options) {
  return mainWindow && !mainWindow.isDestroyed()
    ? dialog.showMessageBox(mainWindow, options)
    : dialog.showMessageBox(options)
}

async function checkForDesktopUpdate() {
  if (updateCheckInFlight) return updateCheckInFlight

  updateCheckInFlight = (async () => {
    try {
      const result = await checkForUpdate({ currentVersion: app.getVersion(), fetchImpl: net.fetch.bind(net) })
      if (!result.available) {
        await showUpdateDialog({
          type: 'info',
          title: '检查更新',
          message: '当前已是最新版本',
          detail: `当前版本 ${app.getVersion()}`,
          buttons: ['知道了'],
          noLink: true,
        })
        return
      }

      if (!await openExternal(result.downloadURL)) throw new Error('无法打开下载链接')
      await showUpdateDialog({
        type: 'info',
        title: '发现新版本',
        message: `发现新版本 ${result.version}`,
        detail: '已在默认浏览器中打开下载页面。下载完成后，将应用拖入“应用程序”覆盖旧版本即可。',
        buttons: ['知道了'],
        noLink: true,
      })
    } catch (error) {
      console.error('Failed to check for desktop update:', error)
      await showUpdateDialog({
        type: 'error',
        title: '检查更新失败',
        message: '暂时无法检查更新，请确认网络后重试。',
        buttons: ['知道了'],
        noLink: true,
      })
    } finally {
      updateCheckInFlight = undefined
    }
  })()

  return updateCheckInFlight
}

function configureIPC() {
  ipcMain.handle('browser-settings:get', (event) => isBrowserSettingsSender(event.sender)
    ? { ...currentBrowserPreferences(), theme: matterTheme } : null)
  ipcMain.handle('browser-settings:save', (event, value) => isBrowserSettingsSender(event.sender)
    ? saveBrowserSettings(value) : { ok: false })
  ipcMain.handle('browser-settings:clear-cache', async (event) => {
    if (!isBrowserSettingsSender(event.sender)) return { ok: false }
    try { await getAgentBrowserSession().clearCache(); return { ok: true } }
    catch (error) { console.error('Failed to clear browser cache:', error); return { ok: false, error: '缓存清除失败，请重试' } }
  })
  ipcMain.on('browser-settings:close', (event) => {
    if (isBrowserSettingsSender(event.sender)) browserSettingsWindow.close()
  })
  ipcMain.handle('browser-shell:get-state', (event) => (isShellSender(event.sender) ? shellState() : null))
  ipcMain.on('browser-shell:metrics', (event, value) => {
    if (!isShellSender(event.sender)) return
    const next = parseChromeMetrics(value)
    if (!next || next.theme !== matterTheme) return
    // Closed chrome reports tokens but retains the last measured open height.
    next.toolbarHeight ||= chromeMetrics?.toolbarHeight || 0
    if (JSON.stringify(next) === JSON.stringify(chromeMetrics)) return
    const colorsChanged = ['canvas', 'surface', 'divider'].some((key) => next[key] !== chromeMetrics?.[key])
    chromeMetrics = next
    if (colorsChanged) applyNativeTheme()
    layoutViews()
  })
  ipcMain.on('browser-shell:command', (event, command) => {
    if (!isShellSender(event.sender) || !command || typeof command !== 'object') return
    if (command.type === 'select-tab' && typeof command.tabId === 'string') selectTab(command.tabId)
    if (command.type === 'close-tab' && typeof command.tabId === 'string') closeTab(command.tabId)
    if (command.type === 'new-tab') createBrowserTab()
    if (command.type === 'open-panel') browserHost?.openPanel()
    if (command.type === 'close-panel') {
      finishPanelResize()
      browserHost?.closePanel()
    }
    if (command.type === 'open-matter-browser-extension') createMatterBrowserExtensionTab()
    if (command.type === 'open-browser-settings') openBrowserSettings()
    if (command.type === 'open-local-sandbox') createLocalSandboxTab()
    if (command.type === 'go-back') navigateActiveBrowserTab('back')
    if (command.type === 'go-forward') navigateActiveBrowserTab('forward')
    if (command.type === 'reload-or-stop') reloadActiveBrowserTab()
    if (command.type === 'open-external') openActiveBrowserExternally()
    if (command.type === 'open-address' && typeof command.value === 'string' && command.value.length <= 4096) {
      openAddress(command.value)
    }
  })
  ipcMain.on('panel-resizer:start', (event) => {
    if (isPanelResizeSender(event.sender)) startPanelResize()
  })
  ipcMain.handle('panel-resizer:get-state', (event) => (isPanelResizeSender(event.sender) ? resizerState() : null))
  ipcMain.on('panel-resizer:resize', (event, deltaX) => {
    if (isPanelResizeSender(event.sender)) resizePanel(deltaX)
  })
  ipcMain.on('panel-resizer:finish', (event) => {
    if (isPanelResizeSender(event.sender)) finishPanelResize()
  })
  ipcMain.handle('matter-service-settings:get', (event) => {
    if (!isMatterServiceSettingsSender(event.sender)) return null
    return matterServiceSettingsState()
  })
  ipcMain.handle('matter-service-settings:save', (event, request) => {
    if (!isMatterServiceSettingsSender(event.sender)) return null
    return saveMatterOrigin(request?.origin)
  })
  ipcMain.handle('matter-service-settings:reset', (event) => {
    if (!isMatterServiceSettingsSender(event.sender)) return null
    return saveMatterOrigin(null)
  })
  ipcMain.on('matter-service-settings:restart', (event) => {
    if (isMatterServiceSettingsSender(event.sender)) restartApplication()
  })
  ipcMain.on('matter-service-settings:close', (event) => {
    if (isMatterServiceSettingsSender(event.sender)) matterServiceSettingsWindow.close()
  })
}

function createMenu() {
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: 'Minduck Matter',
        submenu: [
          { role: 'about' },
          { label: '检查更新…', click: () => void checkForDesktopUpdate() },
          { type: 'separator' },
          { label: '配置 Matter 服务地址...', click: openMatterServiceSettings },
          { label: '使用默认 Matter 服务', click: () => void useDefaultMatterService() },
          { label: '桌宠设置…', accelerator: 'CmdOrCtrl+,', click: () => companion?.openSettings() },
          { label: '本机执行设置…', click: () => localExecSettings?.open() },
          { label: '内置浏览器设置…', click: () => browserDeviceSettings?.open() },
          { label: '显示桌宠', click: () => void companion?.show().catch(console.error) },
          { label: '隐藏桌宠', click: () => void companion?.hide().catch(console.error) },
          ...(process.platform === 'darwin'
            ? [{ label: '打开完全磁盘访问设置...', click: () => void openFullDiskAccessSettings() }, { type: 'separator' }]
            : []),
          { role: 'quit' },
        ],
      },
      { role: 'editMenu' },
      {
        label: 'View',
        submenu: [{ role: 'reload' }, { role: 'forceReload' }, { type: 'separator' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { type: 'separator' }, { role: 'togglefullscreen' }],
      },
      { role: 'windowMenu' },
    ]),
  )
}

function createWindow() {
  shellReady = false
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 600,
    show: false,
    title: 'Minduck Matter',
    // Keep the native window controls without reserving a separate title-bar band.
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    backgroundColor: nativeCanvasColor(),
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      webviewTag: false,
    },
  })

  shellView = new WebContentsView({
    webPreferences: {
      preload: path.join(__dirname, 'shell-preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      webviewTag: false,
    },
  })
  windowDragView = new WebContentsView({
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      webviewTag: false,
    },
  })
  panelResizeView = new WebContentsView({
    webPreferences: {
      preload: path.join(__dirname, 'panel-resizer-preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      webviewTag: false,
    },
  })
  matterFrameView = new View()
  rightPanelView = new View()
  // This small overlay is transparent while the browser panel is closed.
  shellView.setBackgroundColor('#00000000')
  shellView.webContents.on('before-input-event', handleBrowserShortcut)
  windowDragView.setBackgroundColor('#00000000')
  panelResizeView.setBackgroundColor('#00000000')
  browserHost = new ElectronBrowserHost({
    rightPanelView,
    backgroundColor: nativeCanvasColor(),
    browserNavigationDisposition,
    isExtensionPage,
    onExternal: openExternal,
    onStateChange: publishShellState,
    onLayoutChange: requestPanelLayout,
    onTabUpdated: (tab, changeInfo) => extensionCompatibility.emitTabUpdated(tab, changeInfo),
    onTabForgotten: (tab) => extensionCompatibility.forgetTab(tab),
    getStartURL: () => browserStartURL(currentBrowserPreferences(), matterTheme),
    onShortcut: handleBrowserShortcut,
  })
  applyNativeTheme()
  createMatterTab()
  mainWindow.contentView.addChildView(matterFrameView)
  mainWindow.contentView.addChildView(rightPanelView)
  mainWindow.contentView.addChildView(windowDragView)
  mainWindow.contentView.addChildView(shellView)
  mainWindow.contentView.addChildView(panelResizeView)
  windowDragView.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  shellView.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  panelResizeView.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  void windowDragView.webContents.loadFile(path.join(__dirname, 'window-drag-region.html')).catch((error) => console.error('Failed to load window drag region:', error))
  const sharedShellPage = path.join(app.getAppPath(), 'web-dist', 'desktop-shell', 'index.html')
  void panelResizeView.webContents.loadFile(sharedShellPage, { query: { surface: 'resizer' } }).catch((error) => console.error('Failed to load panel resizer:', error))
  shellView.webContents.once('did-finish-load', () => {
    shellReady = true
    layoutViews()
    publishShellState()
    mainWindow.show()
  })
  void shellView.webContents.loadFile(sharedShellPage, { query: { surface: 'chrome' } }).catch((error) => console.error('Failed to load browser shell:', error))

  mainWindow.on('resize', () => {
    stopPanelMotion({ applyFinal: false })
    renderedPanelOpen = browserHost?.isPanelOpen() ?? false
    layoutViews()
  })
  mainWindow.on('blur', finishPanelResize)
  mainWindow.once('show', () => { void localExec?.refresh(); void browserDevice?.refresh() })
  mainWindow.on('closed', () => {
    localExec?.suspend()
    browserDevice?.suspend()
    matterTasks?.dispose()
    matterTasks = undefined
    void companion?.hide().catch(console.error)
    browserHost?.dispose()
    browserHost = undefined
    matterTab = undefined
    mainWindow = undefined
    shellView = undefined
    windowDragView = undefined
    matterFrameView = undefined
    rightPanelView = undefined
    panelResizeView = undefined
    panelResizeState = undefined
    clearTimeout(panelMotionTimer)
    panelMotion = undefined
    panelMotionTimer = undefined
    renderedPanelOpen = false
    shellReady = false
  })

  layoutViews()
}

app.whenReady().then(async () => {
  matterOrigin = loadMatterOrigin()
  localExec = createController({ app, safeStorage, fetchImpl: net.fetch.bind(net), origin: matterOrigin, dialog,
    getContents: () => matterTab?.view.webContents, getWindow: () => mainWindow, onSetupNeeded: () => localExecSettings?.open() })
  localExecSettings = createLocalExecSettings({ BrowserWindow, ipcMain, controller: localExec, getWindow: () => mainWindow, shell })
  installBundledFrontend({ app, protocol, net, origin: matterOrigin, backendHeaders: (headers, url) => localExec.headers(headers, url) })
  const extensionRoot = app.isPackaged
    ? path.join(process.resourcesPath, 'app.asar.unpacked', 'extensions', 'matter-browser')
    : path.join(__dirname, '..', 'extensions', 'matter-browser')
  browserDevice = createBrowserDevice({ app, safeStorage, fetchImpl: net.fetch.bind(net), origin: matterOrigin,
    getContents: () => matterTab?.view.webContents, compatibility: extensionCompatibility, extensionRoot, nativeImage })
  browserDeviceSettings = createBrowserSettings({ BrowserWindow, ipcMain, controller: browserDevice, getWindow: () => mainWindow })
  try {
    await loadBuiltInExtensions(app, { matterBrowser: false })
  } catch (error) {
    console.error('Failed to load bundled browser extensions:', error)
  }
  matterPresenceTimer = setInterval(() => void updateMatterPresence(), 1_000)
  configureIPC()
  createMenu()
  createWindow()
  try {
    companion = createCompanion({ onMatterAction: (action, target) => {
      if (action.startsWith('chat-') || action === 'qa-answer' || action === 'qa-upload') return handleMatterQa({ bridge:matterTasks, dialog }, action, target)
      if (!mainWindow || mainWindow.isDestroyed()) createWindow()
      return activateMatterWindow({ app, window: mainWindow,
        contents: matterTab.view.webContents, origin: matterOrigin }, action, target)
    } })
    companion.setTaskOutput(matterTaskOutput)
    await companion.start()
  } catch (error) {
    console.error('Failed to start integrated companion:', error)
  }

  app.on('activate', () => {
    if (!mainWindow || mainWindow.isDestroyed()) createWindow()
    else mainWindow.show()
    void companion?.show().catch(console.error)
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

let companionQuitting = false
app.on('before-quit', (event) => {
  localExec?.dispose()
  localExecSettings?.dispose()
  browserDevice?.dispose()
  browserDeviceSettings?.dispose()
  matterTasks?.dispose()
  if (companion && !companionQuitting) {
    event.preventDefault()
    companionQuitting = true
    void companion.stop().catch(console.error).finally(() => app.quit())
  }
  clearInterval(matterPresenceTimer)
  extensionApiBridge.stop()
})
