const DEFAULT_MATTER_ORIGIN = 'https://matter.minduck.com'
const TEST_MATTER_ORIGIN = 'http://192.168.11.70:3001'
const TRUSTED_HTTP_ORIGINS = new Set([TEST_MATTER_ORIGIN])

function normalizeMatterOrigin(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > 2_048) {
    throw new Error('请输入完整的 Matter 服务地址')
  }

  let url
  try {
    url = new URL(value.trim())
  } catch {
    throw new Error('Matter 服务地址必须是有效的 HTTPS 网址')
  }
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  const trustedHTTPOrigin = url.protocol === 'http:' && TRUSTED_HTTP_ORIGINS.has(url.origin)
  if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && (loopback || trustedHTTPOrigin)))
    || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('请填写 HTTPS 服务根地址；仅本机开发地址和内置测试服可使用 HTTP')
  }
  return url.origin
}

function resolveMatterOrigin(settingsOrigin, environmentOrigin) {
  return normalizeMatterOrigin(environmentOrigin || settingsOrigin || DEFAULT_MATTER_ORIGIN)
}

function isMatterWebURL(value, origin) {
  try {
    return new URL(value).origin === origin
  } catch {
    return false
  }
}

module.exports = {
  DEFAULT_MATTER_ORIGIN,
  isMatterWebURL,
  normalizeMatterOrigin,
  resolveMatterOrigin,
}
