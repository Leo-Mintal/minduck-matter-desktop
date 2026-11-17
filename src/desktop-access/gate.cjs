const path = require('node:path')

function presentNativePrompt({ app, error, code, editable, nativeModule }) {
  const native = nativeModule || require(app.isPackaged
    ? path.join(process.resourcesPath, 'native', 'desktop-access.node')
    : path.join(__dirname, '../../build/desktop-access/desktop-access.node'))
  native.openPrompt(error, code, editable)
  let finish, timer
  const result = new Promise((resolve, reject) => {
    finish = resolve
    timer = setInterval(() => {
      try {
        const response = native.pollPrompt()
        if (response) { clearInterval(timer); resolve(response) }
      } catch (error) {
        clearInterval(timer); native.closePrompt(); reject(error)
      }
    }, 50)
  })
  return { result, focus: () => native.focusPrompt(),
    update: options => native.updatePrompt(options.error, options.editable, options.inputEnabled), close() {
    clearInterval(timer)
    const response = native.pollPrompt()
    native.closePrompt(); finish(response || { action: 'dismissed' })
  } }
}

function createGate({ app, controller, dialog, presentPrompt = options => presentNativePrompt({ app, ...options }) }) {
  let prompt, disposed = false, submitting = false, code = '', quitting = false
  const message = state => state.status === 'revoked' ? '本机激活资格已过期，请输入新的邀请码。'
    : ['unactivated', 'checking'].includes(state.status) ? '' : state.message
  function quit() {
    if (disposed || quitting) return
    quitting = true
    controller.dispose?.()
    app.quit()
  }
  function show() {
    const state = controller.snapshot()
    if (disposed || submitting || quitting || ['checking', 'active'].includes(state.status)) return
    if (prompt) { prompt.focus(); return }
    try {
      prompt = presentPrompt({ code, editable: state.status !== 'unsupported', error: message(state) })
    } catch (error) { fail(error); return }
    const current = prompt
    void current.result.then(async response => {
      if (disposed) return
      if (response.action === 'quit') { quit(); return }
      if (prompt !== current) return
      prompt = undefined
      if (response.action !== 'confirm') return
      code = String(response.code || '').trim().toUpperCase()
      submitting = true
      try { await controller.activate(code) } finally { submitting = false }
      show()
    }).catch(fail)
  }
  function fail(error) {
    if (disposed) return
    prompt?.close(); prompt = undefined
    dialog?.showErrorBox('无法显示激活弹窗', error.message || '请重新安装应用后重试')
    quit()
  }
  const unsubscribe = controller.subscribe(state => {
    if (state.status === 'active') { prompt?.close(); prompt = undefined; code = ''; return }
    if (prompt) {
      prompt.update({ editable: ['unactivated', 'retryable_error', 'revoked'].includes(state.status),
        inputEnabled: state.status !== 'unsupported', error: message(state) })
      return
    }
    show()
  })
  return { show, dispose() { disposed = true; unsubscribe(); prompt?.close(); prompt = undefined; code = '' } }
}
module.exports = { createGate, presentNativePrompt }
