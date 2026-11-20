const assert = require('node:assert/strict')
const test = require('node:test')
const { createMatterServiceSettings } = require('../src/matterServiceSettings.cjs')
const { DEFAULT_MATTER_ORIGIN, normalizeMatterOrigin } = require('../src/matterService.cjs')

function fixture(t) {
  const calls = { opened: [], saved: [], errors: [], updated: [], closed: 0, focused: 0, restarted: 0 }
  const state = { defaultOrigin: DEFAULT_MATTER_ORIGIN, effectiveOrigin: 'http://192.168.11.70:8080',
    configuredOrigin: 'http://192.168.11.70:8080', environmentOrigin: null }
  let response, saveError
  const parent = Buffer.alloc(8)
  const nativeModule = {
    openServiceSettings(...args) { calls.opened.push(args) },
    pollServiceSettings() { const value = response; response = undefined; return value },
    updateServiceSettings(...args) { calls.updated.push(args) },
    focusServiceSettings() { calls.focused++ },
    closeServiceSettings() { calls.closed++ },
  }
  const controller = createMatterServiceSettings({ app: { isPackaged: false }, nativeModule,
    dialog: { showErrorBox(...args) { calls.errors.push(args) } },
    getWindow: () => ({ isDestroyed: () => false, getNativeWindowHandle: () => parent }), getState: () => state,
    saveOrigin(origin) {
      if (saveError) throw saveError
      calls.saved.push(origin === null ? null : normalizeMatterOrigin(origin))
    }, restart() { calls.restarted++ } })
  t.after(() => controller.close())
  return { calls, state, controller, nativeModule, parent, failSave(error) { saveError = error },
    async respond(action, origin) { response = { action, origin }; await new Promise(resolve => setTimeout(resolve, 75)) } }
}

test('service settings opens a single native prompt and focuses repeated requests', t => {
  const f = fixture(t)
  f.controller.show(); f.controller.show()
  assert.equal(f.calls.opened.length, 1)
  assert.equal(f.calls.focused, 1)
  const [origin, detail, editable, parent] = f.calls.opened[0]
  assert.equal(origin, f.state.configuredOrigin)
  assert.match(detail, /当前生效：http:\/\/192\.168\.11\.70:8080/)
  assert.ok(detail.includes(DEFAULT_MATTER_ORIGIN))
  assert.equal(editable, true)
  assert.equal(parent, f.parent)
})

test('native save validates and persists the address before restarting', async t => {
  const f = fixture(t); f.controller.show()
  await f.respond('save', ' https://private.example.com/ ')
  assert.deepEqual(f.calls.saved, ['https://private.example.com'])
  assert.equal(f.calls.restarted, 1)
  assert.equal(f.calls.closed, 1)
})

test('invalid input and disk failures keep the prompt open and never restart', async t => {
  const f = fixture(t); f.controller.show()
  await f.respond('save', 'http://untrusted.example.com')
  assert.match(f.calls.updated.at(-1)[0], /请填写 HTTPS 服务根地址/)
  f.failSave(new Error('无法写入设置文件'))
  await f.respond('save', 'https://private.example.com')
  assert.match(f.calls.updated.at(-1)[0], /无法写入设置文件/)
  assert.equal(f.calls.updated.at(-1)[1], true)
  assert.equal(f.calls.opened.length, 1, 'errors must preserve the same native input')
  assert.equal(f.calls.closed, 0)
  assert.equal(f.calls.restarted, 0)
  assert.deepEqual(f.calls.saved, [])
})

test('reset restores the packaged default and cancel leaves settings untouched', async t => {
  const f = fixture(t); f.controller.show()
  await f.respond('reset')
  assert.deepEqual(f.calls.saved, [null])
  assert.equal(f.calls.restarted, 1)
  const g = fixture(t); g.controller.show()
  await g.respond('cancel')
  assert.deepEqual(g.calls.saved, [])
  assert.equal(g.calls.restarted, 0)
  assert.equal(g.calls.closed, 1)
})

test('valid environment override locks editing and is rechecked on save and reset', async t => {
  const f = fixture(t)
  f.state.environmentOrigin = 'https://managed.example.com'
  f.controller.show()
  assert.equal(f.calls.opened[0][2], false)
  assert.match(f.calls.opened[0][1], /MINDUCK_MATTER_ORIGIN 控制/)
  await f.respond('save', 'https://private.example.com')
  await f.respond('reset')
  assert.deepEqual(f.calls.saved, [])
  assert.equal(f.calls.restarted, 0)
  assert.equal(f.calls.updated.at(-1)[1], false)
  const g = fixture(t); g.controller.show()
  g.state.environmentOrigin = 'https://managed.example.com'
  await g.respond('save', 'https://private.example.com')
  assert.deepEqual(g.calls.saved, [])
})

test('an ignored invalid environment override still permits saving', async t => {
  const f = fixture(t)
  f.state.environmentError = '无效的 HTTPS 网址'
  f.controller.show()
  assert.equal(f.calls.opened[0][2], true)
  assert.match(f.calls.opened[0][1], /配置无效，已忽略/)
  await f.respond('save', 'https://private.example.com')
  assert.equal(f.calls.restarted, 1)
})

test('closing disposes polling and native failures are surfaced without restarting', async t => {
  const f = fixture(t); f.controller.show(); f.controller.close()
  await f.respond('save', 'https://private.example.com')
  assert.deepEqual(f.calls.saved, [])
  assert.equal(f.calls.closed, 1)
  const g = fixture(t)
  g.nativeModule.openServiceSettings = () => { throw new Error('原生模块不可用') }
  g.controller.show()
  assert.equal(g.calls.errors[0][1], '原生模块不可用')
  assert.equal(g.calls.restarted, 0)
})
