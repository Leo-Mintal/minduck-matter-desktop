// Service-worker preload for the Agent Browser session. Electron runs it in every service worker of
// that session, including websites, so it installs nothing unless the worker is the bundled extension.
const { contextBridge, ipcRenderer } = require('electron')

// Keep in sync with MATTER_BROWSER_EXTENSION_NAME in agentBrowser.cjs (checked by a unit test).
const EXTENSION_NAME = 'Minduck Matter 浏览器助手'
const REQUEST_CHANNEL = 'matter-browser-bridge:request'
const EVENT_CHANNEL = 'matter-browser-bridge:event'
const PRESENCE_CHANNEL = 'matter-browser-bridge:presence'
const PRESENCE_REFRESH_CHANNEL = 'matter-browser-bridge:presence-refresh'
const BINDING = '__minduckElectronExtensionBridge'
const CALLBACKS = new Set(['__minduckElectronTabGroupChanged', '__minduckElectronTabUpdated'])

function workerIdentity() {
  return contextBridge.executeInMainWorld({ func: () => ({
    href: String(location.href),
    name: globalThis.chrome?.runtime?.getManifest?.().name ?? null,
  }) })
}

// Main attaches this worker's handlers on its starting event; retry briefly if a call races it.
async function request(method, params) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await ipcRenderer.invoke(REQUEST_CHANNEL, { method, params })
    } catch (error) {
      if (attempt >= 20 || !/No handler registered/.test(String(error?.message))) {
        return { ok: false, error: 'Minduck Electron bridge request failed' }
      }
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
  }
}

function presence(config) {
  ipcRenderer.send(PRESENCE_CHANNEL, {
    deviceId: typeof config?.deviceId === 'string' ? config.deviceId : '',
    webOrigin: typeof config?.webOrigin === 'string' ? config.webOrigin : '',
    revoked: config?.revoked === true,
  })
}

const identity = workerIdentity()
if (identity.href.startsWith('chrome-extension://') && identity.name === EXTENSION_NAME) {
  contextBridge.exposeInMainWorld(BINDING, { request })
  contextBridge.executeInMainWorld({ func: installCompatibility, args: [BINDING] })
  // Only the presence fields leave the worker; the device token stays in extension storage.
  ipcRenderer.on(PRESENCE_REFRESH_CHANNEL, async () => {
    try {
      presence(await contextBridge.executeInMainWorld({ func: () => chrome.storage.local.get('matter.link').then((items) => {
        const config = items?.['matter.link']
        return config && typeof config === 'object'
          ? { deviceId: config.deviceId, webOrigin: config.webOrigin, revoked: config.revoked } : null
      }) }))
    } catch {
      presence(null)
    }
  })
  ipcRenderer.on(EVENT_CHANNEL, (_event, name, args) => {
    if (!CALLBACKS.has(name) || !Array.isArray(args)) return
    contextBridge.executeInMainWorld({ func: (callback, values) => { globalThis[callback]?.(...values) }, args: [name, args] })
  })
}

// Runs in the extension's main world before its own top-level code. It must stay self-contained.
function installCompatibility(bindingName) {
  if (globalThis.__minduckElectronBridgeInstalled) return
  const bridge = globalThis[bindingName]
  const call = async (method, params = {}) => {
    const response = await bridge.request(method, params)
    if (response && response.ok) return response.value
    throw new Error(response?.error || 'Minduck Electron bridge request failed')
  }
  const nativeTabs = chrome.tabs
  const nativeGet = nativeTabs.get.bind(nativeTabs)
  const nativeQuery = nativeTabs.query.bind(nativeTabs)
  const nativeOnUpdated = nativeTabs.onUpdated
  const decorate = async (tab) => {
    if (!tab || typeof tab.id !== 'number') return tab
    return { ...tab, ...await call('tabs.metadata', { tabId: tab.id }) }
  }
  nativeTabs.get = async (tabId) => {
    try { return await call('tabs.get', { tabId }) } catch { return decorate(await nativeGet(tabId)) }
  }
  nativeTabs.query = async (queryInfo = {}) => {
    try {
      const virtualTabs = await call('tabs.query', { queryInfo })
      const requiresBrowserScope = queryInfo.groupId !== undefined || queryInfo.active === true
        || queryInfo.currentWindow === true || queryInfo.windowId !== undefined
      if (virtualTabs.length || requiresBrowserScope) return virtualTabs
    } catch {}
    const { groupId, ...nativeQueryInfo } = queryInfo || {}
    const tabs = await Promise.all((await nativeQuery(nativeQueryInfo)).map(decorate))
    return groupId === undefined ? tabs : tabs.filter((tab) => tab.groupId === groupId)
  }
  nativeTabs.create = (createProperties = {}) => call('tabs.create', createProperties)
  nativeTabs.update = (tabId, updateProperties = {}) => call('tabs.update', { tabId, updateProperties })
  nativeTabs.remove = (tabIds) => call('tabs.remove', { tabIds })
  nativeTabs.reload = (tabId, reloadProperties = {}) => call('tabs.reload', { tabId, reloadProperties })
  nativeTabs.goBack = (tabId) => call('tabs.goBack', { tabId })
  nativeTabs.goForward = (tabId) => call('tabs.goForward', { tabId })
  nativeTabs.group = (options = {}) => call('tabs.group', options)

  const listeners = new Set()
  try {
    nativeTabs.onUpdated = {
      addListener(listener) { listeners.add(listener); nativeOnUpdated.addListener(listener) },
      removeListener(listener) { listeners.delete(listener); nativeOnUpdated.removeListener(listener) },
      hasListener: (listener) => listeners.has(listener),
    }
  } catch {}
  const emit = (tabId, changeInfo, tab) => {
    for (const listener of listeners) { try { listener(tabId, changeInfo, tab) } catch {} }
  }
  globalThis.__minduckElectronTabGroupChanged = (tabId, groupId, tab) => emit(tabId, { groupId }, tab)
  globalThis.__minduckElectronTabUpdated = emit
  const nativeWindows = chrome.windows || (chrome.windows = {})
  nativeWindows.get = (windowId, getInfo = {}) => call('windows.get', { windowId, getInfo })
  nativeWindows.getAll = (getInfo = {}) => call('windows.getAll', { getInfo })
  nativeWindows.getLastFocused = (getInfo = {}) => call('windows.getLastFocused', { getInfo })
  nativeWindows.create = (createData = {}) => call('windows.create', createData)
  nativeWindows.update = (windowId, updateInfo = {}) => call('windows.update', { windowId, updateInfo })
  chrome.tabGroups = {
    get: (groupId) => call('tabGroups.get', { groupId }),
    query: (queryInfo = {}) => call('tabGroups.query', { queryInfo }),
    update: (groupId, updateProperties = {}) => call('tabGroups.update', { groupId, updateProperties }),
  }
  chrome.debugger = {
    getTargets: () => call('debugger.getTargets', { extensionId: chrome.runtime.id }),
    attach: (target, requiredVersion) => call('debugger.attach', { target, requiredVersion, extensionId: chrome.runtime.id }),
    detach: (target) => call('debugger.detach', { target, extensionId: chrome.runtime.id }),
    sendCommand: (target, method, commandParams = {}) => call('debugger.sendCommand',
      { target, method, commandParams, extensionId: chrome.runtime.id }),
  }
  globalThis.__minduckElectronBridgeInstalled = true
}
