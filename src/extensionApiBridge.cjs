const path = require('node:path')

// Channel and callback names are shared with extension-worker-preload.cjs (checked by a unit test).
const REQUEST_CHANNEL = 'matter-browser-bridge:request'
const EVENT_CHANNEL = 'matter-browser-bridge:event'
const PRESENCE_CHANNEL = 'matter-browser-bridge:presence'
const PRESENCE_REFRESH_CHANNEL = 'matter-browser-bridge:presence-refresh'
const GROUP_CHANGED_CALLBACK = '__minduckElectronTabGroupChanged'
const TAB_UPDATED_CALLBACK = '__minduckElectronTabUpdated'
const WORKER_PRELOAD = path.join(__dirname, 'extension-worker-preload.cjs')

/**
 * Bridges the unchanged Matter Browser service worker to the Electron tab controller without a
 * DevTools port. A service-worker preload installs the chrome.* compatibility shim before the
 * extension's own code runs; requests and events travel over that worker's own IPC channel.
 */
class ExtensionApiBridge {
  constructor({ getSession, extensionName, handleRequest, logger = console }) {
    this.getSession = getSession
    this.extensionName = extensionName
    this.handleRequest = handleRequest
    this.logger = logger
    this.workers = new Map()
    this.presence = null
    this.preloadId = null
    this.onStatus = (details) => this.handleStatus(details)
  }

  /** Must run before the extension loads so its first worker start already receives the shim. */
  start() {
    if (this.preloadId) return
    const session = this.getSession()
    this.preloadId = session.registerPreloadScript({ type: 'service-worker', filePath: WORKER_PRELOAD })
    session.serviceWorkers.on('running-status-changed', this.onStatus)
  }

  extensionScope() {
    const extension = this.getSession().extensions.getAllExtensions().find((item) => item.name === this.extensionName)
    return extension?.url ?? null
  }

  handleStatus({ versionId, runningStatus }) {
    if (runningStatus === 'stopping' || runningStatus === 'stopped') {
      this.forgetWorker(versionId)
      return
    }
    if (this.workers.has(versionId)) return
    const worker = this.getSession().serviceWorkers.getWorkerFromVersionID(versionId)
    const scope = this.extensionScope()
    // The preload also runs in website workers; only the bundled extension's scope gets handlers.
    if (!worker || worker.isDestroyed() || !scope || worker.scope !== scope) return
    this.attachWorker(versionId, worker)
  }

  attachWorker(versionId, worker) {
    // A DevTools-attached worker never idled; keep the same lifetime so the Matter link stays open.
    const task = worker.startTask()
    this.workers.set(versionId, { worker, task })
    worker.ipc.handle(REQUEST_CHANNEL, (_event, request) => this.handleBridgeRequest(request))
    worker.ipc.on(PRESENCE_CHANNEL, (_event, value) => this.updatePresence(value))
    this.refreshPresence()
  }

  // The worker reads chrome.storage.local and replies with presence fields only.
  refreshPresence() {
    for (const { worker } of this.workers.values()) {
      if (worker.isDestroyed()) continue
      try { worker.send(PRESENCE_REFRESH_CHANNEL) } catch {}
    }
  }

  forgetWorker(versionId) {
    const entry = this.workers.get(versionId)
    if (!entry) return
    this.workers.delete(versionId)
    try { entry.task.end() } catch {}
  }

  async handleBridgeRequest(request) {
    if (!request || typeof request.method !== 'string') return { ok: false, error: 'Invalid extension bridge request' }
    const params = request.params && typeof request.params === 'object' ? request.params : {}
    try {
      return { ok: true, value: await this.handleRequest(request.method, params) }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  }

  updatePresence(value) {
    this.presence = value && typeof value === 'object' ? {
      deviceId: typeof value.deviceId === 'string' ? value.deviceId.slice(0, 200) : '',
      webOrigin: typeof value.webOrigin === 'string' ? value.webOrigin : '',
      revoked: value.revoked === true,
    } : null
  }

  /**
   * The paired device ID for this Matter origin; the device token never leaves the extension.
   * Main polls this every second, so each call answers from the cache and requests a fresh read.
   */
  async presenceDeviceId(origin) {
    this.refreshPresence()
    const presence = this.presence
    if (!presence || presence.revoked || !presence.deviceId || presence.webOrigin !== origin) return ''
    return presence.deviceId
  }

  broadcast(callback, args) {
    for (const { worker } of this.workers.values()) {
      if (worker.isDestroyed()) continue
      try { worker.send(EVENT_CHANNEL, callback, args) }
      catch (error) { this.logger.error('Failed to notify the Matter Browser extension:', error.message) }
    }
  }

  async notifyTabGroupChanged(tab) {
    this.broadcast(GROUP_CHANGED_CALLBACK, [tab.id, tab.groupId, tab])
  }

  async notifyTabUpdated(tab, changeInfo) {
    this.broadcast(TAB_UPDATED_CALLBACK, [tab.id, changeInfo, tab])
  }

  stop() {
    if (!this.preloadId) return
    const session = this.getSession()
    session.serviceWorkers.removeListener('running-status-changed', this.onStatus)
    session.unregisterPreloadScript(this.preloadId)
    for (const [versionId, { worker }] of this.workers) {
      this.forgetWorker(versionId)
      if (worker.isDestroyed()) continue
      worker.ipc.removeHandler(REQUEST_CHANNEL)
      worker.ipc.removeAllListeners(PRESENCE_CHANNEL)
    }
    this.preloadId = null
  }
}

module.exports = {
  EVENT_CHANNEL,
  ExtensionApiBridge,
  GROUP_CHANGED_CALLBACK,
  PRESENCE_CHANNEL,
  PRESENCE_REFRESH_CHANNEL,
  REQUEST_CHANNEL,
  TAB_UPDATED_CALLBACK,
  WORKER_PRELOAD,
}
