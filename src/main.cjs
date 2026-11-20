// Default fresh profiles to Chinese; Matter still honors its saved language preference.
require('electron').app.commandLine.appendSwitch('lang', 'zh-CN')

// The pet uses this executable in an isolated child, before the business shell boots.
if (process.argv.includes('--minduck-companion-host')) {
  require('./companion/host.cjs')
  return
}

const path = require('node:path')
const fs = require('node:fs')
const { pathToFileURL } = require('node:url')
const { app, BrowserWindow, dialog, ipcMain, Menu, net, protocol, shell, View, WebContentsView, safeStorage, nativeImage } = require('electron')
const { createClientRuntime } = require('./client-runtime.cjs')
const { createController } = require('./local-exec/controller.cjs')
const { createAccessDialog } = require('./local-exec/access-dialog.cjs')
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
  FRAME_RADIUS,
  FRAME_RAIL_WIDTH,
  matterContentBounds,
  workspaceFrameBounds,
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
  isMatterConversationURL,
  isMatterWebURL,
  normalizeMatterOrigin,
  resolveMatterOrigin,
} = require('./matterService.cjs')
const {
  hasFullDiskAccess,
  FULL_DISK_ACCESS_SETTINGS_URL,
} = require('./fullDiskAccess.cjs')
const { createDesktopUpdater, macUpdateRuntime } = require('./desktopUpdater.cjs')
const { createKeyProvider } = require('./desktop-access/keys.cjs')
const { createService: createDesktopAccessService } = require('./desktop-access/service.cjs')
const { createAccessController } = require('./desktop-access/controller.cjs')
const { createGate } = require('./desktop-access/gate.cjs')
const { createMatterServiceSettings } = require('./matterServiceSettings.cjs')

const MATTER_UNAVAILABLE_PAGE = path.join(__dirname, 'matter-unavailable.html')
const MATTER_UNAVAILABLE_URL = pathToFileURL(MATTER_UNAVAILABLE_PAGE).toString()
const stylePreviewOnly = require('../package.json').main === 'src/style-preview.cjs'
// The 0.2.0 Web rail uses --navigation-bg; the native window also needs its resolved colors.
const previewRailColors = { dark: '#141414', light: '#f7f7f7' }
const previewRailCSS = Object.entries(previewRailColors).map(([theme, color]) =>
  `:root[data-theme='${theme}'] { --desktop-rail-surface: var(--navigation-bg, ${color}); }`).join('\n')

// A development run must not share extension workers or browser storage with an installed build.
const shellTestOrigin = require('../package.json').shellTestOrigin
if (shellTestOrigin) {
  app.setPath('userData', path.join(app.getPath('appData'), 'minduck-matter-shell-test'))
  process.env.MINDUCK_MATTER_ORIGIN ||= shellTestOrigin
}
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
let matterWorkspace = false
let extensionApiBridge
let matterPresenceTimer
let matterTheme = 'dark'
let matterOrigin = DEFAULT_MATTER_ORIGIN
let matterServiceSettings
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
let browserDevice
let desktopUpdater
let desktopUpdate = { checking: false, available: false }
let nextUpdateCheckAt = 0
let desktopAccess
let desktopAccessService
let activationGate
let businessAllowed = false
let businessStarted = false

function nativeFrameColor() {
  if (stylePreviewOnly) return previewRailColors[matterTheme]
  if (chromeMetrics?.theme === matterTheme) return chromeMetrics.frame
  return matterTheme === 'light' ? '#f7f7f7' : '#202222'
}

function nativeSettingsSurfaceColor(theme = matterTheme) {
  if (chromeMetrics?.theme === theme) return chromeMetrics.surface
  return theme === 'light' ? '#ffffff' : '#161719'
}

function applyNativeTheme() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.setBackgroundColor(nativeFrameColor())
    mainWindow.contentView.setBackgroundColor(nativeFrameColor())
  }
  if (matterFrameView) matterFrameView.setBackgroundColor(nativeFrameColor())
  if (rightPanelView) rightPanelView.setBackgroundColor(nativeFrameColor())
  browserHost?.setStartPageTheme(matterTheme)
  browserHost?.setFrameColor(nativeFrameColor())
}

function setViewVisible(view, visible) {
  if (view && view.getVisible() !== visible) view.setVisible(visible)
}

function setViewBounds(view, bounds) {
  const previous = view.getBounds()
  if (['x', 'y', 'width', 'height'].some((key) => previous[key] !== bounds[key])) view.setBounds(bounds)
}

function matterViewBounds(matterBounds) {
  const bounds = workspaceFrameBounds(matterBounds, matterWorkspace)
  return localBounds(matterContentBounds(bounds), bounds)
}

function updateMatterCorners(joined, force = false) {
  const tab = matterTab
  if (!tab || tab.view.webContents.isDestroyed() || (!force && tab.joined === joined)) return
  tab.joined = joined
  void tab.view.webContents.executeJavaScript(`document.documentElement.toggleAttribute('data-minduck-browser-open', ${joined})`)
    .catch(error => console.error('Failed to update Matter card corners:', error))
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
  publishDesktopFrameState()
  if (!shellReady || !shellView || shellView.webContents.isDestroyed()) return
  shellView.webContents.send('browser-shell:state', shellState())
}

function desktopFrameState() {
  const contents = matterTab?.view.webContents
  const ready = contents && !contents.isDestroyed()
  const navigation = {
    canGoBack: ready ? contents.navigationHistory.canGoBack() : false,
    canGoForward: ready ? contents.navigationHistory.canGoForward() : false,
    canReload: Boolean(ready),
    isLoading: ready ? contents.isLoading() : false,
  }
  return { theme: matterTheme, workspace: matterWorkspace, rightPanelOpen: browserHost?.isPanelOpen() ?? false, navigation,
    update: desktopUpdate, activationCheckUnavailable: Boolean(desktopAccess?.snapshot().message && businessAllowed) }
}

function navigateMatter(type) {
  const contents = matterTab?.view.webContents
  if (!contents || contents.isDestroyed()) return
  const history = contents.navigationHistory
  if (type === 'matter-go-back' && history.canGoBack()) history.goBack()
  if (type === 'matter-go-forward' && history.canGoForward()) history.goForward()
  if (type === 'matter-reload') contents.reload()
}

function publishDesktopFrameState() {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('desktop-frame:state', desktopFrameState())
  if (matterWorkspace && matterTab && !matterTab.view.webContents.isDestroyed()) {
    matterTab.view.webContents.send('workspace-shell:state', workspaceState())
  }
}

function workspaceState() {
  return { railWidth: FRAME_RAIL_WIDTH, update: desktopUpdate, rightPanelOpen: browserHost?.isPanelOpen() ?? false }
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
      x: frame.panel.x,
      y: openLayout.browser.y,
      width: frame.panel.width,
      height: Math.max(0, frame.panel.height - (openLayout.browser.y - openLayout.panel.y)),
    },
  }
}

function applyPanelMotionFrame() {
  if (!panelMotion || !mainWindow || mainWindow.isDestroyed()) return
  const frame = interpolatePanelFrame(panelMotion.from, panelMotion.target, panelMotionProgress(panelMotion))
  updateMatterCorners(true)
  if (windowDragView) setViewBounds(windowDragView, frame.dragRegion)
  if (panelResizeView) setViewVisible(panelResizeView, false)
  if (matterFrameView) {
    setViewBounds(matterFrameView, workspaceFrameBounds(frame.matter, matterWorkspace))
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
  updateMatterCorners(Boolean(layout.panel))
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
    setViewBounds(matterFrameView, workspaceFrameBounds(layout.matter, matterWorkspace))
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
  if (shellView) {
    if (layout.panel) setViewBounds(shellView, layout.shell)
    setViewVisible(shellView, Boolean(layout.panel))
  }
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

  const runtime = browserDevice?.snapshot() || {}
  const expression = `(() => {
    const root = document.documentElement
    if (!root) return
    root.dataset.matterRuntimeState = ${JSON.stringify(runtime.state || "当前客户端不可用")}
    root.dataset.matterDesktop = "true"
    root.dataset.matterRuntime = ${JSON.stringify(JSON.stringify({ ...runtime, updated_at: Date.now() }))}
    window.dispatchEvent(new Event("matter:runtime-status"))
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
  for (const event of ['did-navigate', 'did-navigate-in-page', 'did-start-loading', 'did-stop-loading']) {
    webContents.on(event, (_event, _url, isMainFrame) => {
      if ((event === 'did-navigate' || event === 'did-navigate-in-page') && isMainFrame !== false) {
        browserHost?.setPanelSuppressed(!isMatterConversationURL(webContents.getURL(), matterOrigin))
      }
      setImmediate(publishDesktopFrameState)
    })
  }
  // One listener owned by this session; right-side browser tabs use another session.
  webContents.session.webRequest.onBeforeSendHeaders((details, callback) => {
    // Main-process net.fetch forwarding has no webContentsId.
    const ownRequest = details.webContentsId == null || details.webContentsId === webContents.id || details.webContentsId === -1
    const headers = browserDevice?.headers(details.requestHeaders, ownRequest ? details.url : 'https://invalid.local/')
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
      preload: path.join(__dirname, 'workspace-preload.cjs'),
      additionalArguments: [`--minduck-workspace-origin=${matterOrigin}`],
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
  view.setBackgroundColor('#00000000')
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
  view.webContents.on('dom-ready', () => {
    const corners = `html { background: ${stylePreviewOnly ? previewRailColors.dark : '#202222'} !important; }
      html[data-theme='light'] { background: #f7f7f7 !important; }
      html:not([data-matter-workspace]) body { clip-path: inset(0 round ${FRAME_RADIUS}px) !important; }
      html:not([data-matter-workspace])[data-minduck-browser-open] body { clip-path: inset(0 round ${FRAME_RADIUS}px 0 0 ${FRAME_RADIUS}px) !important; }`
    void view.webContents.insertCSS(corners).then(() => {
      if (matterTab === tab) updateMatterCorners(Boolean(panelMotion) || Boolean(browserHost?.isPanelOpen()), true)
    }).catch(error => console.error('Failed to apply Matter card corners:', error))
  })
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

function openMatterServiceSettings() {
  matterServiceSettings ||= createMatterServiceSettings({ app, dialog, getWindow: () => mainWindow,
    getState: matterServiceSettingsState, saveOrigin: saveMatterOrigin, restart: restartApplication })
  matterServiceSettings.show()
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
    hasFullDiskAccess()
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

function lookupDesktopUpdate() {
  return getDesktopUpdater().check()
}

function getDesktopUpdater() {
  desktopUpdater ??= createDesktopUpdater({ ...(stylePreviewOnly
    ? { unavailableReason: '本地样式预览不安装更新。' } : macUpdateRuntime(app)), currentVersion: app.getVersion(),
    showDialog: showUpdateDialog,
    onState: (state) => {
      desktopUpdate = state
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.setProgressBar(state.phase === 'downloading' ? state.percent / 100
          : state.phase === 'preparing' ? 2 : -1)
      }
      publishDesktopFrameState()
    },
    hasActiveTasks: () => matterTaskOutput.active === true,
    prepareToQuit: async () => {
      await companion?.stop()
      companionQuitting = true
    },
  })
  return desktopUpdater
}

function refreshDesktopUpdate() {
  if (Date.now() < nextUpdateCheckAt) return
  nextUpdateCheckAt = Date.now() + 15 * 60 * 1000
  void lookupDesktopUpdate().catch(error => console.error('Background update check failed:', error.message))
}

function checkForDesktopUpdate() {
  return getDesktopUpdater().run().catch(error => console.error('无法显示客户端更新:', error))
}

function configureIPC() {
  const isWorkspaceSender = event => Boolean(matterTab && !matterTab.view.webContents.isDestroyed()
    && event.sender === matterTab.view.webContents && event.senderFrame === event.sender.mainFrame
    && isMatterWebURL(event.senderFrame.url, matterOrigin))
  ipcMain.handle('workspace-shell:get-state', event => {
    if (!isWorkspaceSender(event)) return null
    if (!matterWorkspace) { matterWorkspace = true; layoutViews(); publishDesktopFrameState() }
    return workspaceState()
  })
  ipcMain.on('workspace-shell:command', (event, type) => {
    if (!isWorkspaceSender(event)) return
    if (type === 'companion-settings') companion?.openSettings()
    if (type === 'check-update') void checkForDesktopUpdate()
  })
  const isFrameSender = (event) => Boolean(mainWindow && !mainWindow.isDestroyed()
    && event.sender === mainWindow.webContents && event.senderFrame === mainWindow.webContents.mainFrame)
  ipcMain.handle('desktop-frame:get-state', (event) => isFrameSender(event) ? desktopFrameState() : null)
  ipcMain.on('desktop-frame:command', (event, type) => {
    if (!isFrameSender(event)) return
    if (['matter-go-back', 'matter-go-forward', 'matter-reload'].includes(type)) navigateMatter(type)
    if (type === 'companion-settings') companion?.openSettings()
    if (type === 'check-update') void checkForDesktopUpdate()
    if (type === 'toggle-browser') {
      finishPanelResize()
      if (browserHost?.isPanelOpen()) browserHost.closePanel()
      else browserHost?.openPanel()
    }
  })
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
    const colorsChanged = ['canvas', 'surface', 'divider', 'frame'].some((key) => next[key] !== chromeMetrics?.[key])
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
}

function createMenu() {
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: app.getName(),
        submenu: [
          { role: 'about' },
          { label: '检查更新…', click: () => void checkForDesktopUpdate() },
          { type: 'separator' },
          { label: '配置 Matter 服务地址...', click: openMatterServiceSettings },
          { label: '使用默认 Matter 服务', click: () => void useDefaultMatterService() },
          { label: '桌宠设置…', accelerator: 'CmdOrCtrl+,', click: () => companion?.openSettings() },
          { label: '显示桌宠', click: () => void companion?.show().catch(console.error) },
          { label: '隐藏桌宠', click: () => void companion?.hide().catch(console.error) },
          ...(process.platform === 'darwin'
            ? [{ label: '完全磁盘访问授权...', click: () => void openFullDiskAccessSettings() }, { type: 'separator' }]
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
  if (!businessAllowed) { activationGate?.show(); return }
  shellReady = false
  matterWorkspace = require('../package.json').webOwnsNavigation === true
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 600,
    show: false,
    title: app.getName(),
    // Keep the native window controls without reserving a separate title-bar band.
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    trafficLightPosition: process.platform === 'darwin' ? { x: 12, y: 10 } : undefined,
    backgroundColor: nativeFrameColor(),
    webPreferences: {
      preload: path.join(__dirname, 'desktop-frame-preload.cjs'),
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
  rightPanelView.setBorderRadius(FRAME_RADIUS)
  // This small overlay is transparent while the browser panel is closed.
  shellView.setBackgroundColor('#00000000')
  shellView.webContents.on('before-input-event', handleBrowserShortcut)
  windowDragView.setBackgroundColor('#00000000')
  panelResizeView.setBackgroundColor('#00000000')
  browserHost = new ElectronBrowserHost({
    rightPanelView,
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
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  if (stylePreviewOnly) mainWindow.on('page-title-updated', event => event.preventDefault())
  mainWindow.webContents.on('will-navigate', event => event.preventDefault())
  mainWindow.webContents.on('will-redirect', event => event.preventDefault())
  const hostWindow = mainWindow
  const frameReady = hostWindow.loadFile(path.join(__dirname, 'desktop-frame.html')).then(async () => {
    if (stylePreviewOnly) await hostWindow.webContents.insertCSS(previewRailCSS)
    publishDesktopFrameState()
  }).catch(error => console.error('Failed to load desktop frame:', error))
  windowDragView.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  shellView.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  panelResizeView.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  void windowDragView.webContents.loadFile(path.join(__dirname, 'window-drag-region.html')).catch((error) => console.error('Failed to load window drag region:', error))
  const sharedShellPage = path.join(app.getAppPath(), 'web-dist', 'desktop-shell', 'index.html')
  void panelResizeView.webContents.loadFile(sharedShellPage, { query: { surface: 'resizer' } }).catch((error) => console.error('Failed to load panel resizer:', error))
  const chromeContents = shellView.webContents
  chromeContents.once('did-finish-load', async () => {
    const sidebarIcon = pathToFileURL(path.join(__dirname, 'assets/sidebar-toggle.svg')).href
    try {
      await chromeContents.insertCSS(`:root { --desktop-sidebar-icon: url("${sidebarIcon}"); }\n`
        + fs.readFileSync(path.join(__dirname, 'browser-frame.css'), 'utf8')
        + (stylePreviewOnly ? '\n' + previewRailCSS : ''))
      if (stylePreviewOnly) await frameReady
    } catch (error) {
      if (!chromeContents.isDestroyed()) console.error('Failed to prepare browser shell:', error)
      return
    }
    // A revoke/outage may have stopped this window while CSS was loading.
    if (!businessAllowed || mainWindow !== hostWindow || hostWindow.isDestroyed()) return
    shellReady = true
    layoutViews()
    publishShellState()
    hostWindow.show()
  })
  void shellView.webContents.loadFile(sharedShellPage, { query: { surface: 'chrome' } }).catch((error) => console.error('Failed to load browser shell:', error))

  mainWindow.on('resize', () => {
    stopPanelMotion({ applyFinal: false })
    renderedPanelOpen = browserHost?.isPanelOpen() ?? false
    layoutViews()
  })
  mainWindow.on('blur', finishPanelResize)
  mainWindow.once('show', () => { void localExec?.refresh(); void browserDevice?.refresh(); refreshDesktopUpdate() })
  mainWindow.on('focus', refreshDesktopUpdate)
  mainWindow.on('closed', () => {
    matterServiceSettings?.close()
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

async function startDesktopBusiness() {
  if (businessStarted) {
    if (!mainWindow || mainWindow.isDestroyed()) createWindow()
    return
  }
  businessStarted = true
  if (!stylePreviewOnly) {
    localExec = createController({ app, origin: matterOrigin, getContents: () => matterTab?.view.webContents,
      openPath: filename => shell.openPath(filename), confirmAccess: createAccessDialog({ dialog, getWindow: () => mainWindow }) })
    const extensionRoot = app.isPackaged
      ? path.join(process.resourcesPath, 'app.asar.unpacked', 'extensions', 'matter-browser')
      : path.join(__dirname, '..', 'extensions', 'matter-browser')
    browserDevice = createClientRuntime({ app, localExec, fetchImpl: net.fetch.bind(net), origin: matterOrigin,
      getAccessProof: (runtimeId, token) => desktopAccessService.runtimeProof(runtimeId, token),
      getContents: () => matterTab?.view.webContents, compatibility: extensionCompatibility, extensionRoot, nativeImage })
  }
  try {
    await loadBuiltInExtensions(app, { matterBrowser: false })
  } catch (error) {
    console.error('Failed to load bundled browser extensions:', error)
  }
  matterPresenceTimer = setInterval(() => { void updateMatterPresence(); publishDesktopFrameState() }, 1_000)
  createWindow()
  if (stylePreviewOnly) return
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

}

async function stopDesktopBusiness() {
  matterServiceSettings?.close()
  businessAllowed = false
  businessStarted = false
  clearInterval(matterPresenceTimer)
  localExec?.dispose(); localExec = undefined
  browserDevice?.dispose(); browserDevice = undefined
  matterTasks?.dispose(); matterTasks = undefined
  mainWindow?.destroy()
  await companion?.stop().catch(console.error)
  companion = undefined
  extensionApiBridge.stop()
}

app.whenReady().then(async () => {
  matterOrigin = loadMatterOrigin()
  desktopAccessService = createDesktopAccessService({ origin: matterOrigin, keys: createKeyProvider({ app, origin: matterOrigin }) })
  installBundledFrontend({ app, protocol, net, origin: matterOrigin,
    backendHeaders: (headers, url, referrer) => browserDevice?.headers(headers, url, referrer) || headers,
    backendRequest: request => {
      if (!businessAllowed) throw new Error('Desktop activation required')
      return desktopAccessService.prepareAuth(request)
    } })
  configureIPC()
  createMenu()
  desktopAccess = createAccessController({ service: desktopAccessService,
    onChange: publishDesktopFrameState,
    onActive: async () => { businessAllowed = true; await startDesktopBusiness() },
    onBlocked: stopDesktopBusiness })
  activationGate = createGate({ app, dialog, controller: desktopAccess })
  app.on('activate', () => {
    if (!businessAllowed) { activationGate.show(); return }
    if (!mainWindow || mainWindow.isDestroyed()) createWindow()
    else mainWindow.show()
    void companion?.show().catch(console.error)
  })
  await desktopAccess.start()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

let companionQuitting = false
app.on('before-quit', (event) => {
  matterServiceSettings?.close()
  desktopAccess?.dispose()
  activationGate?.dispose()
  localExec?.dispose()
  browserDevice?.dispose()
  matterTasks?.dispose()
  if (companion && !companionQuitting) {
    event.preventDefault()
    companionQuitting = true
    void companion.stop().catch(console.error).finally(() => app.quit())
  }
  clearInterval(matterPresenceTimer)
  extensionApiBridge.stop()
})
