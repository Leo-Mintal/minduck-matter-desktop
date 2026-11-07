const { WebContentsView } = require('electron')
const { isBrowserStartURL } = require('./browserStartPage.cjs')
const {
  AGENT_BROWSER_PARTITION,
  LOCAL_SANDBOX_PARTITION,
  getLocalSandboxSession,
} = require('./agentBrowser.cjs')

const LOCAL_SANDBOX_URL = 'https://webvm.io/'
const DEFAULT_BROWSER_URL = 'https://www.google.com/'

/** Owns the in-window Chromium pages that make up the Agent Browser panel. */
class ElectronBrowserHost {
  constructor({
    rightPanelView,
    backgroundColor,
    browserNavigationDisposition,
    isExtensionPage,
    onExternal,
    onStateChange,
    onLayoutChange,
    onTabUpdated,
    onTabForgotten,
    getStartURL = () => DEFAULT_BROWSER_URL,
    onShortcut,
  }) {
    this.rightPanelView = rightPanelView
    this.backgroundColor = backgroundColor
    this.browserNavigationDisposition = browserNavigationDisposition
    this.isExtensionPage = isExtensionPage
    this.onExternal = onExternal
    this.onStateChange = onStateChange
    this.onLayoutChange = onLayoutChange
    this.onTabUpdated = onTabUpdated
    this.onTabForgotten = onTabForgotten
    this.getStartURL = getStartURL
    this.onShortcut = onShortcut
    this.tabs = new Map()
    this.activeTabId = undefined
    this.panelHidden = false
    this.nextTabId = 1
  }

  getTabs() {
    return [...this.tabs.values()]
  }

  browserTabs() {
    return this.getTabs().filter((tab) => tab.kind === 'browser')
  }

  getActiveTabId() {
    return this.activeTabId
  }

  getActiveTab() {
    return this.tabs.get(this.activeTabId)
  }

  isPanelOpen() {
    return !this.panelHidden && Boolean(this.getActiveTab())
  }

  closePanel() {
    this.panelHidden = true
    this.onLayoutChange()
    this.onStateChange()
  }

  openPanel() {
    const tab = this.getActiveTab()
    if (tab) this.selectTab(tab.id)
    else this.createBrowserTab()
  }

  setBackgroundColor(color) {
    this.backgroundColor = color
    for (const tab of this.tabs.values()) tab.view.setBackgroundColor(color)
  }

  setStartPageTheme(theme) {
    for (const tab of this.browserTabs()) {
      if (!tab.view.webContents.isDestroyed() && isBrowserStartURL(tab.view.webContents.getURL())) {
        void tab.view.webContents.executeJavaScript(`document.documentElement.dataset.theme = ${JSON.stringify(theme)}`)
          .catch((error) => console.error('Failed to update new tab theme:', error))
      }
    }
  }

  selectTab(tabId) {
    if (!this.tabs.has(tabId)) return
    this.activeTabId = tabId
    this.panelHidden = false
    this.onLayoutChange()
    this.onStateChange()
  }

  tabTitle(tab) {
    if (tab.kind === 'matter-browser-extension') return 'Matter 助手'
    if (tab.kind === 'local-sandbox') return '本地沙盒'
    return tab.title || '新标签页'
  }

  tabNavigationState(tab) {
    const unavailable = {
      canGoBack: false,
      canGoForward: false,
      canReload: false,
      isLoading: false,
      loadError: undefined,
    }
    if (!tab || tab.view.webContents.isDestroyed()) return unavailable

    const { webContents } = tab.view
    const { navigationHistory } = webContents
    const hasTarget = Boolean(tab.pendingURL || (tab.url && tab.url !== 'about:blank'))
    const externalURL = tab?.kind === 'browser' && /^https?:/i.test(tab.pendingURL || tab.url || '')
      ? tab.pendingURL || tab.url
      : undefined
    return {
      canGoBack: navigationHistory?.canGoBack?.() ?? false,
      canGoForward: navigationHistory?.canGoForward?.() ?? false,
      canReload: hasTarget,
      isLoading: webContents.isLoading(),
      loadError: tab.loadError,
      externalURL,
    }
  }

  shellState() {
    const activeTab = this.getActiveTab()
    return {
      activeTabId: this.activeTabId,
      rightPanelOpen: this.isPanelOpen(),
      browserControls: this.tabNavigationState(activeTab),
      tabs: this.getTabs().map((tab) => ({
        id: tab.id,
        kind: tab.kind,
        title: this.tabTitle(tab),
        url: isBrowserStartURL(tab.pendingURL || tab.url) ? '' : tab.pendingURL || tab.url,
        loading: Boolean(tab.view.webContents.isLoading()),
        loadError: tab.loadError,
        closable: true,
      })),
    }
  }

  createView(partition = AGENT_BROWSER_PARTITION) {
    if (partition === LOCAL_SANDBOX_PARTITION) getLocalSandboxSession()
    const view = new WebContentsView({
      webPreferences: {
        partition,
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        webSecurity: true,
        allowRunningInsecureContent: false,
        webviewTag: false,
      },
    })
    view.setBackgroundColor(this.backgroundColor)
    view.setVisible(false)
    view.webContents.on('will-attach-webview', (event) => event.preventDefault())
    if (this.onShortcut) view.webContents.on('before-input-event', this.onShortcut)
    view.webContents.on('login', (event, _details, _authInfo, callback) => {
      event.preventDefault()
      callback()
    })
    return view
  }

  addTab(kind, view, url, { active = true, title } = {}) {
    const tab = {
      id: 'tab-' + this.nextTabId++,
      kind,
      view,
      title: title ?? (kind === 'browser' ? '新标签页' : ''),
      url,
      navigationCommitted: url === 'about:blank',
      hasPainted: url === 'about:blank',
      pendingURL: undefined,
      loadError: undefined,
    }
    this.tabs.set(tab.id, tab)
    this.rightPanelView.addChildView(view)
    this.attachTabEvents(tab)
    if (active) this.selectTab(tab.id)
    else this.onLayoutChange()
    return tab
  }

  attachTabEvents(tab) {
    const { webContents } = tab.view
    const notifyExtensionTabUpdated = (changeInfo) => {
      void this.onTabUpdated(tab, changeInfo)
    }
    webContents.on('did-start-navigation', (_event, url, _isInPlace, isMainFrame) => {
      if (!isMainFrame) return
      tab.navigationCommitted = false
      tab.pendingURL = url
      tab.loadError = undefined
      notifyExtensionTabUpdated({ status: 'loading', pendingUrl: url })
      this.onStateChange()
    })
    webContents.on('did-navigate', (_event, url) => {
      tab.navigationCommitted = true
      tab.pendingURL = undefined
      tab.loadError = undefined
      tab.url = url
      notifyExtensionTabUpdated({ status: 'complete', url })
      this.onStateChange()
    })
    webContents.on('did-navigate-in-page', (_event, url, isMainFrame) => {
      if (!isMainFrame) return
      tab.navigationCommitted = true
      tab.pendingURL = undefined
      tab.loadError = undefined
      tab.url = url
      notifyExtensionTabUpdated({ status: 'complete', url })
      this.onStateChange()
    })
    webContents.on('did-finish-load', () => {
      tab.hasPainted = true
      if (tab.id === this.activeTabId) this.onLayoutChange()
    })
    webContents.on('did-fail-load', (_event, errorCode, errorDescription, url, isMainFrame) => {
      if (!isMainFrame || errorCode === -3) return
      tab.hasPainted = true
      tab.loadError = { code: errorCode, description: errorDescription || '页面加载失败' }
      tab.pendingURL = url || tab.pendingURL
      if (tab.id === this.activeTabId) this.onLayoutChange()
      this.onStateChange()
    })
    webContents.on('page-title-updated', (_event, title) => {
      if (tab.kind === 'browser' && title) {
        tab.title = title.slice(0, 80)
        this.onStateChange()
      }
    })
    webContents.on('render-process-gone', () => {
      if (tab.kind === 'browser') {
        tab.title = '页面已停止响应'
        tab.loadError = { code: undefined, description: '页面渲染进程已停止' }
        this.onStateChange()
      }
    })
    webContents.on('did-start-loading', () => this.onStateChange())
    webContents.on('did-stop-loading', () => this.onStateChange())
  }

  configureBrowserTab(tab) {
    const { webContents } = tab.view
    const guardNavigation = (details, legacyURL) => {
      const url = typeof details?.url === 'string' ? details.url : legacyURL
      const disposition = this.browserNavigationDisposition(url)
      if (disposition === 'navigate') return
      details.preventDefault()
      if (disposition === 'external') this.onExternal(url)
    }
    webContents.on('will-navigate', guardNavigation)
    webContents.on('will-redirect', guardNavigation)
    webContents.setWindowOpenHandler(({ url }) => {
      const disposition = this.browserNavigationDisposition(url)
      if (disposition === 'navigate') this.createBrowserTab(url)
      if (disposition === 'external') this.onExternal(url)
      return { action: 'deny' }
    })
  }

  configureExtensionTab(tab, extension) {
    const { webContents } = tab.view
    const guardNavigation = (details, legacyURL) => {
      const url = typeof details?.url === 'string' ? details.url : legacyURL
      if (this.isExtensionPage(url, extension)) return
      details.preventDefault()
      if (this.browserNavigationDisposition(url) === 'external') this.onExternal(url)
    }
    webContents.on('will-navigate', guardNavigation)
    webContents.on('will-redirect', guardNavigation)
    webContents.setWindowOpenHandler(({ url }) => {
      if (this.browserNavigationDisposition(url) === 'external') this.onExternal(url)
      return { action: 'deny' }
    })
  }

  createBrowserTab(url = this.getStartURL(), { active = true } = {}) {
    const view = this.createView()
    const tab = this.addTab('browser', view, url, { active })
    this.configureBrowserTab(tab)
    if (url !== 'about:blank') this.loadTab(tab, url)
    return tab
  }

  createExtensionTab(popupURL, extension) {
    const existing = this.getTabs().find((tab) => tab.kind === 'matter-browser-extension')
    if (existing) {
      this.selectTab(existing.id)
      return existing
    }
    if (!extension || !popupURL) return null
    const view = this.createView()
    const tab = this.addTab('matter-browser-extension', view, popupURL, { title: 'Matter 助手' })
    this.configureExtensionTab(tab, extension)
    this.loadTab(tab, popupURL, 'Failed to load the Matter Browser extension')
    return tab
  }

  createLocalSandboxTab() {
    const existing = this.getTabs().find((tab) => tab.kind === 'local-sandbox')
    if (existing) {
      this.selectTab(existing.id)
      return existing
    }
    const view = this.createView(LOCAL_SANDBOX_PARTITION)
    const tab = this.addTab('local-sandbox', view, LOCAL_SANDBOX_URL, { title: '本地沙盒' })
    const allowedOrigin = new URL(LOCAL_SANDBOX_URL).origin
    const guardNavigation = (details, legacyURL) => {
      const url = typeof details?.url === 'string' ? details.url : legacyURL
      try {
        if (new URL(url).origin === allowedOrigin) return
      } catch {
        // Block malformed navigation attempts.
      }
      details?.preventDefault?.()
    }
    view.webContents.on('will-navigate', guardNavigation)
    view.webContents.on('will-redirect', guardNavigation)
    view.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    this.loadTab(tab, LOCAL_SANDBOX_URL, 'Failed to load the local sandbox')
    return tab
  }

  closeTab(tabId) {
    const tab = this.tabs.get(tabId)
    if (!tab) return
    const wasActive = this.activeTabId === tabId
    this.onTabForgotten(tab)
    this.rightPanelView.removeChildView(tab.view)
    this.tabs.delete(tabId)
    if (!tab.view.webContents.isDestroyed()) tab.view.webContents.close()
    if (wasActive) this.activeTabId = this.getTabs().at(-1)?.id
    this.onLayoutChange()
    this.onStateChange()
  }

  openAddress(value, browserURLForInput) {
    const url = browserURLForInput(value)
    if (!url) return
    const activeTab = this.getActiveTab()
    const tab = activeTab?.kind === 'browser' ? activeTab : this.createBrowserTab()
    this.selectTab(tab.id)
    this.loadTab(tab, url, 'Failed to open browser address')
  }

  navigateActive(direction) {
    const tab = this.getActiveTab()
    if (!tab || tab.view.webContents.isDestroyed()) return
    const { navigationHistory } = tab.view.webContents
    if (direction === 'back' && navigationHistory?.canGoBack?.()) navigationHistory.goBack()
    if (direction === 'forward' && navigationHistory?.canGoForward?.()) navigationHistory.goForward()
    this.onStateChange()
  }

  reloadActive() {
    const tab = this.getActiveTab()
    if (!tab || tab.view.webContents.isDestroyed()) return
    const { webContents } = tab.view
    if (webContents.isLoading()) webContents.stop()
    else if (tab.loadError && tab.pendingURL) this.loadTab(tab, tab.pendingURL, 'Failed to retry browser address')
    else webContents.reload()
    this.onStateChange()
  }

  openActiveExternal() {
    const tab = this.getActiveTab()
    if (!tab || tab.kind !== 'browser' || tab.view.webContents.isDestroyed()) return
    const url = tab.pendingURL || tab.url
    if (/^https?:/i.test(url || '')) this.onExternal(url)
  }

  loadTab(tab, url, errorLabel = 'Failed to load browser tab') {
    if (!tab || tab.view.webContents.isDestroyed()) return
    tab.title = tab.kind === 'matter-browser-extension'
      ? 'Matter 助手'
      : tab.kind === 'local-sandbox' ? '本地沙盒' : '新标签页'
    tab.navigationCommitted = false
    tab.pendingURL = url
    tab.loadError = undefined
    this.onStateChange()
    void tab.view.webContents.loadURL(url).catch((error) => {
      if (!this.tabs.has(tab.id) || tab.view.webContents.isDestroyed()) return
      if (error?.code === 'ERR_ABORTED') return
      tab.hasPainted = true
      tab.loadError = { code: error?.code, description: error?.message || errorLabel }
      if (tab.id === this.activeTabId) this.onLayoutChange()
      this.onStateChange()
      console.error(errorLabel + ':', error)
    })
  }

  layout(layout, localBounds, setViewVisible) {
    const activeTab = this.getActiveTab()
    for (const tab of this.tabs.values()) {
      if (tab.id === activeTab?.id && tab.hasPainted !== false && layout.browser && layout.panel) {
        tab.view.setBounds(localBounds(layout.browser, layout.panel))
        setViewVisible(tab.view, true)
      } else {
        setViewVisible(tab.view, false)
      }
    }
  }

  dispose() {
    for (const tab of this.getTabs()) {
      this.onTabForgotten(tab)
      this.rightPanelView.removeChildView(tab.view)
      if (!tab.view.webContents.isDestroyed()) tab.view.webContents.close()
    }
    this.tabs.clear()
    this.activeTabId = undefined
  }
}

module.exports = { DEFAULT_BROWSER_URL, ElectronBrowserHost }
