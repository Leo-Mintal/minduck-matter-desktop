const path = require('node:path')

function presentNativePrompt({ app, error, code, editable, title, nativeModule }) {
  const native = nativeModule || require(app.isPackaged
    ? path.join(process.resourcesPath, 'native', 'desktop-access.node')
    : path.join(__dirname, '../../build/desktop-access/desktop-access.node'))
  native.openPrompt(error, code, editable, title || '')
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
    const draft = native.closePrompt()
    finish(response || { action: 'dismissed' })
    return response?.code ?? draft
  } }
}

function createGate({ app, controller, dialog, presentPrompt = options => presentNativePrompt({ app, ...options }) }) {
  let prompt, promptTitle, disposed = false, submitting = false, code = '', quitting = false
  const message = state => state.status === 'revoked' ? '本机激活资格已过期，请输入新的邀请码。'
    : ['unactivated', 'checking'].includes(state.status) ? '' : state.message
  function title(state) {
    if (['unactivated', 'revoked', 'invite_error'].includes(state.status)) return ''
    return state.status === 'retryable_error' ? '暂时无法连接激活服务' : '无法验证客户端激活资格'
  }
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
    const currentTitle = title(state)
    try {
      prompt = presentPrompt({ code, editable: true, error: message(state), title: currentTitle })
      promptTitle = currentTitle
    } catch (error) { fail(error); return }
    const current = prompt
    void current.result.then(async response => {
      if (disposed) return
      if (response.action === 'quit') { quit(); return }
      if (prompt !== current) return
      prompt = undefined
      if (response.action !== 'confirm') return
      submitting = true
      try {
        if (currentTitle) await controller.check()
        else {
          code = String(response.code || '').trim().toUpperCase()
          await controller.activate(code)
        }
      } finally { submitting = false }
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
      if (state.status === 'checking' || promptTitle === title(state)) {
        prompt.update({ editable: state.status !== 'checking', inputEnabled: true, error: message(state) })
        return
      }
      const draft = prompt.close()
      if (!promptTitle && typeof draft === 'string') code = draft
      prompt = undefined
    }
    show()
  })
  return { show, dispose() { disposed = true; unsubscribe(); prompt?.close(); prompt = undefined; code = '' } }
}
module.exports = { createGate, presentNativePrompt }
