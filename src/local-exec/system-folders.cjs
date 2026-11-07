const fs = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')
const { inside } = require('./workspace.cjs')

const FILES_AND_FOLDERS_SETTINGS_URL = 'x-apple.systempreferences:com.apple.preference.security?Privacy_FilesAndFolders'
const SYSTEM_FOLDERS = { Desktop: '桌面', Documents: '文稿', Downloads: '下载' }

function systemFolderFor(requested, home = os.homedir()) {
  if (typeof requested !== 'string') return null
  const expanded = requested.startsWith('~/') ? path.join(home, requested.slice(2)) : requested
  if (!path.isAbsolute(expanded)) return null
  const filename = path.resolve(expanded)
  for (const [name, label] of Object.entries(SYSTEM_FOLDERS)) {
    const root = path.join(home, name)
    if (inside(root, filename)) return { root, label }
  }
  return null
}

// The signed main process requests macOS access before starting a restricted worker.
// Read at most one directory entry to trigger TCC; never return names to the model.
async function requestSystemFolder({ root, label }, fileSystem = fs) {
  let directory
  try {
    if (await fileSystem.realpath(root) !== root) return false
    directory = await fileSystem.opendir(root, { bufferSize: 1 })
    await directory.read()
    return true
  } catch (error) {
    if (error.code === 'ENOENT') return false
    if (!['EACCES', 'EPERM'].includes(error.code)) throw error
    throw Object.assign(new Error(`macOS 未允许 Matter 访问“${label}”。请在本机执行设置中点击“文件与文件夹权限…”，为 Minduck Matter 开启对应目录后重试。已拒绝的系统权限不能强制重新弹出；不要换写法绕过。`), { denied: true })
  } finally {
    if (directory) await directory.close()
  }
}

module.exports = { FILES_AND_FOLDERS_SETTINGS_URL, systemFolderFor, requestSystemFolder }
