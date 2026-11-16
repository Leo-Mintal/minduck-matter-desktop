const crypto = require('node:crypto')
const { normalizeMatterOrigin } = require('../matterService.cjs')
const AUTH_PATHS = new Set(['login', 'register', 'send-verification-code', 'verify-code', 'forgot-password', 'reset-password'])

function signingText(origin, purpose, method, pathname, challenge, body) {
  return ['matter-desktop-access-v1', origin, purpose, method, pathname, challenge.id, challenge.nonce,
    crypto.createHash('sha256').update(body).digest('hex')].join('\n')
}
function createService({ origin, keys, fetchImpl = globalThis.fetch }) {
  origin = normalizeMatterOrigin(origin)
  let required = true
  async function request(pathname, options = {}) {
    const response = await fetchImpl(new URL(pathname, origin), { ...options, redirect: 'error', signal: AbortSignal.timeout(10000),
      headers: { 'Content-Type': 'application/json', ...options.headers } })
    let value
    try { value = await response.json() } catch { throw new Error('激活服务返回格式错误，请检查服务地址') }
    if (!response.ok) {
      const error = new Error(typeof value.error === 'string' ? value.error : '激活服务暂不可用，请重试')
      error.code = value.code
      throw error
    }
    return value
  }
  async function policy() {
    const value = await request('/api/desktop-access/policy')
    if (typeof value.required !== 'boolean' || value.protocol !== 1) throw new Error('激活协议不受支持，请更新客户端')
    required = value.required
    return required
  }
  async function proof(purpose, method, pathname, body = '{}') {
    const publicKey = await keys.publicKey(false)
    if (!publicKey) { const error = new Error('本机尚未激活'); error.code = 'device_unactivated'; throw error }
    const challenge = await request('/api/desktop-access/challenges', { method: 'POST', body: JSON.stringify({ publicKey, purpose }) })
    if (typeof challenge.id !== 'string' || typeof challenge.nonce !== 'string' || challenge.purpose !== purpose ||
      !Number.isFinite(Date.parse(challenge.expiresAt)) || Date.parse(challenge.expiresAt) <= Date.now()) throw new Error('设备挑战无效，请重试')
    return { publicKey, challengeId: challenge.id, signature: await keys.sign(signingText(origin, purpose, method, pathname, challenge, body)) }
  }
  function proofHeaders(value) {
    return { 'X-Desktop-Key': value.publicKey, 'X-Desktop-Challenge': value.challengeId, 'X-Desktop-Signature': value.signature }
  }
  async function signed(purpose, pathname, value = {}) {
    const body = JSON.stringify(value)
    const result = await request(pathname, { method: 'POST', body, headers: proofHeaders(await proof(purpose, 'POST', pathname, body)) })
    if (result?.status !== 'active' || typeof result.id !== 'string' || !result.id || result.id.length > 128) {
      throw new Error('激活服务返回的设备状态无效，请重试')
    }
    return result
  }
  return { policy,
    async restore() {
      if (!await keys.publicKey(false)) { const error = new Error('请输入邀请码激活本机'); error.code = 'device_unactivated'; throw error }
      return signed('restore', '/api/desktop-access/restore')
    },
    async activate(raw) {
      const code = String(raw || '').trim().toUpperCase()
      if (!/^[A-HJ-NP-Z2-9]{6}$/.test(code)) throw new Error('请输入六位字母和数字邀请码')
      // Confirm persistence before consuming the one-time invite.
      const key = await keys.publicKey(true)
      if (!key || await keys.publicKey(false) !== key) throw new Error('本机密钥未能安全保存，请重试')
      return signed('activate', '/api/desktop-access/activate', { code })
    },
    renew: () => signed('renew', '/api/desktop-access/renew'),
    async runtimeProof(runtimeId, token) {
      if (!required) return undefined
      const body = JSON.stringify({ runtimeId, tokenHash: crypto.createHash('sha256').update(token).digest('hex') })
      return { ...await proof('runtime_connect', 'WS', '/api/client-runtime/ws', body), body }
    },
    async prepareAuth(request) {
      const url = new URL(request.url)
      const name = url.pathname.slice('/api/auth/'.length)
      if (!required || url.origin !== origin || !url.pathname.startsWith('/api/auth/') || !AUTH_PATHS.has(name) || request.method !== 'POST') return request
      url.pathname = '/api/desktop/auth/' + name
      const body = Buffer.from(await request.clone().arrayBuffer())
      if (body.length > 65536) throw new Error('登录请求过大')
      const headers = new Headers(request.headers)
      for (const [key, value] of Object.entries(proofHeaders(await proof('auth', 'POST', url.pathname, body)))) headers.set(key, value)
      // Node's Request requires duplex when preserving a streamed POST body.
      return new Request(url.href, { method: request.method, headers, body, redirect: 'error', duplex: 'half' })
    },
  }
}
module.exports = { signingText, createService }
