const api = window.desktopActivation
const input = document.querySelector('#invite-code')
const confirm = document.querySelector('#confirm')
const retry = document.querySelector('#retry')
let current
function render(state) {
  if (!state) return
  current = state.status
  const editable = ['unactivated', 'retryable_error'].includes(current)
  input.disabled = !editable
  confirm.disabled = !editable || input.value.trim().length !== 6
  confirm.hidden = !editable
  retry.hidden = !['retryable_error', 'unsupported'].includes(current)
  document.querySelector('#message').textContent = state.message ||
    (current === 'checking' ? '正在检查本机激活状态…' : current === 'unactivated' ? '输入邀请码后即可继续登录或注册' : '')
}
input.addEventListener('input', () => {
  input.value = input.value.replace(/[^a-zA-Z0-9]/g, '').toUpperCase()
  confirm.disabled = input.value.length !== 6 || !['unactivated', 'retryable_error'].includes(current)
})
document.querySelector('#activation-form').addEventListener('submit', async event => {
  event.preventDefault()
  if (confirm.disabled) return
  const code = input.value
  render({ status: 'checking' })
  try { render(await api.submit(code)) } catch { render({ status: 'retryable_error', message: '激活检查失败，请重试' }) }
})
retry.addEventListener('click', async () => {
  render({ status: 'checking' })
  try { render(await api.retry()) } catch { render({ status: 'retryable_error', message: '激活检查失败，请重试' }) }
})
document.querySelector('#quit').addEventListener('click', () => api.quit())
document.querySelector('#update').addEventListener('click', () => api.update())
api.changed(render)
api.state().then(render).catch(() => render({ status: 'retryable_error', message: '激活检查失败，请重试' }))
