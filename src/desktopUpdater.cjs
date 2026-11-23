const { compareVersions, parseVersion, LATEST_DMG_URL } = require('./updateCheck.cjs')

const UPDATE_BASE_URL = 'https://matter-desktop.yogeeai.com/download/'
const NATIVE_PREPARE_TIMEOUT_MS = 120_000

function validateUpdateInfo(info) {
  parseVersion(info?.version)
  const prefix = `MinduckMatter-${info.version}-arm64`
  if (!Array.isArray(info.files) || !info.files.length || info.files.length > 2) {
    throw new Error('更新清单缺少安装文件')
  }
  const names = new Set()
  for (const file of info.files) {
    if (![`${prefix}.zip`, `${prefix}.dmg`].includes(file.url) || names.has(file.url)) {
      throw new Error('更新安装文件地址无效')
    }
    if (typeof file.sha512 !== 'string' || !/^[A-Za-z0-9+/]{86}==$/.test(file.sha512)
      || !Number.isSafeInteger(file.size) || file.size <= 0) throw new Error('更新文件校验信息无效')
    names.add(file.url)
  }
  if (!names.has(`${prefix}.zip`)) throw new Error('更新清单缺少 ZIP 安装文件')
  return info
}

function macUpdateRuntime(app, platform = process.platform, arch = process.arch) {
  if (!app.isPackaged) return { unavailableReason: '开发预览不安装更新，请在正式安装的客户端中使用。' }
  if (platform !== 'darwin' || arch !== 'arm64') {
    return { unavailableReason: '当前仅支持 Apple Silicon macOS 客户端的应用内更新。' }
  }
  if (!app.isInApplicationsFolder()) {
    return { unavailableReason: '请先将 Minduck Matter 安装到“应用程序”，再使用应用内更新。' }
  }
  const { MacUpdater } = require('electron-updater')
  const updater = new MacUpdater({ provider: 'generic', url: UPDATE_BASE_URL, useMultipleRangeRequest: false })
  updater.autoDownload = false
  updater.autoInstallOnAppQuit = false
  updater.autoRunAppAfterInstall = true
  updater.allowDowngrade = false
  updater.allowPrerelease = false
  updater.disableDifferentialDownload = true
  return { updater, nativeUpdater: require('electron').autoUpdater }
}

// MacUpdater serves its checksum-verified ZIP on an authenticated loopback feed.
// Await Squirrel's signature verification before stopping the running companion.
function prepareNativeUpdate(nativeUpdater, timeoutMs = NATIVE_PREPARE_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const finish = (error) => {
      clearTimeout(timer)
      nativeUpdater.removeListener('update-downloaded', ready)
      nativeUpdater.removeListener('error', failed)
      if (error) reject(error)
      else resolve()
    }
    const ready = () => finish()
    const failed = (error) => finish(error)
    const timer = setTimeout(() => finish(new Error('系统准备更新超时，请重试')), timeoutMs)
    nativeUpdater.once('update-downloaded', ready)
    nativeUpdater.once('error', failed)
    try { nativeUpdater.checkForUpdates() } catch (error) { finish(error) }
  })
}

function createDesktopUpdater(options) {
  const { updater, nativeUpdater, unavailableReason, currentVersion, showDialog,
    onState = () => {}, hasActiveTasks = () => false, prepareToQuit = async () => {}, logger = console } = options
  let state = { phase: 'idle', checking: false, available: false, error: false, percent: 0 }
  let checking, action, nativeReady = false
  const publish = (patch) => { state = { ...state, ...patch }; onState({ ...state }); return { ...state } }
  const fail = (error) => {
    logger.error('客户端更新失败:', error.message)
    return publish({ phase: 'error', checking: false, error: true, message: '更新未完成，请稍后重试。' })
  }
  updater?.on('error', (error) => {
    logger.error('更新器:', error.message)
    if (!checking && !action) fail(error)
  })
  updater?.on('download-progress', (progress) => publish({ phase: 'downloading',
    percent: Math.max(0, Math.min(100, Math.floor(progress.percent || 0))) }))

  function check() {
    if (checking) return checking
    if (action || ['downloading', 'downloaded', 'preparing', 'installing'].includes(state.phase)) {
      return Promise.resolve({ ...state })
    }
    if (!updater) return Promise.resolve(publish({ phase: 'unsupported', message: unavailableReason }))
    publish({ phase: 'checking', checking: true, error: false, message: '' })
    checking = (async () => {
      try {
        const result = await updater.checkForUpdates()
        if (!result) throw new Error('更新检查未完成')
        const available = result.isUpdateAvailable === true
          && compareVersions(result.updateInfo.version, currentVersion) > 0
        if (available) validateUpdateInfo(result.updateInfo)
        return publish({ phase: available ? 'available' : 'idle', checking: false, available,
          version: available ? result.updateInfo.version : '', error: false })
      } catch (error) { return fail(error) }
      finally { checking = undefined }
    })()
    return checking
  }

  async function confirmRestart() {
    if (!hasActiveTasks()) return true
    const result = await showDialog({ type: 'warning', title: '重启更新', message: '当前有任务正在进行',
      detail: '重启会中断当前客户端和本机操作。你可以稍后点击更新按钮继续安装。',
      buttons: ['仍然重启更新', '稍后'], defaultId: 1, cancelId: 1, noLink: true })
    return result.response === 0
  }

  async function install() {
    const previouslyActive = hasActiveTasks()
    if (!await confirmRestart()) return
    publish({ phase: 'preparing', error: false, message: '正在验证签名并准备安装' })
    if (!nativeReady) { await prepareNativeUpdate(nativeUpdater); nativeReady = true }
    if (!previouslyActive && hasActiveTasks() && !await confirmRestart()) {
      publish({ phase: 'downloaded', message: '' }); return
    }
    await prepareToQuit()
    publish({ phase: 'installing', message: '正在重启更新' })
    updater.quitAndInstall()
  }

  async function performAction() {
    if (!updater) {
      await showDialog({ type: 'info', title: '客户端更新', message: '暂不能在此处安装更新',
        detail: unavailableReason, buttons: ['知道了'], noLink: true })
      return
    }
    if (state.phase === 'downloaded') { await install(); return }
    const result = await check()
    if (result.error) throw new Error(result.message)
    if (!result.available) {
      await showDialog({ type: 'info', title: '检查更新', message: '当前已是最新版本',
        detail: `当前版本 ${currentVersion}`, buttons: ['知道了'], noLink: true })
      return
    }
    const confirmation = await showDialog({ type: 'info', title: '发现新版本',
      message: `发现新版本 ${state.version}`,
      detail: '在浏览器中下载最新版 macOS 安装包，也可以选择在应用内更新并重启。',
      buttons: ['下载最新版', '稍后', '应用内更新并重启'], defaultId: 0, cancelId: 1, noLink: true })
    if (confirmation.response === 0) {
      await options.openExternal(LATEST_DMG_URL)
      return
    }
    if (confirmation.response !== 2) return
    nativeReady = false
    publish({ phase: 'downloading', percent: 0, error: false, message: '' })
    await updater.downloadUpdate()
    publish({ phase: 'downloaded', percent: 100 })
    await install()
  }

  function run() {
    if (action || ['downloading', 'preparing', 'installing'].includes(state.phase)) return action || Promise.resolve()
    action = performAction().catch(async (error) => {
      const downloaded = ['downloaded', 'preparing', 'installing'].includes(state.phase)
      fail(error)
      await showDialog({ type: 'error', title: '更新失败', message: '更新未完成，当前版本仍可继续使用',
        detail: downloaded ? '系统未能完成安装准备。请稍后点击更新按钮重试。' : '请检查网络后点击更新按钮重试。',
        buttons: ['知道了'], noLink: true })
    }).finally(() => { action = undefined })
    return action
  }

  return { check, run, snapshot: () => ({ ...state }) }
}

module.exports = { UPDATE_BASE_URL, validateUpdateInfo, macUpdateRuntime, prepareNativeUpdate, createDesktopUpdater }
