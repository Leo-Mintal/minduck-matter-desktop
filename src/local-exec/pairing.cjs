const os = require('node:os')

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
    if (!response.ok) throw new Error(`设备配对请求失败（${response.status}），请确认已登录且后端已启用设备通道`)
    return response.status === 204 ? null : response.json()
  }
  function token() {
    const saved = store.get().pairing
    if (!saved || saved.origin !== origin) return null
    if (!safeStorage.isEncryptionAvailable()) throw new Error('系统钥匙串不可用，本机执行已停用')
    return safeStorage.decryptString(Buffer.from(saved.encryptedToken, 'base64'))
  }
  return {
    token,
    async pair(jwt, account) {
      if (!safeStorage.isEncryptionAvailable()) throw new Error('系统钥匙串不可用，不能保存设备令牌')
      await assertCurrent()
      const issued = await request('/api/extensions/devices/pairings', jwt, { kind })
      await assertCurrent()
      const wsURL = deviceSocketURL(issued.ws_url, origin)
      const previous = store.get().pairing?.account === account ? token() : null
      const result = await request('/api/extensions/device-link/redeem', '', {
        code: issued.code, device_name: deviceName, browser: 'Matter Desktop',
        extension_version: version, ...(previous ? { previous_device_token: previous } : {}),
      })
      if (typeof result.device_token !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(result.device_id)) throw new Error('配对响应无效')
      deviceSocketURL(result.ws_url, origin)
      try { await assertCurrent() } catch (error) {
        await request('/api/extensions/device-link/self', result.device_token, undefined, 'DELETE').catch(() => {})
        throw error
      }
      store.update({ pairing: { deviceId: result.device_id, encryptedToken: safeStorage.encryptString(result.device_token).toString('base64'),
        origin, wsURL, account } })
      return store.get().pairing
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
