const path = require('node:path')

function settingsDetail(state, error = '') {
  const lines = [
    '私有部署或本地开发时可修改服务根地址，保存后将重启应用。',
    `当前生效：${state.effectiveOrigin}`,
    `默认地址：${state.defaultOrigin}`,
  ]
  if (state.environmentOrigin) {
    lines.push(`当前由环境变量 MINDUCK_MATTER_ORIGIN 控制：${state.environmentOrigin}。请移除该环境变量后再修改。`)
  } else if (state.environmentError) {
    lines.push(`MINDUCK_MATTER_ORIGIN 配置无效，已忽略：${state.environmentError}`)
  }
  if (error) lines.push(error)
  return lines.join('\n\n')
}

function createMatterServiceSettings({ app, dialog, getWindow, getState, saveOrigin, restart, nativeModule }) {
  let native = nativeModule, opened = false, timer
  function close() {
    clearInterval(timer)
    timer = undefined
    if (opened) native.closeServiceSettings()
    opened = false
  }
  function fail(error) {
    close()
    dialog.showErrorBox('无法配置 Matter 服务地址', error.message || String(error))
  }
  function refresh(error = '') {
    const state = getState()
    native.updateServiceSettings(settingsDetail(state, error), !state.environmentOrigin)
  }
  function poll() {
    try {
      const response = native.pollServiceSettings()
      if (!response) return
      if (response.action === 'cancel') { close(); return }
      if (!['save', 'reset'].includes(response.action)) return
      if (getState().environmentOrigin) { refresh(); return }
      try {
        saveOrigin(response.action === 'reset' ? null : response.origin)
      } catch (error) {
        refresh(error.message || String(error))
        return
      }
      close()
      restart()
    } catch (error) { fail(error) }
  }
  function show() {
    try {
      if (opened) { native.focusServiceSettings(); return }
      native ||= require(app.isPackaged
        ? path.join(process.resourcesPath, 'native', 'desktop-access.node')
        : path.join(__dirname, '../build/desktop-access/desktop-access.node'))
      const state = getState(), window = getWindow()
      const parent = window && !window.isDestroyed() ? window.getNativeWindowHandle() : null
      native.openServiceSettings(state.configuredOrigin || state.defaultOrigin,
        settingsDetail(state), !state.environmentOrigin, parent)
      opened = true
      timer = setInterval(poll, 50)
    } catch (error) { fail(error) }
  }
  return { show, close }
}

module.exports = { createMatterServiceSettings }
