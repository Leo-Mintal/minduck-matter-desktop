const path = require('node:path')
const { pathToFileURL } = require('node:url')

function createBrowserSettings({ BrowserWindow, ipcMain, controller, getWindow }) {
  const page = path.join(__dirname, 'settings.html'), url = pathToFileURL(page).href
  let window
  ipcMain.handle('matter-browser:settings', async (event, action, value) => {
    if (!window || window.isDestroyed() || event.sender !== window.webContents
      || event.senderFrame !== window.webContents.mainFrame || event.sender.getURL() !== url) return null
    try {
      if (action === 'enable') await controller.setEnabled(value)
      else if (action === 'revoke') await controller.revoke()
      else if (action !== 'get') throw new Error('未知浏览器设置操作')
      return controller.snapshot()
    } catch (error) { return { ...controller.snapshot(), error: error.message } }
  })
  return {
    open() {
      if (window && !window.isDestroyed()) { window.show(); window.focus(); return }
      window = new BrowserWindow({ width: 560, height: 480, minWidth: 360, minHeight: 360, show: false,
        title: '内置浏览器设置', parent: getWindow(), webPreferences: {
          preload: path.join(__dirname, 'settings-preload.cjs'), contextIsolation: true,
          sandbox: true, nodeIntegration: false, webSecurity: true,
        } })
      window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
      window.webContents.on('will-navigate', event => event.preventDefault())
      window.webContents.on('will-redirect', event => event.preventDefault())
      window.once('ready-to-show', () => { window.show(); window.focus() })
      window.on('closed', () => { window = undefined })
      void window.loadFile(page)
    },
    dispose() { ipcMain.removeHandler('matter-browser:settings'); if (window && !window.isDestroyed()) window.close() },
  }
}

module.exports = { createBrowserSettings }
