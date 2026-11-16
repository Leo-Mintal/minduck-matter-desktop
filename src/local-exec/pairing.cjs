const os = require('node:os')
// Both controllers may recreate their pairing helper between retries. Keep one
// attempt per store/account/origin/kind, without persisting a plaintext code.
const attempts = new WeakMap()

function deviceSocketURL(value, origin) {
  const url = new URL(value)
  const service = new URL(origin)
  const expectedProtocol = service.protocol === 'https:' ? 'wss:' : 'ws:'
  if (url.protocol !== expectedProtocol || url.host !== service.host || url.pathname !== '/api/extensions/device-link/ws'
    || url.username || url.password || url.search || url.hash) throw new Error('服务端返回的设备连接地址不可信')
  return url.href
}

function createPairing({ store, safeStorage, fetchImpl, origin, version, kind = 'desktop',
  deviceName = os.hostname() + ' · Matter 桌面端', assertCurrent = () => {} }) {
  async function request(route, token, body, method = 'POST') {
    const response = await fetchImpl(origin + route, {
      method, redirect: 'error', signal: AbortSignal.timeout(15000),
      headers: { ...(token ? { Authorization: 'Bearer ' + token } : {}), 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
    if (!response.ok) {
      if (method === 'DELETE' && [404, 410].includes(response.status)) return null
      const detail = response.status === 429 ? '未完成的配对已达上限，等待旧配对过期后自动重试'
        : response.status === 401 ? '登录已失效，请重新登录 Matter'
          : '请检查服务地址、网络和后端设备通道'
      const retrySeconds = Number(response.headers?.get('Retry-After'))
      throw Object.assign(new Error(`设备配对请求失败（${response.status}）：${detail}`), {
        status: response.status,
        retryAfterMs: response.status === 429 ? (retrySeconds > 0 ? retrySeconds * 1000 : 600000) : 0,
      })
    }
    return response.status === 204 ? null : response.json()
  }
  function token() {
    const saved = store.get().pairing
    if (!saved || saved.origin !== origin) return null
    if (!safeStorage.isEncryptionAvailable()) throw new Error('系统钥匙串不可用，本机执行已停用')
    return safeStorage.decryptString(Buffer.from(saved.encryptedToken, 'base64'))
  }
  function pendingPatch(attempt, pending) {
    const pendingPairings = { ...store.get().pendingPairings }
    if (pending) pendingPairings[attempt.key] = pending
    else delete pendingPairings[attempt.key]
    return { pendingPairings }
  }
  async function cancelPending(attempt, jwt) {
    if (!attempt.pending) return
    await request('/api/extensions/devices/pairings/' + encodeURIComponent(attempt.pending.id), jwt, undefined, 'DELETE')
    store.update(pendingPatch(attempt, null))
    attempt.pending = null
  }
  async function pairOnce(jwt, account, attempt) {
    let result
    await assertCurrent()
    // Never issue a second code while cleanup of the first is still failing.
    await cancelPending(attempt, jwt)
    try {
      const issued = await request('/api/extensions/devices/pairings', jwt, { kind }).catch(error => {
        // A lost response can hide a successfully issued code. Do not create a
        // new one every polling interval; allow the unknown code's TTL to pass.
        if (!error.status) error.retryAfterMs = 600000
        throw error
      })
      if (typeof issued.id === 'string') {
        attempt.pending = { id: issued.id }
        store.update(pendingPatch(attempt, attempt.pending))
      }
      await assertCurrent()
      const wsURL = deviceSocketURL(issued.ws_url, origin)
      const previous = store.get().pairing?.account === account ? token() : null
      result = await request('/api/extensions/device-link/redeem', '', {
        code: issued.code, device_name: deviceName, browser: 'Matter Desktop',
        extension_version: version, ...(previous ? { previous_device_token: previous } : {}),
      })
      if (typeof result.device_token !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(result.device_id)) throw new Error('配对响应无效')
      deviceSocketURL(result.ws_url, origin)
      await assertCurrent()
      store.update({ pairing: { deviceId: result.device_id, encryptedToken: safeStorage.encryptString(result.device_token).toString('base64'),
        origin, wsURL, account }, ...pendingPatch(attempt, null) })
      attempt.pending = null
      return store.get().pairing
    } catch (error) {
      // Also revoke credentials issued just before cancellation or a failed save.
      if (typeof result?.device_token === 'string') {
        await request('/api/extensions/device-link/self', result.device_token, undefined, 'DELETE').catch(() => {})
      }
      try { await cancelPending(attempt, jwt) } catch {
        throw Object.assign(new Error(error.message + '；未完成配对暂未回收，下次先重试回收'), { retryAfterMs: error.retryAfterMs })
      }
      throw error
    }
  }
  return {
    token,
    pair(jwt, account) {
      if (!safeStorage.isEncryptionAvailable()) return Promise.reject(new Error('系统钥匙串不可用，不能保存设备令牌'))
      let sessions = attempts.get(store)
      if (!sessions) { sessions = new Map(); attempts.set(store, sessions) }
      const key = JSON.stringify([origin, account, kind])
      let attempt = sessions.get(key)
      if (!attempt) {
        const saved = store.get().pendingPairings?.[key]
        const pending = typeof saved?.id === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(saved.id) ? { id: saved.id } : null
        attempt = { key, pending, flight: null }; sessions.set(key, attempt)
      }
      if (!attempt.flight) {
        attempt.flight = pairOnce(jwt, account, attempt).finally(() => {
          attempt.flight = null
          if (!attempt.pending) sessions.delete(key)
        })
      }
      return attempt.flight
    },
    async revoke() {
      const credential = token()
      // Keep the credential if revocation fails so the user can retry safely.
      if (credential) await request('/api/extensions/device-link/self', credential, undefined, 'DELETE')
      store.update({ pairing: null, enabled: false, allowNetwork: false, grants: {}, workspaces: {} })
    },
  }
}

module.exports = { deviceSocketURL, createPairing }
