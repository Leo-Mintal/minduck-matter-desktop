let busy = false, canEnable = false
async function request(action, value) {
  if (busy) return
  busy = true
  for (const control of document.querySelectorAll('button, input')) control.disabled = true
  try {
    const state = await window.localSettings.request(action, value)
    if (!state) return
    canEnable = state.canEnable
    document.querySelector('#enabled').checked = state.enabled
    document.querySelector('#network').checked = state.allowNetwork
    document.querySelector('#login-hint').hidden = state.canEnable
    document.querySelector('#status').textContent = `状态：${state.state}`
    document.querySelector('#error').textContent = state.error || ''
    document.querySelector('#root').textContent = state.root
    document.querySelector('#conversation').textContent = state.conversationId || '请在 Matter 主窗口打开具体会话'
    const grants = document.querySelector('#grants')
    grants.replaceChildren()
    for (const directory of state.grants) {
      const row = document.createElement('p')
      const text = document.createElement('span'); text.textContent = directory
      const button = document.createElement('button'); button.textContent = '移除'; button.className = 'b b-tertiary b-pill b-md'
      button.addEventListener('click', () => void request('remove-folder', directory))
      row.append(text, button); grants.append(row)
    }
  } catch { document.querySelector('#error').textContent = '无法读取本机设置，请重新打开窗口' }
  finally {
    busy = false
    for (const control of document.querySelectorAll('button, input')) control.disabled = false
    document.querySelector('#enabled').disabled = !canEnable
  }
}
document.querySelector('#enabled').addEventListener('change', event => void request('enable', event.target.checked))
document.querySelector('#network').addEventListener('change', event => void request('network', event.target.checked))
for (const button of document.querySelectorAll('[data-action]')) button.addEventListener('click', () => void request(button.dataset.action))
setInterval(() => { if (!busy) void request('get') }, 2000)
void request('get')
