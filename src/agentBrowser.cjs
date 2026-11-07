const path = require('node:path')
const { session } = require('electron')

const AGENT_BROWSER_PARTITION = 'persist:minduck-agent-browser'
const LOCAL_SANDBOX_PARTITION = 'persist:minduck-local-sandbox'
const XIAOHONGSHU_EXTENSION_NAME = 'Minduck Xiaohongshu Agent'
const MATTER_BROWSER_EXTENSION_NAME = 'Minduck Matter 浏览器助手'

let extensionsReady
let browserSessionConfigured = false
let localSandboxSessionConfigured = false

function extensionDirectory(app, name) {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'app.asar.unpacked', 'extensions', name)
  }
  return path.join(__dirname, '..', 'extensions', name)
}

function getExtension(name) {
  return getAgentBrowserSession().extensions.getAllExtensions().find((extension) => extension.name === name) ?? null
}

async function loadExtension(app, name, directory) {
  const loaded = getExtension(name)
  if (loaded) return loaded
  return getAgentBrowserSession().extensions.loadExtension(extensionDirectory(app, directory), { allowFileAccess: false })
}

async function loadBuiltInExtensions(app) {
  if (extensionsReady) return extensionsReady

  extensionsReady = Promise.allSettled([
    loadExtension(app, XIAOHONGSHU_EXTENSION_NAME, 'xiaohongshu'),
    loadExtension(app, MATTER_BROWSER_EXTENSION_NAME, 'matter-browser'),
  ]).then(([xiaohongshu, matterBrowser]) => {
    if (xiaohongshu.status === 'rejected') {
      console.error('Failed to load the bundled Xiaohongshu extension:', xiaohongshu.reason)
    }
    if (matterBrowser.status === 'rejected') {
      console.error('Failed to load the bundled Matter Browser extension:', matterBrowser.reason)
    }
    return {
      xiaohongshu: xiaohongshu.status === 'fulfilled' ? xiaohongshu.value : null,
      matterBrowser: matterBrowser.status === 'fulfilled' ? matterBrowser.value : null,
    }
  })
  return extensionsReady
}

function getAgentBrowserSession() {
  const browserSession = session.fromPartition(AGENT_BROWSER_PARTITION)
  if (!browserSessionConfigured) {
    browserSession.setPermissionCheckHandler(() => false)
    browserSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false))
    browserSession.setDevicePermissionHandler?.(() => false)
    browserSession.setDisplayMediaRequestHandler?.((_request, callback) => callback({}))
    browserSession.on('will-download', (event) => event.preventDefault())
    browserSessionConfigured = true
  }
  return browserSession
}

function getLocalSandboxSession() {
  const sandboxSession = session.fromPartition(LOCAL_SANDBOX_PARTITION)
  if (!localSandboxSessionConfigured) {
    sandboxSession.setPermissionCheckHandler(() => false)
    sandboxSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false))
    sandboxSession.setDevicePermissionHandler?.(() => false)
    sandboxSession.setDisplayMediaRequestHandler?.((_request, callback) => callback({}))
    sandboxSession.on('will-download', (event) => event.preventDefault())
    localSandboxSessionConfigured = true
  }
  return sandboxSession
}

function getAgentBrowserExtension() {
  return getExtension(XIAOHONGSHU_EXTENSION_NAME)
}

function getMatterBrowserExtension() {
  return getExtension(MATTER_BROWSER_EXTENSION_NAME)
}

module.exports = {
  AGENT_BROWSER_PARTITION,
  LOCAL_SANDBOX_PARTITION,
  MATTER_BROWSER_EXTENSION_NAME,
  XIAOHONGSHU_EXTENSION_NAME,
  getAgentBrowserExtension,
  getMatterBrowserExtension,
  getAgentBrowserSession,
  getLocalSandboxSession,
  loadBuiltInExtensions,
}
