const path = require('node:path')
const { pathToFileURL } = require('node:url')
const { FULL_DISK_ACCESS_SETTINGS_URL } = require('../fullDiskAccess.cjs')
const { FILES_AND_FOLDERS_SETTINGS_URL } = require('./system-folders.cjs')

function createSettings({ BrowserWindow, ipcMain, controller, getWindow, shell }) {
  const page = path.join(__dirname, 'settings.html')
  const url = pathToFileURL(page).href
  let window
  const trusted = event => window && !window.isDestroyed() && event.sender === window.webContents
    && event.senderFrame === window.webContents.mainFrame && event.sender.getURL() === url
  ipcMain.handle('matter-local:settings', async (event, action, value) => {
    if (!trusted(event)) return null
    try {
      switch (action) {
        case 'get': break
        case 'enable': if (typeof value !== 'boolean') throw new Error('开关值无效'); await controller.setEnabled(value); break
        case 'network': controller.setNetworkAllowed(value); break
        case 'privacy': await shell.openExternal(FULL_DISK_ACCESS_SETTINGS_URL); break
        case 'privacy-files': await shell.openExternal(FILES_AND_FOLDERS_SETTINGS_URL); break
        case 'root': await controller.chooseRoot(); break
        case 'add-folder': await controller.addFolder(); break
        case 'remove-folder': if (typeof value !== 'string') throw new Error('目录无效'); controller.removeFolder(value); break
        case 'open-folder': await shell.openPath(await controller.currentFolder()); break
        case 'revoke': await controller.revoke(); break
        default: throw new Error('未知设置操作')
      }
      return controller.snapshot()
    } catch (error) { return { ...controller.snapshot(), error: error.message } }
  })
  return {
    open() {
      if (window && !window.isDestroyed()) { window.show(); window.focus(); return }
      window = new BrowserWindow({ width: 560, height: 680, minWidth: 360, minHeight: 420, show: false, title: '本机执行设置', parent: getWindow(),
        webPreferences: { preload: path.join(__dirname, 'settings-preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false, webSecurity: true } })
      window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
      window.webContents.on('will-navigate', event => event.preventDefault())
      window.webContents.on('will-redirect', event => event.preventDefault())
      window.once('ready-to-show', () => { window.show(); window.focus(); controller.acknowledgeSetup() })
      window.on('closed', () => { window = undefined })
      void window.loadFile(page)
    },
    dispose() { ipcMain.removeHandler('matter-local:settings'); if (window && !window.isDestroyed()) window.close() },
  }
}

module.exports = { createSettings }
