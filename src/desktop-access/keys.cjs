const crypto = require('node:crypto')
const path = require('node:path')
const fs = require('node:fs')

function createKeyProvider({ app, origin, load = require }) {
  const tag = 'com.minduck.matter.desktop-access.v1.' + crypto.createHash('sha256').update(origin).digest('hex')
  let native
  function module() {
    if (native) return native
    if (!app.isPackaged || !fs.existsSync(path.join(process.resourcesPath, '..', 'embedded.provisionprofile'))) {
      const error = new Error('请使用具备 macOS 激活签名配置的安装包')
      error.code = 'secure_key_unsupported'
      throw error
    }
    native = load(path.join(process.resourcesPath, 'native', 'desktop-access.node'))
    return native
  }
  async function publicKey(create = false) {
    const raw = module().publicKey(tag, create)
    if (!raw) return null
    if (raw.length !== 65 || raw[0] !== 4) throw new Error('设备公钥格式不正确')
    const key = crypto.createPublicKey({ key: { kty: 'EC', crv: 'P-256',
      x: raw.subarray(1, 33).toString('base64url'), y: raw.subarray(33).toString('base64url') }, format: 'jwk' })
    return key.export({ format: 'der', type: 'spki' }).toString('base64url')
  }
  return { publicKey, async sign(text) { return module().sign(tag, Buffer.from(text)).toString('base64url') } }
}
module.exports = { createKeyProvider }
