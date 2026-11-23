const test = require('node:test')
const assert = require('node:assert/strict')
const { createGate, presentNativePrompt } = require('../src/desktop-access/gate.cjs')
const { createAccessController } = require('../src/desktop-access/controller.cjs')

function fixture() {
  let failure = '', listener, state = { status: 'checking', message: '' }, quits = 0, disposals = 0, retries = 0
  const prompts = [], codes = []
  const controller = { snapshot: () => state, dispose() { disposals++; listener = undefined },
    subscribe(fn) { listener = fn; fn(state); return () => { listener = undefined } },
    async check() { retries++; state = { status: 'unactivated', message: '' }; listener?.(state) },
    async activate(code) { codes.push(code); state = failure ? { status: 'invite_error', message: failure } : { status: 'active' }; listener?.(state) } }
  const gate = createGate({ app: { quit() { quits++ } }, controller, presentPrompt(options) {
    let resolve
    const prompt = { options, result: new Promise(done => { resolve = done }), close() { this.closed = true; resolve({ action: 'dismissed' }); return this.draft },
      focus() { this.focused = true }, update(options) { Object.assign(this.options, options) }, respond(value) { resolve(value) } }
    prompts.push(prompt); return prompt
  } })
  return { gate, prompts, codes, failNext(message) { failure = message }, get quits() { return quits },
    get disposals() { return disposals }, get retries() { return retries },
    change(status, message = '') { state = { status, message }; listener?.(state) } }
}
const settle = () => new Promise(resolve => setImmediate(resolve))

test('native gate waits for policy, opens one prompt, and submits through the existing controller', async () => {
  const f = fixture()
  assert.equal(f.prompts.length, 0)
  f.change('unactivated', '请输入邀请码激活本机')
  assert.equal(f.prompts.length, 1)
  assert.equal(f.prompts[0].options.error, '')
  f.gate.show(); assert.equal(f.prompts.length, 1); assert.equal(f.prompts[0].focused, true)
  f.prompts[0].respond({ action: 'confirm', code: ' abc234 ' }); await settle()
  assert.deepEqual(f.codes, ['ABC234']); assert.equal(f.quits, 0)
  f.gate.dispose()
})

test('native gate exits without consuming a code and closes on disposal', async () => {
  const f = fixture(); f.change('unactivated')
  f.prompts[0].respond({ action: 'quit' }); await settle()
  assert.equal(f.quits, 1); assert.deepEqual(f.codes, [])
  assert.equal(f.disposals, 1, 'quit must stop policy checks before application shutdown')
  f.gate.dispose()
  const g = fixture(); g.change('unactivated'); g.gate.dispose(); await settle()
  assert.equal(g.prompts[0].closed, true); assert.equal(g.quits, 0); assert.deepEqual(g.codes, [])
})

test('a queued native quit wins when a policy result closes the prompt before polling', async () => {
  let state = { status: 'unactivated' }, listener, quits = 0, closed = 0, pending
  const nativeModule = { openPrompt() {}, updatePrompt() {}, focusPrompt() {},
    pollPrompt() { const response = pending; pending = null; return response }, closePrompt() { closed++ } }
  const controller = { snapshot: () => state, dispose() { listener = undefined },
    subscribe(fn) { listener = fn; fn(state); return () => { listener = undefined } } }
  const gate = createGate({ app: { quit() { quits++ } }, controller,
    presentPrompt: options => presentNativePrompt({ app: {}, ...options, nativeModule }) })
  pending = { action: 'quit' }
  state = { status: 'active' }; listener(state)
  await settle()
  assert.equal(quits, 1, 'closing the prompt must not discard a click already received by AppKit')
  assert.equal(closed, 1)
  gate.dispose()
})

test('quit during an in-flight policy check cannot start business when the response arrives late', async () => {
  let checks = 0, starts = 0, quits = 0, release, respond
  const controller = createAccessController({ service: {
    policy: async () => ++checks === 1 ? true : new Promise(resolve => { release = resolve }),
    restore: async () => { throw Object.assign(new Error('not activated'), { code: 'device_unactivated' }) },
  }, onActive: async () => { starts++ } })
  const gate = createGate({ app: { quit() { quits++ } }, controller, presentPrompt() {
    return { result: new Promise(resolve => { respond = resolve }), update() {}, focus() {}, close() {} }
  } })
  await controller.check()
  const pending = controller.check()
  respond({ action: 'quit' }); await settle()
  assert.equal(quits, 1)
  release(false); await pending
  assert.equal(starts, 0)
  gate.dispose()
})

test('native gate preserves input and permits a new invite after device access expires', async () => {
  const f = fixture(); f.change('unactivated')
  f.failNext('邀请码不可用')
  f.prompts[0].respond({ action: 'confirm', code: 'ABC234' }); await settle()
  assert.equal(f.prompts.length, 2)
  assert.equal(f.prompts[1].options.error, '邀请码不可用')
  assert.equal(f.prompts[1].options.code, 'ABC234')
  f.change('checking')
  assert.equal(f.prompts[1].options.editable, false)
  assert.equal(f.prompts[1].options.inputEnabled, true)
  f.change('revoked', '本机激活资格已被吊销')
  assert.equal(f.prompts[1].options.editable, true)
  assert.equal(f.prompts[1].options.inputEnabled, true)
  assert.equal(f.prompts[1].options.error, '本机激活资格已过期，请输入新的邀请码。')
  f.change('active'); await settle(); assert.equal(f.prompts[1].closed, true)
  f.change('revoked', '本机激活资格已被吊销')
  assert.equal(f.prompts.at(-1).options.editable, true)
  assert.equal(f.prompts.at(-1).options.error, '本机激活资格已过期，请输入新的邀请码。')
  f.prompts.at(-1).respond({ action: 'confirm', code: 'DEF567' }); await settle()
  assert.deepEqual(f.codes, ['ABC234', 'DEF567'])
  f.change('unsupported')
  assert.equal(f.prompts.at(-1).options.title, '无法验证客户端激活资格')
  f.gate.dispose()
})

test('network failures show a retry prompt and preserve the invite draft', async () => {
  const f = fixture(); f.change('unactivated')
  f.prompts[0].draft = 'ABC'
  f.change('retryable_error', '网络不可用')
  assert.equal(f.prompts[0].closed, true)
  assert.equal(f.prompts[1].options.title, '暂时无法连接激活服务')
  f.prompts[1].respond({ action: 'confirm', code: 'ignored' })
  await settle()
  assert.equal(f.retries, 1)
  assert.deepEqual(f.codes, [])
  assert.equal(f.prompts[2].options.title, '')
  assert.equal(f.prompts[2].options.code, 'ABC')
  f.change('active', '网络不可用')
  f.gate.show()
  assert.equal(f.prompts.length, 3)
  assert.equal(f.prompts[2].closed, true)
  f.gate.dispose()
})

test('an allowed policy never opens a prompt and a late native result cannot activate after disposal', async () => {
  const f = fixture(); f.change('active'); f.gate.show()
  assert.equal(f.prompts.length, 0); f.gate.dispose()
  const g = fixture(); g.change('unactivated'); g.gate.dispose()
  g.prompts[0].respond({ action: 'confirm', code: 'ABC234' }); await settle()
  assert.deepEqual(g.codes, [])
})

test('a native dialog failure exits without starting the application', () => {
  let quits = 0, shown
  const gate = createGate({ app: { quit() { quits++ } },
    controller: { snapshot: () => ({ status: 'unactivated' }), subscribe(fn) { fn({ status: 'unactivated' }); return () => {} } },
    presentPrompt() { throw new Error('native module unavailable') },
    dialog: { showErrorBox(title, message) { shown = { title, message } } } })
  assert.equal(quits, 1); assert.equal(shown.message, 'native module unavailable'); gate.dispose()
})
