let busy = false
async function request(action, value) {
  if (busy) return
  busy = true
  try {
    const state = await window.browserSettings.request(action, value)
    if (!state) return
    document.querySelector('#enabled').checked = state.enabled
    document.querySelector('#enabled').disabled = !state.canEnable && !state.enabled
    document.querySelector('#status').textContent = '状态：' + state.state
    document.querySelector('#error').textContent = state.error || ''
    document.querySelector('#device').textContent = state.paired
      ? '已配对 · ' + state.toolCount + ' 件浏览器工具' : '登录后自动配对到当前 Matter 服务'
    document.querySelector('#revoke').disabled = !state.paired
  } catch { document.querySelector('#error').textContent = '无法读取浏览器设置，请重新打开窗口' }
  finally { busy = false }
}
document.querySelector('#enabled').addEventListener('change', event => void request('enable', event.target.checked))
document.querySelector('#revoke').addEventListener('click', () => void request('revoke'))
setInterval(() => { if (!busy) void request('get') }, 1000)
void request('get')
