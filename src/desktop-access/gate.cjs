const path = require('node:path')
const { pathToFileURL } = require('node:url')

function createGate({ app, BrowserWindow, ipcMain, controller, checkUpdate = () => {} }) {
  const filename = path.join(__dirname, 'gate.html')
  const url = pathToFileURL(filename).href
  let window, unsubscribe
  const own = event => Boolean(window && !window.isDestroyed() && event.sender === window.webContents &&
    event.senderFrame === event.sender.mainFrame && event.senderFrame.url === url)
  ipcMain.handle('desktop-access:state', event => own(event) ? controller.snapshot() : null)
  ipcMain.handle('desktop-access:submit', (event, code) => own(event) && typeof code === 'string' && code.length <= 32
    ? controller.activate(code) : null)
  ipcMain.handle('desktop-access:retry', event => own(event) ? controller.check() : null)
  ipcMain.on('desktop-access:quit', event => { if (own(event)) app.quit() })
  ipcMain.on('desktop-access:update', event => { if (own(event)) void checkUpdate() })
  function show() {
    if (controller.snapshot().status === 'active') return
    if (window && !window.isDestroyed()) { window.show(); window.focus(); return }
    window = new BrowserWindow({ width: 460, height: 360, useContentSize: true, minWidth: 400, minHeight: 340, resizable: false,
      title: '激活 Minduck Matter', backgroundColor: '#161719', autoHideMenuBar: true,
      webPreferences: { preload: path.join(__dirname, 'gate-preload.cjs'), contextIsolation: true,
        nodeIntegration: false, sandbox: true, webSecurity: true } })
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    window.webContents.on('will-navigate', event => event.preventDefault())
    window.webContents.on('will-redirect', event => event.preventDefault())
    window.on('closed', () => { window = undefined })
    void window.loadFile(filename)
  }
  unsubscribe = controller.subscribe(state => {
    if (state.status === 'active') { window?.close(); return }
    show()
    if (window && !window.isDestroyed()) window.webContents.send('desktop-access:changed', state)
  })
  return { show, dispose() {
    unsubscribe?.(); window?.destroy(); window = undefined
    for (const key of ['state', 'submit', 'retry']) ipcMain.removeHandler('desktop-access:' + key)
    ipcMain.removeAllListeners('desktop-access:quit'); ipcMain.removeAllListeners('desktop-access:update')
  } }
}
module.exports = { createGate }
