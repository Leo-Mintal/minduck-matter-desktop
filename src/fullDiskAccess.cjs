const fs = require('node:fs')

const FULL_DISK_ACCESS_SETTINGS_URL = 'x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles'
const FULL_DISK_ACCESS_PROBE_PATH = '/Library/Application Support/com.apple.TCC/TCC.db'

function hasFullDiskAccess({ platform = process.platform, openSync = fs.openSync, closeSync = fs.closeSync, probePath = FULL_DISK_ACCESS_PROBE_PATH } = {}) {
  if (platform !== 'darwin') return false
  let descriptor
  try {
    // Open without reading database contents: access/stat alone can report false positives.
    descriptor = openSync(probePath, fs.constants.O_RDONLY)
    return true
  } catch {
    return false
  } finally {
    if (descriptor !== undefined) closeSync(descriptor)
  }
}

function shouldPromptForFullDiskAccess({ platform, promptedThisSession, permissionGranted = false }) {
  return platform === 'darwin'
    && !promptedThisSession
    && permissionGranted !== true
}

function createPermissionPrompt({ dialog, shell, getWindow, platform = process.platform, check = hasFullDiskAccess }) {
  let promptedThisSession = false
  return async function requestPermission() {
    if (!shouldPromptForFullDiskAccess({ platform, promptedThisSession, permissionGranted: check({ platform }) })) return
    promptedThisSession = true
    const options = {
      type: 'info', title: '完全磁盘访问', message: '允许 Minduck Matter 访问电脑上的文件',
      detail: '请在系统设置中为 Minduck Matter 开启“完全磁盘访问”。开启后，Matter 可按你的任务执行命令和读写文件，结果会回传 Matter 服务。macOS 要求你亲自开启此权限；以后启动会自动沿用系统授权。',
      buttons: ['打开系统设置', '稍后'], defaultId: 0, cancelId: 1, noLink: true,
    }
    const window = getWindow?.()
    const result = window && !window.isDestroyed()
      ? await dialog.showMessageBox(window, options) : await dialog.showMessageBox(options)
    if (result.response === 0) await shell.openExternal(FULL_DISK_ACCESS_SETTINGS_URL)
  }
}

module.exports = {
  FULL_DISK_ACCESS_SETTINGS_URL,
  FULL_DISK_ACCESS_PROBE_PATH,
  hasFullDiskAccess,
  shouldPromptForFullDiskAccess,
  createPermissionPrompt,
}
