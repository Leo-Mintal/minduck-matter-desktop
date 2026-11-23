const fs = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')
const { inside, canonical } = require('./workspace.cjs')

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
  const iCloud = path.join(home, 'Library/Mobile Documents/com~apple~CloudDocs')
  if (inside(iCloud, filename)) return { root: iCloud, label: 'iCloud 云盘' }
  const cloudStorage = path.join(home, 'Library/CloudStorage')
  if (inside(cloudStorage, filename) && filename !== cloudStorage) {
    const provider = path.relative(cloudStorage, filename).split(path.sep)[0]
    return { root: path.join(cloudStorage, provider), label: provider }
  }
  return null
}

function accessDeniedResult(filename, error, { label = filename, commandExecuted = false, partial = false } = {}) {
  return { status: 'os_access_denied', denied: true, permission: 'filesystem', path: filename,
    permission_required: true, denial_source: 'unknown', error_code: error.code,
    command_executed: commandExecuted, may_have_partial_effects: partial, retryable: false,
    message: `Matter 未获得访问“${label}”的权限，相关操作已停止。如果你刚才点击了“不允许”，本次拒绝已生效。可在系统设置 → 隐私与安全性中检查相应权限后重新发起任务。访问失败原因尚不能确认，请勿重复申请或换写法绕过。` }
}

// Only a concrete filesystem access may cause macOS to display its own prompt.
// A successful probe is not a persistent Matter grant or proof of write access.
async function probePath(filename, denied, fileSystem = fs) {
  let resolved = await canonical(filename), stat
  if (denied.some(root => inside(root, resolved))) throw new Error('敏感路径禁止访问')
  for (;;) {
    try { stat = await fileSystem.stat(resolved); break }
    catch (error) {
      const parent = path.dirname(resolved)
      if (error.code !== 'ENOENT' || parent === resolved) throw error
      resolved = parent
    }
  }
  if (stat.isDirectory()) {
    const directory = await fileSystem.opendir(resolved, { bufferSize: 1 })
    try { await directory.read() } finally { await directory.close() }
  } else {
    const file = await fileSystem.open(resolved, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK)
    try { if (!(await file.stat()).isFile()) throw new Error('只支持普通文件或目录') }
    finally { await file.close() }
  }
}

function createNativeAccess({ home = os.homedir(), denied = [], probeAccess = filename => probePath(filename, denied) } = {}) {
  const pending = new Map(), refusals = new Map()
  return {
    clear() { pending.clear(); refusals.clear() },
    async request(requested, { attempt = '', validate = async () => {} } = {}) {
      const expanded = requested?.startsWith('~/') ? path.join(home, requested.slice(2)) : requested
      if (typeof expanded !== 'string' || !path.isAbsolute(expanded) || expanded.includes('\0')) throw new Error('权限申请必须指定绝对路径或 ~/ 路径')
      const filename = path.resolve(expanded)
      if (denied.some(root => inside(root, filename))) throw new Error('敏感路径禁止访问')
      const resource = systemFolderFor(filename, home) || { root: filename, label: filename }
      const key = JSON.stringify([attempt, resource.root])
      await validate()
      if (refusals.has(key)) return { ...refusals.get(key), path: filename }
      let probe = pending.get(resource.root)
      if (!probe) {
        probe = Promise.resolve().then(() => probeAccess(resource.root)).then(() => ({ status: 'granted', permission: 'filesystem',
          permission_required: false, command_executed: false, may_have_partial_effects: false,
          message: '已确认当前可以访问此系统资源；具体文件的读写仍受系统权限和命令沙箱限制。本次未执行任务命令。' }), error => {
          if (!['EACCES', 'EPERM'].includes(error.code)) throw error
          return accessDeniedResult(filename, error, resource)
        })
        pending.set(resource.root, probe)
      }
      let result
      try { result = await probe }
      finally { if (pending.get(resource.root) === probe) pending.delete(resource.root) }
      await validate()
      if (result.denied) {
        refusals.set(key, result)
        if (refusals.size > 1000) refusals.delete(refusals.keys().next().value)
      }
      return { ...result, path: filename, resource: resource.root }
    },
  }
}

module.exports = { systemFolderFor, createNativeAccess, accessDeniedResult }
