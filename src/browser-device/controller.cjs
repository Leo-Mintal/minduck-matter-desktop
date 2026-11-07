const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const { privateWrite } = require('../local-exec/store.cjs')
const { createPairing, deviceSocketURL } = require('../local-exec/pairing.cjs')
const { connectDesktop } = require('../local-exec/connection.cjs')
const { tokenAccount } = require('../local-exec/contract.cjs')
const { createTools } = require('./tools.cjs')

function createStore(userData) {
  const filename = path.join(userData, 'browser-device', 'settings.json')
  let value = { enabled: true, pairing: null }
  try {
    const parsed = JSON.parse(fs.readFileSync(filename, 'utf8'))
    if (!parsed || typeof parsed.enabled !== 'boolean' || (parsed.pairing !== null
      && (!parsed.pairing || typeof parsed.pairing.account !== 'string' || typeof parsed.pairing.origin !== 'string'
        || typeof parsed.pairing.deviceId !== 'string' || typeof parsed.pairing.encryptedToken !== 'string'))) throw new Error('浏览器设置无效')
    value = { enabled: parsed.enabled, pairing: parsed.pairing }
  } catch (error) {
    if (error.code !== 'ENOENT') value = { enabled: false, pairing: null, error: '浏览器设置无法读取，请重新开启' }
  }
  return { get: () => value, update(patch) {
    const next = { ...value, ...patch }
    privateWrite(filename, next); value = next
    return value
  } }
}

function createBrowserDevice({ app, safeStorage, fetchImpl, origin, getContents, compatibility,
  extensionRoot, nativeImage, store = createStore(app.getPath('userData')), connect = connectDesktop, tools }) {
  const toolkit = tools || createTools({ compatibility, extensionRoot, origin, fetchImpl, nativeImage })
  let account = '', state = store.get().error || '等待登录', connection, disposed = false, refreshing = false
  let generation = 0, retryAt = 0, failure = store.get().error || ''
  let lastIdentity, lastContents
  async function identity() {
    const contents = getContents()
    if (!contents || contents.isDestroyed() || new URL(contents.getURL() || 'about:blank').origin !== origin) return { account: '', token: '' }
    let token
    try { token = await contents.executeJavaScriptInIsolatedWorld(1002, [{ code: "localStorage.getItem('matter.token') || ''" }]) }
    catch { return { account: '', token: '' } }
    lastContents = contents
    lastIdentity = { token, account: tokenAccount(token) }
    return lastIdentity
  }
  function stop(next) {
    generation++; connection?.stop(); toolkit.release?.(); connection = undefined; state = next
  }
  async function assertActive(expected, expectedAccount, allowDialog = false) {
    if (disposed || !store.get().enabled || generation !== expected || !expectedAccount || account !== expectedAccount) {
      throw new Error('浏览器已关闭、账号已变化或操作已取消')
    }
    // A native JS dialog pauses renderer evaluation. Only its handler may use the
    // last verified identity while that exact document is paused by the dialog.
    const contents = getContents()
    const current = allowDialog ? (contents === lastContents && !contents?.isDestroyed()
      && new URL(contents.getURL() || 'about:blank').origin === origin
      && tokenAccount(lastIdentity?.token) === expectedAccount ? lastIdentity : { account: '' }) : await identity()
    if (disposed || !store.get().enabled || generation !== expected || !expectedAccount
      || account !== expectedAccount || current.account !== expectedAccount) throw new Error('浏览器已关闭、账号已变化或操作已取消')
  }
  function pairingFor(expected, expectedAccount) {
    return createPairing({ store, safeStorage, fetchImpl, origin, version: toolkit.version, kind: 'browser',
      deviceName: os.hostname() + ' · Matter 内置浏览器', assertCurrent: () => assertActive(expected, expectedAccount) })
  }
  function open(expected, expectedAccount, pairing) {
    connection = connect({ url: deviceSocketURL(store.get().pairing.wsURL, origin), token: pairing.token(), deviceId: store.get().pairing.deviceId,
      version: toolkit.version, tools: toolkit.schemas, mcpResults: true, maxActive: 1,
      serverName: 'matter-desktop-browser', capabilities: { tools: {} },
      execute: async (params, signal) => {
        const check = () => assertActive(expected, expectedAccount,
          params.name === 'chrome_handle_dialog' && toolkit.isDialogOpen?.(params.arguments?.tabId))
        await check()
        return toolkit.execute(params, signal, check)
      },
      onState: next => { if (generation === expected) state = next },
      onRevoked: () => {
        if (generation !== expected) return
        stop('配对已失效，请重新开启'); store.update({ enabled: false, pairing: null })
      },
    })
  }
  async function refresh() {
    if (disposed || refreshing) return
    const contents = getContents()
    if (!contents || contents.isDestroyed()) return
    refreshing = true
    try {
      const current = await identity()
      if (disposed) return
      if (current.account !== account) {
        const previous = account
        account = current.account
        stop(account ? '连接中' : '请先登录 Matter')
        if (previous || (store.get().pairing && (store.get().pairing.account !== account
          || store.get().pairing.origin !== origin))) store.update({ enabled: false })
        retryAt = 0
      }
      if (!store.get().enabled) { state = '已关闭'; return }
      if (!account || connection || Date.now() < retryAt) return
      const expected = generation, expectedAccount = account
      const pairing = pairingFor(expected, expectedAccount)
      if (!store.get().pairing || store.get().pairing.account !== account || store.get().pairing.origin !== origin) {
        state = '正在配对内置浏览器'
        await pairing.pair(current.token, account)
      }
      await assertActive(expected, expectedAccount)
      open(expected, expectedAccount, pairing)
      failure = ''
    } catch (error) {
      if (!disposed && store.get().enabled) { state = '连接失败'; failure = error.message; retryAt = Date.now() + 30000 }
    } finally { refreshing = false }
  }
  const timer = setInterval(() => void refresh(), 1000)
  timer.unref()
  return {
    refresh,
    snapshot() { return { enabled: store.get().enabled, canEnable: Boolean(account), state, error: failure,
      paired: Boolean(store.get().pairing && store.get().pairing.account === account && store.get().pairing.origin === origin),
      deviceId: store.get().pairing?.account === account ? store.get().pairing.deviceId : '', toolCount: toolkit.schemas.length } },
    async setEnabled(enabled) {
      if (typeof enabled !== 'boolean') throw new Error('浏览器开关值无效')
      stop(enabled ? '连接中' : '已关闭'); failure = ''; retryAt = 0
      store.update({ enabled, error: '' })
      if (enabled) await refresh()
    },
    async revoke() {
      stop('已关闭'); store.update({ enabled: false })
      await pairingFor(generation, account).revoke()
      failure = ''
    },
    async presenceDeviceId() {
      const current = await identity()
      const saved = store.get().pairing
      return !disposed && store.get().enabled && state === '在线' && current.account === account
        && saved?.account === account && saved.origin === origin ? saved.deviceId : ''
    },
    notifyTabUpdated: (tab, changeInfo) => toolkit.notifyTabUpdated?.(tab, changeInfo),
    suspend() { stop('等待窗口恢复') },
    dispose() { disposed = true; clearInterval(timer); stop('已关闭') },
  }
}

module.exports = { createBrowserDevice, createStore }
