const path = require('node:path')
const { pathToFileURL } = require('node:url')
const { app, BrowserWindow, Menu, screen, shell } = require('electron')
const { desktopWindowLayout } = require('./desktopWindowLayout.cjs')
const { matterOrigin, startChromiumBrowser } = require('./chromiumBrowser.cjs')
const { isMatterWebURL } = require('./matterService.cjs')

const MATTER_UNAVAILABLE_PAGE = path.join(__dirname, 'matter-unavailable.html')
const MATTER_UNAVAILABLE_URL = pathToFileURL(MATTER_UNAVAILABLE_PAGE).toString()

let mainWindow
let chromiumBrowser
const configuredMatterURL = matterOrigin()
const configuredMatterOrigin = new URL(configuredMatterURL).origin

function matterDisposition(value) {
  let target
  try {
    target = new URL(value)
  } catch {
    return 'blocked'
  }

  if (target.href === MATTER_UNAVAILABLE_URL || target.href.startsWith(MATTER_UNAVAILABLE_URL + '?')) return 'navigate'
  if (target.origin === configuredMatterOrigin) {
    if (target.pathname.startsWith('/api/') || target.pathname.startsWith('/media/')) return 'download'
    return 'navigate'
  }
  if (target.protocol === 'http:' || target.protocol === 'https:' || target.protocol === 'mailto:') return 'external'
  return 'blocked'
}

function openExternal(url) {
  void shell.openExternal(url).catch((error) => console.error('Failed to open external URL:', error))
}

function configureMatterWindow(window) {
  const { webContents } = window
  let matterLoaded = false
  const showMatterUnavailable = () => {
    if (matterLoaded || webContents.isDestroyed() || webContents.getURL().startsWith(MATTER_UNAVAILABLE_URL)) return
    void webContents.loadFile(MATTER_UNAVAILABLE_PAGE, { query: { origin: configuredMatterOrigin } }).catch((error) => {
      console.error('Failed to show Matter unavailable page:', error)
    })
  }
  const guardNavigation = (details, legacyURL) => {
    const url = typeof details?.url === 'string' ? details.url : legacyURL
    const disposition = matterDisposition(url)
    if (disposition === 'navigate') return
    details.preventDefault()
    if (disposition === 'external') openExternal(url)
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
    if (isMatterWebURL(webContents.getURL(), configuredMatterOrigin)) matterLoaded = true
  })
  webContents.on('did-fail-load', (_event, errorCode, _description, url, isMainFrame) => {
    if (!isMainFrame || errorCode === -3 || !isMatterWebURL(url, configuredMatterOrigin)) return
    showMatterUnavailable()
  })
  return setTimeout(showMatterUnavailable, 8_000)
}

function workAreaFor(window) {
  return screen.getDisplayMatching(window.getBounds()).workArea
}

function startRightBrowser(bounds) {
  if (chromiumBrowser) return chromiumBrowser
  chromiumBrowser = startChromiumBrowser({
    runtime: { isPackaged: app.isPackaged, resourcesPath: process.resourcesPath },
    bounds,
    origin: configuredMatterURL,
  })
  void chromiumBrowser.createMatterBackgroundTab().catch((error) => {
    console.error('Failed to create Chromium background Matter page:', error.message)
  })
  return chromiumBrowser
}

function stopRightBrowser() {
  chromiumBrowser?.stop()
  chromiumBrowser = undefined
}

function arrangeDesktopWindows() {
  if (!mainWindow || mainWindow.isDestroyed()) return
  const layout = desktopWindowLayout(workAreaFor(mainWindow))
  mainWindow.setBounds(layout.matter)
  const browser = startRightBrowser(layout.browser)
  void browser.setBounds(layout.browser).catch((error) => {
    console.error('Failed to arrange Chromium browser window:', error.message)
  })
}

function createWindow() {
  const layout = desktopWindowLayout(screen.getPrimaryDisplay().workArea)
  mainWindow = new BrowserWindow({
    ...layout.matter,
    minWidth: 480,
    minHeight: 600,
    show: false,
    title: 'Minduck Matter',
    titleBarStyle: 'default',
    backgroundColor: '#202124',
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      webviewTag: false,
    },
  })

  const unavailableTimer = configureMatterWindow(mainWindow)
  mainWindow.once('ready-to-show', () => mainWindow?.show())
  mainWindow.on('closed', () => {
    clearTimeout(unavailableTimer)
    mainWindow = undefined
    stopRightBrowser()
  })
  void mainWindow.loadURL(configuredMatterURL).catch((error) => console.error('Failed to load Matter:', error))
  startRightBrowser(layout.browser)
}

function createMenu() {
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: 'Minduck Matter',
        submenu: [{ role: 'about' }, { type: 'separator' }, { role: 'quit' }],
      },
      { role: 'editMenu' },
      {
        label: '窗口',
        submenu: [
          { label: '重新排列 Matter 与浏览器', accelerator: 'CommandOrControl+Shift+R', click: arrangeDesktopWindows },
          { type: 'separator' },
          { role: 'minimize' },
          { role: 'zoom' },
          { role: 'close' },
        ],
      },
    ]),
  )
}

app.whenReady().then(() => {
  createMenu()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('before-quit', stopRightBrowser)
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
