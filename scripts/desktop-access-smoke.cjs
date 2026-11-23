const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

if (!process.versions.electron) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'matter-gate-qa-'))
  const result = spawnSync(require('electron'), [__filename, directory], { stdio: 'inherit', timeout: 120000 })
  fs.rmSync(directory, { recursive: true, force: true })
  if (result.error) console.error(result.error)
  process.exit(result.status ?? 1)
}
const { app, BrowserWindow, dialog } = require('electron')
const { createAccessController } = require('../src/desktop-access/controller.cjs')
const { createGate } = require('../src/desktop-access/gate.cjs')
const native = require('../build/desktop-access/desktop-access.node')
app.setPath('userData', process.argv[2])
app.on('window-all-closed', () => {})
let gate, controller
app.whenReady().then(async () => {
  let starts = 0, consumes = 0, quits = 0, policyChecks = 0
  controller = createAccessController({ intervalMs: 200, service: { policy: async () => { policyChecks++; return true },
    restore: async () => { throw Object.assign(new Error('输入邀请码后即可继续登录或注册'), { code: 'device_unactivated' }) },
    activate: async code => { consumes++; assert.equal(code, 'ABC234') }, renew: async () => {} },
    onActive: async () => { starts++ } })
  gate = createGate({ app: { isPackaged: false, quit: () => { quits++ } }, dialog, controller })
  await controller.start()
  assert.equal(BrowserWindow.getAllWindows().length, 0, 'native gate must not create an HTML window')
  assert.throws(() => native.openPrompt('', '', true), { code: 'prompt_already_open' })
  let timerTicks = 0
  const timer = setInterval(() => { timerTicks++ }, 20)
  if (process.env.MATTER_NATIVE_PROMPT_INTERACTIVE === '1') {
    const started = Date.now()
    while (starts === 0 && quits === 0 && Date.now() - started < 100000) await new Promise(resolve => setTimeout(resolve, 50))
    assert.ok(starts === 1 || quits === 1, 'native prompt interaction timed out')
  } else await new Promise(resolve => setTimeout(resolve, 1500))
  clearInterval(timer)
  assert.ok(timerTicks > 2, 'native prompt must leave the Electron event loop running: ' + timerTicks)
  assert.ok(policyChecks > 2, 'policy checks must continue while the native prompt is open')
  if (starts === 0) assert.equal(consumes, 0)
  gate.dispose(); gate = undefined
  native.openPrompt('测试错误提示', '', false)
  assert.equal(native.pollPrompt(), null)
  native.updatePrompt('', true, true)
  native.closePrompt()
  const result = { passed: true, nativeAppKitPrompt: true, htmlWindows: BrowserWindow.getAllWindows().length,
    eventLoopTicks: timerTicks, policyChecks, starts, consumes, quits, interaction: process.env.MATTER_NATIVE_PROMPT_INTERACTIVE === '1' }
  const { version } = require('../package.json')
  const evidence = path.join(__dirname, '../release', version, 'metadata', 'invite-activation-smoke')
  fs.mkdirSync(evidence, { recursive: true })
  fs.writeFileSync(path.join(evidence, 'gate-smoke.json'), JSON.stringify(result, null, 2) + '\n')
  console.log(JSON.stringify(result))
}).catch(error => { console.error(error); process.exitCode = 1 }).finally(() => {
  gate?.dispose(); controller?.dispose(); native.closePrompt(); app.quit()
})
