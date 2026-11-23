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
  let value = { pairing: null }
  try {
    const parsed = JSON.parse(fs.readFileSync(filename, 'utf8'))
    if (!parsed || (parsed.pairing !== null
      && (!parsed.pairing || typeof parsed.pairing.account !== 'string' || typeof parsed.pairing.origin !== 'string'
        || typeof parsed.pairing.deviceId !== 'string' || typeof parsed.pairing.encryptedToken !== 'string'))) throw new Error('浏览器设置无效')
    // Ignore the retired enable switch; only reuse validated credentials.
    value = { pairing: parsed.pairing, pendingPairings: parsed.pendingPairings
      && typeof parsed.pendingPairings === 'object' && !Array.isArray(parsed.pendingPairings) ? parsed.pendingPairings : {} }
  } catch { /* Missing or corrupt credentials are paired again after login. */ }
  return { get: () => value, update(patch) {
    const next = { ...value, ...patch }
    privateWrite(filename, next); value = next
    return value
  } }
}

function createBrowserDevice({ app, safeStorage, fetchImpl, origin, getContents, compatibility,
  extensionRoot, nativeImage, store = createStore(app.getPath('userData')), connect = connectDesktop, tools }) {
  const toolkit = tools || createTools({ compatibility, extensionRoot, origin, fetchImpl, nativeImage })
  let account = '', state = '等待登录', connection, disposed = false, refreshing = false
  let generation = 0, retryAt = 0, failure = '', blockedAccount = ''
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
    if (disposed || generation !== expected || !expectedAccount || account !== expectedAccount || blockedAccount === account) {
      throw new Error('浏览器已关闭、账号已变化或操作已取消')
    }
    // A native JS dialog pauses renderer evaluation. Only its handler may use the
    // last verified identity while that exact document is paused by the dialog.
    const contents = getContents()
    const current = allowDialog ? (contents === lastContents && !contents?.isDestroyed()
      && new URL(contents.getURL() || 'about:blank').origin === origin
      && tokenAccount(lastIdentity?.token) === expectedAccount ? lastIdentity : { account: '' }) : await identity()
    if (disposed || generation !== expected || !expectedAccount || blockedAccount === account
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
      onRevoked: code => {
        if (generation !== expected) return
        stop('浏览器连接已失效')
        if (code !== 4002) store.update({ pairing: null })
        if (code === 4001) { retryAt = Date.now() + 30000; return }
        blockedAccount = account
        state = code === 4002 ? '浏览器已由其他客户端接管，请重新登录 Matter' : '浏览器连接已撤销，请重新登录 Matter'
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
        account = current.account
        stop(account ? '连接中' : '请先登录 Matter')
        blockedAccount = ''; failure = ''; retryAt = 0
      }
      if (!account || blockedAccount === account || connection || Date.now() < retryAt) return
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
      if (!disposed) { state = '连接失败'; failure = error.message; retryAt = Date.now() + (error.retryAfterMs || 30000) }
    } finally { refreshing = false }
  }
  const timer = setInterval(() => void refresh(), 1000)
  timer.unref()
  return {
    refresh,
    snapshot() { return { state, error: failure,
      paired: Boolean(store.get().pairing && store.get().pairing.account === account && store.get().pairing.origin === origin),
      deviceId: store.get().pairing?.account === account ? store.get().pairing.deviceId : '', toolCount: toolkit.schemas.length } },
    async presenceDeviceId() {
      const current = await identity()
      const saved = store.get().pairing
      return !disposed && state === '在线' && current.account === account
        && saved?.account === account && saved.origin === origin ? saved.deviceId : ''
    },
    notifyTabUpdated: (tab, changeInfo) => toolkit.notifyTabUpdated?.(tab, changeInfo),
    suspend() { stop('等待窗口恢复') },
    dispose() { disposed = true; clearInterval(timer); stop('已关闭') },
  }
}

module.exports = { createBrowserDevice, createStore }
