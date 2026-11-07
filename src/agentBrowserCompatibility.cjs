const { AgentCursorOverlay } = require('./agentCursorOverlay.cjs')

const TAB_GROUP_ID_NONE = -1
// webContents.debugger is browser-wide: Target.* reaches every page and session, including Matter.
// Forward only the page-scoped methods the bundled Matter Browser extension sends.
const EXTENSION_DEBUGGER_METHODS = new Set([
  'Emulation.setDeviceMetricsOverride',
  'Input.dispatchKeyEvent',
  'Input.dispatchMouseEvent',
  'Input.insertText',
  'Page.captureScreenshot',
  'Page.enable',
  'Page.getLayoutMetrics',
  'Page.handleJavaScriptDialog',
  'Runtime.evaluate',
])

function asArray(value) {
  return Array.isArray(value) ? value : [value]
}

// Main-process loadURL bypasses will-navigate, so extension-requested pages are checked here.
function assertTabURL(value) {
  let url
  try {
    url = typeof value === 'string' ? new URL(value) : null
  } catch {}
  if (url?.href === 'about:blank' || url?.protocol === 'http:' || url?.protocol === 'https:') return
  throw new Error('Browser tabs can only open HTTP(S) pages')
}

function matchesURLPattern(url, pattern) {
  if (typeof pattern !== 'string' || !pattern) return false
  const escaped = pattern.replace(/[|\\{}()[\]^$+?.]/g, '\\$&').replaceAll('*', '.*')
  return new RegExp(`^${escaped}$`, 'i').test(url)
}

class AgentBrowserCompatibility {
  constructor({
    createTab,
    closeTab,
    getBrowserTabs,
    getMainWindow,
    getActiveTabId,
    selectTab,
    notifyGroupChanged = async () => {},
    notifyTabUpdated = async () => {},
    virtualWindowId = 0,
    cursorOverlayFactory = (webContents) => new AgentCursorOverlay(webContents),
  }) {
    this.createTab = createTab
    this.closeTab = closeTab
    this.getBrowserTabs = getBrowserTabs
    this.getMainWindow = getMainWindow
    this.getActiveTabId = getActiveTabId
    this.selectTab = selectTab
    this.notifyGroupChanged = notifyGroupChanged
    this.notifyTabUpdated = notifyTabUpdated
    this.virtualWindowId = virtualWindowId
    this.cursorOverlayFactory = cursorOverlayFactory
    this.groups = new Map()
    this.groupByTabId = new Map()
    this.debuggerOwners = new Map()
    this.cursorOverlays = new Map()
    this.nextGroupId = 1
  }

  browserTabs() {
    return this.getBrowserTabs().filter((tab) => !tab.view.webContents.isDestroyed())
  }

  tabById(tabId) {
    const tab = this.browserTabs().find((item) => item.view.webContents.id === tabId)
    if (!tab) throw new Error(`Browser tab ${tabId} was not found`)
    return tab
  }

  windowId() {
    const window = this.getMainWindow()
    if (!window || window.isDestroyed()) throw new Error('Minduck Matter window is not available')
    return this.virtualWindowId
  }

  tabShape(tab) {
    const { webContents } = tab.view
    const id = webContents.id
    const currentURL = webContents.getURL()
    const url = currentURL && currentURL !== 'about:blank' ? currentURL : (tab.url || 'about:blank')
    return {
      id,
      windowId: this.windowId(),
      index: this.browserTabs().findIndex((item) => item.id === tab.id),
      active: tab.id === this.activeTabId(),
      highlighted: tab.id === this.activeTabId(),
      pinned: false,
      incognito: false,
      discarded: false,
      autoDiscardable: true,
      groupId: this.groupByTabId.get(id) ?? TAB_GROUP_ID_NONE,
      // A committed document is usable even when a site keeps background requests open.
      status: tab.navigationCommitted || (tab.url === 'about:blank' && !webContents.isLoading()) ? 'complete' : 'loading',
      title: webContents.getTitle() || tab.title || '新标签页',
      url,
      ...(tab.pendingURL ? { pendingUrl: tab.pendingURL } : {}),
    }
  }

  activeTabId() {
    return this.getActiveTabId()
  }

  setActiveTab(tab) {
    this.selectTab(tab.id)
  }

  windowShape({ populate = false } = {}) {
    const window = this.getMainWindow()
    const [width, height] = window.getContentSize()
    const [x, y] = window.getPosition()
    const result = {
      id: this.windowId(),
      focused: window.isFocused(),
      incognito: false,
      type: 'normal',
      state: window.isMaximized() ? 'maximized' : 'normal',
      alwaysOnTop: window.isAlwaysOnTop(),
      left: x,
      top: y,
      width,
      height,
    }
    if (populate) result.tabs = this.browserTabs().map((tab) => this.tabShape(tab))
    return result
  }

  cleanupEmptyGroups() {
    for (const [groupId] of this.groups) {
      if (![...this.groupByTabId.values()].includes(groupId)) this.groups.delete(groupId)
    }
  }

  async setGroup(tab, groupId) {
    const tabId = tab.view.webContents.id
    if (groupId === TAB_GROUP_ID_NONE) this.groupByTabId.delete(tabId)
    else this.groupByTabId.set(tabId, groupId)
    this.cleanupEmptyGroups()
    await this.notifyGroupChanged(this.tabShape(tab))
  }

  async emitTabUpdated(tab, changeInfo) {
    if (!tab || tab.kind !== 'browser' || tab.view.webContents.isDestroyed()) return
    await this.notifyTabUpdated(this.tabShape(tab), changeInfo)
  }

  cursorOverlayFor(tab) {
    let overlay = this.cursorOverlays.get(tab.id)
    if (!overlay) {
      overlay = this.cursorOverlayFactory(tab.view.webContents)
      this.cursorOverlays.set(tab.id, overlay)
    }
    return overlay
  }

  forgetTab(tab) {
    if (!tab?.view) return
    this.cursorOverlays.get(tab.id)?.dispose()
    this.cursorOverlays.delete(tab.id)
    const tabId = tab.view.webContents.id
    const { webContents } = tab.view
    if (webContents.isDestroyed()) {
      this.debuggerOwners.delete(tabId)
      this.groupByTabId.delete(tabId)
      this.cleanupEmptyGroups()
      return
    }
    if (this.debuggerOwners.has(tabId) && webContents.debugger.isAttached()) {
      try {
        webContents.debugger.detach()
      } catch {}
    }
    this.debuggerOwners.delete(tabId)
    this.groupByTabId.delete(tabId)
    this.cleanupEmptyGroups()
  }

  async request(method, params = {}) {
    switch (method) {
      case 'tabs.metadata': return this.tabsMetadata(params)
      case 'tabs.get': return this.tabsGet(params)
      case 'tabs.query': return this.tabsQuery(params)
      case 'tabs.create': return this.tabsCreate(params)
      case 'tabs.update': return this.tabsUpdate(params)
      case 'tabs.remove': return this.tabsRemove(params)
      case 'tabs.reload': return this.tabsReload(params)
      case 'tabs.goBack': return this.tabsHistory(params, 'back')
      case 'tabs.goForward': return this.tabsHistory(params, 'forward')
      case 'tabs.group': return this.tabsGroup(params)
      case 'windows.get': return this.windowsGet(params)
      case 'windows.getAll': return this.windowsGetAll(params)
      case 'windows.getLastFocused': return this.windowsGetLastFocused(params)
      case 'windows.create': return this.windowsCreate(params)
      case 'windows.update': return this.windowsUpdate(params)
      case 'tabGroups.get': return this.tabGroupsGet(params)
      case 'tabGroups.query': return this.tabGroupsQuery(params)
      case 'tabGroups.update': return this.tabGroupsUpdate(params)
      case 'debugger.getTargets': return this.debuggerGetTargets(params)
      case 'debugger.attach': return this.debuggerAttach(params)
      case 'debugger.detach': return this.debuggerDetach(params)
      case 'debugger.sendCommand': return this.debuggerSendCommand(params)
      default: throw new Error(`Unsupported Matter Browser compatibility method: ${method}`)
    }
  }

  tabsMetadata({ tabId }) {
    const tab = this.browserTabs().find((item) => item.view.webContents.id === tabId)
    return { groupId: tab ? (this.groupByTabId.get(tabId) ?? TAB_GROUP_ID_NONE) : TAB_GROUP_ID_NONE }
  }

  tabsGet({ tabId }) {
    return this.tabShape(this.tabById(tabId))
  }

  tabsQuery({ queryInfo = {} }) {
    const urlPatterns = queryInfo.url === undefined ? [] : asArray(queryInfo.url)
    return this.browserTabs()
      .map((tab) => this.tabShape(tab))
      .filter((tab) => {
        if (queryInfo.active !== undefined && tab.active !== queryInfo.active) return false
        if (queryInfo.highlighted !== undefined && tab.highlighted !== queryInfo.highlighted) return false
        if (queryInfo.windowId !== undefined && tab.windowId !== queryInfo.windowId) return false
        if (queryInfo.groupId !== undefined && tab.groupId !== queryInfo.groupId) return false
        if (queryInfo.status !== undefined && tab.status !== queryInfo.status) return false
        if (urlPatterns.length && !urlPatterns.some((pattern) => matchesURLPattern(tab.url, pattern) || (tab.pendingUrl && matchesURLPattern(tab.pendingUrl, pattern)))) return false
        return true
      })
  }

  async tabsCreate({ url = 'about:blank', active = true, windowId }) {
    if (windowId !== undefined && windowId !== this.windowId()) throw new Error(`Browser window ${windowId} was not found`)
    assertTabURL(url)
    const tab = this.createTab(url, { active: active !== false })
    // Matter Browser currently creates navigation tabs with active:false when its
    // optional background flag is omitted. Browser-agent navigation is expected
    // to be visible in the right panel, so URL-bearing tabs always take focus.
    if (url !== 'about:blank' || active !== false) this.setActiveTab(tab)
    return this.tabShape(tab)
  }

  async tabsUpdate({ tabId, updateProperties = {} }) {
    const tab = this.tabById(tabId)
    if (updateProperties.url !== undefined) assertTabURL(updateProperties.url)
    if (updateProperties.active || typeof updateProperties.url === 'string') this.setActiveTab(tab)
    if (typeof updateProperties.url === 'string') {
      tab.title = '新标签页'
      tab.navigationCommitted = false
      tab.pendingURL = updateProperties.url
      void tab.view.webContents.loadURL(updateProperties.url).catch(() => {})
    }
    if (updateProperties.muted !== undefined) tab.view.webContents.setAudioMuted(Boolean(updateProperties.muted))
    return this.tabShape(tab)
  }

  async tabsRemove({ tabIds }) {
    const tabs = asArray(tabIds).map((tabId) => this.tabById(tabId))
    for (const tab of tabs) {
      const tabId = tab.view.webContents.id
      this.groupByTabId.delete(tabId)
      this.debuggerOwners.delete(tabId)
      this.closeTab(tab.id)
    }
    this.cleanupEmptyGroups()
  }

  async tabsReload({ tabId }) {
    const { webContents } = this.tabById(tabId).view
    webContents.reload()
  }

  async tabsHistory({ tabId }, direction) {
    const { webContents } = this.tabById(tabId).view
    const history = webContents.navigationHistory
    if (direction === 'back' && history.canGoBack()) history.goBack()
    if (direction === 'forward' && history.canGoForward()) history.goForward()
  }

  async tabsGroup({ tabIds, groupId, createProperties = {} }) {
    const tabs = asArray(tabIds).map((tabId) => this.tabById(tabId))
    if (!tabs.length) throw new Error('At least one browser tab is required to create a tab group')
    if (createProperties.windowId !== undefined && createProperties.windowId !== this.windowId()) {
      throw new Error(`Browser window ${createProperties.windowId} was not found`)
    }
    const resolvedGroupId = groupId ?? this.nextGroupId++
    if (!this.groups.has(resolvedGroupId)) {
      this.groups.set(resolvedGroupId, {
        id: resolvedGroupId,
        windowId: this.windowId(),
        collapsed: false,
        color: 'grey',
        title: '',
      })
    }
    for (const tab of tabs) await this.setGroup(tab, resolvedGroupId)
    return resolvedGroupId
  }

  windowsGet({ windowId, getInfo = {} }) {
    if (windowId !== this.windowId()) throw new Error(`Browser window ${windowId} was not found`)
    return this.windowShape(getInfo)
  }

  windowsGetAll({ getInfo = {} }) {
    return [this.windowShape(getInfo)]
  }

  windowsGetLastFocused({ getInfo = {} }) {
    return this.windowShape(getInfo)
  }

  async windowsCreate({ url = 'about:blank', focused = true }) {
    const tab = await this.tabsCreate({ url, active: focused !== false })
    return { ...this.windowShape({ populate: true }), tabs: [tab] }
  }

  windowsUpdate({ windowId, updateInfo = {} }) {
    if (windowId !== this.windowId()) throw new Error(`Browser window ${windowId} was not found`)
    const window = this.getMainWindow()
    if (updateInfo.focused) window.focus()
    return this.windowShape()
  }

  tabGroupsGet({ groupId }) {
    const group = this.groups.get(groupId)
    if (!group) throw new Error(`Tab group ${groupId} was not found`)
    return { ...group }
  }

  tabGroupsQuery({ queryInfo = {} }) {
    return [...this.groups.values()]
      .filter((group) => Object.entries(queryInfo).every(([key, value]) => group[key] === value))
      .map((group) => ({ ...group }))
  }

  tabGroupsUpdate({ groupId, updateProperties = {} }) {
    const group = this.groups.get(groupId)
    if (!group) throw new Error(`Tab group ${groupId} was not found`)
    Object.assign(group, updateProperties)
    return { ...group }
  }

  debuggerGetTargets({ extensionId } = {}) {
    return this.browserTabs().map((tab) => {
      const { webContents } = tab.view
      const tabId = webContents.id
      const owner = this.debuggerOwners.get(tabId)
      return {
        id: String(tabId),
        tabId,
        type: 'page',
        title: webContents.getTitle() || tab.title || '',
        url: webContents.getURL() || tab.url || 'about:blank',
        attached: webContents.debugger.isAttached(),
        ...(owner ? { extensionId: owner } : {}),
      }
    })
  }

  debuggerAttach({ target, requiredVersion, extensionId }) {
    const tabId = target?.tabId
    const { webContents } = this.tabById(tabId).view
    const owner = this.debuggerOwners.get(tabId)
    if (webContents.debugger.isAttached()) {
      if (owner === extensionId) return
      throw new Error(`Debugger is already attached to tab ${tabId}`)
    }
    webContents.debugger.attach(requiredVersion)
    this.debuggerOwners.set(tabId, extensionId || 'matter-browser')
  }

  debuggerDetach({ target, extensionId }) {
    const tabId = target?.tabId
    const { webContents } = this.tabById(tabId).view
    const owner = this.debuggerOwners.get(tabId)
    if (owner && owner !== extensionId) throw new Error(`Debugger is not owned by this extension for tab ${tabId}`)
    if (webContents.debugger.isAttached()) webContents.debugger.detach()
    this.debuggerOwners.delete(tabId)
  }

  async debuggerSendCommand({ target, method, commandParams = {}, extensionId }) {
    const tabId = target?.tabId
    const tab = this.tabById(tabId)
    const { webContents } = tab.view
    if (!EXTENSION_DEBUGGER_METHODS.has(method)) throw new Error(`Debugger method ${method} is not allowed in the Agent Browser`)
    if (this.debuggerOwners.get(tabId) !== extensionId) throw new Error(`Debugger is not attached by this extension for tab ${tabId}`)
    const cursor = this.cursorOverlayFor(tab)
    const eventType = commandParams?.type
    const hasCoordinates = Number.isFinite(commandParams?.x) && Number.isFinite(commandParams?.y)
    if (method === 'Input.dispatchMouseEvent' && hasCoordinates && ['mouseMoved', 'mousePressed', 'mouseReleased', 'mouseWheel'].includes(eventType)) {
      await cursor.showAt(commandParams.x, commandParams.y)
    }
    if (method === 'Page.captureScreenshot') {
      return cursor.withHidden(() => webContents.debugger.sendCommand(method, commandParams))
    }
    return webContents.debugger.sendCommand(method, commandParams)
  }
}

module.exports = {
  AgentBrowserCompatibility,
  EXTENSION_DEBUGGER_METHODS,
  TAB_GROUP_ID_NONE,
}
