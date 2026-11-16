const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

if (!process.versions.electron) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'matter-gate-qa-'))
  const result = spawnSync(require('electron'), [__filename, directory], { stdio: 'inherit', timeout: 30000 })
  fs.rmSync(directory, { recursive: true, force: true })
  if (result.error) console.error(result.error)
  process.exit(result.status ?? 1)
}
const { app, BrowserWindow, ipcMain } = require('electron')
const { createAccessController } = require('../src/desktop-access/controller.cjs')
const { createGate } = require('../src/desktop-access/gate.cjs')
const userData = process.argv[2]
app.setPath('userData', userData)
// The harness substitutes business startup with a counter, so keep the test
// process alive when activation closes its only visible window.
app.on('window-all-closed', () => {})
let gate, controller
app.whenReady().then(async () => {
  let active = false, revoked = false, starts = 0, stops = 0, updates = 0, quits = 0, consumes = 0
  controller = createAccessController({ service: { policy: async () => true,
    restore: async () => { throw Object.assign(new Error('输入邀请码后即可继续登录或注册'), { code: 'device_unactivated' }) },
    activate: async code => { consumes++; if (code !== 'ABC234') throw new Error('邀请码不可用'); active = true },
    renew: async () => { if (revoked) throw Object.assign(new Error('本机激活资格已被吊销'), { code: 'device_revoked' }) } },
    onActive: async () => { starts++ }, onBlocked: async () => { stops++ } })
  gate = createGate({ app: { quit: () => { quits++ } }, BrowserWindow, ipcMain, controller, checkUpdate: () => { updates++ } })
  await controller.check()
  let window = BrowserWindow.getAllWindows()[0]
  const loaded = async win => { if (win.webContents.isLoading()) await new Promise(resolve => win.webContents.once('did-finish-load', resolve)) }
  await loaded(window)
  await window.webContents.executeJavaScript(`new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`)
  assert.equal(starts, 0)
  const geometry = await window.webContents.executeJavaScript(`({height:innerHeight,scrollHeight:document.documentElement.scrollHeight,bottom:document.querySelector('#update').getBoundingClientRect().bottom,inputEnabled:!document.querySelector('#invite-code').disabled})`)
  assert.equal(geometry.inputEnabled, true)
  assert.ok(geometry.bottom <= geometry.height, 'activation controls clipped: '+JSON.stringify(geometry))
  assert.ok(geometry.scrollHeight <= geometry.height, 'activation window scrolls: '+JSON.stringify(geometry))
  const evidence = path.join(__dirname, '../release/metadata/invite-activation-20261116')
  fs.mkdirSync(evidence, { recursive: true })
  fs.writeFileSync(path.join(evidence, 'gate.png'), (await window.webContents.capturePage()).toPNG())
  await window.webContents.executeJavaScript(`document.querySelector('#update').click();document.querySelector('#quit').click()`)
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(updates, 1); assert.equal(quits, 1)
  const intruder = new BrowserWindow({ show: false, webPreferences: { preload: path.join(__dirname, '../src/desktop-access/gate-preload.cjs'), contextIsolation: true, sandbox: true } })
  await intruder.loadFile(path.join(__dirname, '../src/desktop-access/gate.html'))
  assert.equal(await intruder.webContents.executeJavaScript(`window.desktopActivation.submit('ABC234')`), null)
  assert.equal(consumes, 0); intruder.destroy()
  await window.webContents.executeJavaScript(`document.querySelector('#invite-code').value='abc234';document.querySelector('#invite-code').dispatchEvent(new Event('input'));document.querySelector('#activation-form').requestSubmit()`)
  for (let i=0;i<100 && !active;i++) await new Promise(resolve=>setTimeout(resolve,10))
  for (let i=0;i<100 && !window.isDestroyed();i++) await new Promise(resolve=>setTimeout(resolve,10))
  assert.equal(active,true);assert.equal(consumes,1);assert.equal(starts,1);assert.equal(window.isDestroyed(),true)
  revoked=true;await controller.check()
  assert.equal(stops,1);assert.equal(controller.snapshot().status,'revoked')
  window=BrowserWindow.getAllWindows()[0];await loaded(window)
  assert.equal(await window.webContents.executeJavaScript(`document.querySelector('#invite-code').disabled`),true)
  fs.writeFileSync(path.join(evidence,'gate-smoke.json'),JSON.stringify({passed:true,geometry,starts,stops,consumes,updates,quits,foreignSenderRejected:true},null,2)+'\n')
  console.log(JSON.stringify({passed:true,geometry,starts,stops,foreignSenderRejected:true}))
}).catch(error => { console.error(error); process.exitCode=1 }).finally(() => {
  controller?.dispose();gate?.dispose()
  for(const window of BrowserWindow.getAllWindows())window.destroy()
  app.quit()
})
