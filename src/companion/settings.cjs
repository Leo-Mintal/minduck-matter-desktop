const path = require('node:path')
const { createSettingsProtocol } = require('./settings-protocol.cjs')
const { loopbackOrigin } = require('./runtime.cjs')

function createCompanionSettings({ electron, root, core, panel, getLanguage }) {
  const { BrowserWindow, ipcMain, session, shell } = electron
  const { settingsChromeOptions, applySettingsTheme } = require(path.join(root, 'app/settings-chrome.cjs'))
  const partition = 'persist:minduck-companion-settings'
  const coreOrigin = () => core.port ? `http://127.0.0.1:${core.port}` : null
  let window
  let route = '#/pet'
  const listeners = []
  const on = (channel, listener) => { ipcMain.on(channel, listener); listeners.push([channel, listener]) }
  const trusted = (event) => window && event.sender === window.webContents
    && event.senderFrame === window.webContents.mainFrame
  on('settings:language', (event) => { event.returnValue = trusted(event) ? getLanguage() : 'zh' })
  on('settings:update', (event) => { event.returnValue = { auto: false, step: null } })
  on('settings:theme', (event, theme) => {
    if (trusted(event) && /^#[\da-f]{6}$/i.test(theme?.color) && /^#[\da-f]{6}$/i.test(theme?.symbolColor)) {
      applySettingsTheme(window, theme)
    }
  })
  const settingsSession = session.fromPartition(partition)
  settingsSession.protocol.handle('http', createSettingsProtocol({ directory: path.join(root, 'build/console'),
    coreOrigin, core, petOrigin: async () => loopbackOrigin((await panel('state'))?.url) }))
  settingsSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'] },
    (details, answer) => {
      const local = /^(https?|wss?):\/\/127\.0\.0\.1:\d+\//.test(details.url)
      const imageSources = ['https://raw.githubusercontent.com/Pal-AI-Lab/cortico-extensions/',
        'https://avatars.githubusercontent.com/']
      const image = details.resourceType === 'image' && imageSources.some((prefix) => details.url.startsWith(prefix))
      const releaseCheck = details.url === 'https://api.github.com/repos/Pal-AI-Lab/Coopanion/releases/latest'
      answer({ cancel: !(local || image || releaseCheck) })
    })

  function load() {
    if (window && coreOrigin()) void window.loadURL(`${coreOrigin()}/coopanion/${route}`).catch(console.error)
  }

  function guard(contents) {
    contents.setWindowOpenHandler(({ url }) => {
      if (/^https?:\/\//.test(url) && !loopbackOrigin(url)) void shell.openExternal(url)
      return { action: 'deny' }
    })
    contents.on('will-navigate', (event, url) => {
      if (new URL(url).origin === coreOrigin()) return
      event.preventDefault()
      if (/^https?:\/\//.test(url) && !loopbackOrigin(url)) void shell.openExternal(url)
    })
    contents.on('will-frame-navigate', (event) => {
      if (event.isMainFrame || /^about:(blank|srcdoc)$/.test(event.url)) return
      if (loopbackOrigin(event.url) && new URL(event.url).origin !== coreOrigin()) return
      event.preventDefault()
    })
  }

  function open(nextRoute = '') {
    if (/^#\/[\w/?=&%-]*$/.test(nextRoute)) route = nextRoute
    if (window && !window.isDestroyed()) {
      if (nextRoute) load()
      if (window.isMinimized()) window.restore()
      window.show(); window.focus()
      return
    }
    window = new BrowserWindow({ width: 1040, height: 760, minWidth: 760, minHeight: 560,
      title: 'Minduck 桌宠设置', show: false, autoHideMenuBar: true, backgroundColor: '#f4f5f4',
      ...settingsChromeOptions(process.platform), webPreferences: { partition,
        preload: path.join(root, 'app/settings-preload.cjs'), contextIsolation: true, sandbox: true,
        nodeIntegration: false, spellcheck: false } })
    window.once('ready-to-show', () => { window?.show(); window?.focus() })
    window.on('page-title-updated', (event) => event.preventDefault())
    window.on('closed', () => { window = undefined })
    guard(window.webContents)
    if (core.port) load()
    else {
      const page = '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>桌宠设置</title>'
        + '<body style="font:16px system-ui;padding:40px">正在启动桌宠…</body></html>'
      void window.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(page))
    }
  }

  function dispose() {
    window?.destroy()
    for (const [channel, listener] of listeners) ipcMain.removeListener(channel, listener)
    settingsSession.protocol.unhandle('http')
    settingsSession.webRequest.onBeforeRequest(null)
  }

  return { open, load, dispose, close: () => window?.close(), getWindow: () => window }
}

module.exports = { createCompanionSettings }
