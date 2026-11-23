function localExecStatus(snapshot = {}) {
  const state = snapshot.state || '正在初始化'
  let label = '本机连接中', tone = 'pending'
  if (state === '在线') { label = '本机已连接'; tone = 'online' }
  else if (state.includes('完全磁盘访问')) { label = '等待系统授权'; tone = 'warning' }
  else if (state.includes('登录')) { label = '请先登录'; tone = 'muted' }
  else if (state.includes('撤销') || state.includes('失败') || state.includes('不可信') || state.includes('无法')
    || state.includes('不可用') || state.includes('无效') || state.includes('已关闭') || state.includes('仅支持')) {
    label = '本机未连接'; tone = 'warning'
  } else if (state === '离线') { label = '本机重连中'; tone = 'pending' }
  const retrySeconds = Math.max(0, Math.ceil(((snapshot.retryAt || 0) - Date.now()) / 1000))
  if (retrySeconds > 0 && !snapshot.enabled) { label = '本机连接失败'; tone = 'warning' }
  return { label, tone, detail: state, retrySeconds,
    needsPermission: state.includes('完全磁盘访问'), canRetry: snapshot.canRetry === true && state !== '在线' }
}

module.exports = { localExecStatus }
