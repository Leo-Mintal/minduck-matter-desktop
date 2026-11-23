// Isolated render/IPC regression; never opens the user's installed profile.
if (!process.versions.electron) {
  const result = require('node:child_process').spawnSync(require('electron'), [__filename], { stdio: 'inherit', timeout: 30000 })
  if (result.error) console.error(result.error)
  process.exit(result.status ?? 1)
}
const { app, BrowserWindow, ipcMain } = require('electron')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const assert = require('node:assert/strict')
const { localExecStatus } = require('../src/local-exec/status.cjs')
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'matter-local-status-'))
app.setPath('userData', path.join(temporary, 'profile'))
app.whenReady().then(async () => {
  const window = new BrowserWindow({ show: false, webPreferences: {
    preload: path.resolve(__dirname, '../src/desktop-frame-preload.cjs'), sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false,
  } })
  const commands = []
  ipcMain.handle('desktop-frame:get-state', () => null)
  ipcMain.on('desktop-frame:command', (_event, type) => commands.push(type))
  await window.loadFile(path.resolve(__dirname, '../src/desktop-frame.html'))
  const cases = [
    { state: '在线', enabled: true }, { state: '请先登录 Matter' },
    { state: '请在系统设置开启完全磁盘访问' }, { state: '离线', enabled: true },
    { state: '设备配对请求失败（429）：未完成的配对已达上限', retryAt: Date.now() + 60000, canRetry: true },
  ]
  for (const width of [375, 768, 1024, 1440]) for (const theme of ['light', 'dark']) for (const snapshot of cases) {
    window.setContentSize(width, 400)
    const localExec = localExecStatus(snapshot)
    window.webContents.send('desktop-frame:state', { theme, rightPanelOpen: false, localExec, update: {}, navigation: {} })
    // Wait for the IPC event and the renderer frame rather than assuming sync delivery.
    await window.webContents.executeJavaScript('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
    const view = await window.webContents.executeJavaScript(`({
      status: document.querySelector('#local-exec-status'),
      text: document.body.innerText,
      scroll: document.documentElement.scrollWidth,
      viewport: innerWidth,
    })`)
    assert.equal(view.status, null)
    assert.doesNotMatch(view.text, /本机已连接|本机能力已就绪|等待系统授权|本机连接中/)
    assert.ok(view.scroll <= width)
    if (width === 768) {
      await window.webContents.executeJavaScript('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
      fs.writeFileSync(path.join(temporary, theme + '-' + localExec.tone + '.png'), (await window.webContents.capturePage()).toPNG())
    }
  }
  assert.deepEqual(commands, [])
  window.destroy()
  console.log('PASS: 5 connection states × 4 widths × light/dark; no clipping and no capability status banner. Evidence:', temporary)
  app.exit(0)
}).catch(error => { console.error(error); app.exit(1) })
