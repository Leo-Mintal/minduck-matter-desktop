const test = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { createKeyProvider } = require('../src/desktop-access/keys.cjs')
const { signingText } = require('../src/desktop-access/service.cjs')

test('desktop key tags and signed proofs are isolated by service origin', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'matter-origin-key-test-'))
  const original = Object.getOwnPropertyDescriptor(process, 'resourcesPath')
  const resources = path.join(dir, 'Resources')
  fs.mkdirSync(resources)
  fs.writeFileSync(path.join(dir, 'embedded.provisionprofile'), 'test fixture only')
  Object.defineProperty(process, 'resourcesPath', { value: resources, configurable: true })
  t.after(() => {
    if (original) Object.defineProperty(process, 'resourcesPath', original)
    else delete process.resourcesPath
    fs.rmSync(dir, { recursive: true, force: true })
  })
  const rawKey = crypto.createECDH('prime256v1').generateKeys()
  const tags = []
  const native = { publicKey(tag) { tags.push(tag); return rawKey } }
  const origins = ['http://127.0.0.1:8080', 'http://192.168.11.70:8080', 'https://matter.minduck.com']
  for (const origin of origins) {
    const keys = createKeyProvider({ app: { isPackaged: true }, origin, load: () => native })
    await keys.publicKey(false)
  }
  assert.equal(new Set(tags).size, 3)
  await createKeyProvider({ app: { isPackaged: true }, origin: origins[0], load: () => native }).publicKey(false)
  assert.equal(tags[3], tags[0])
  const challenge = { id: 'same-test-challenge', nonce: 'same-test-nonce' }
  assert.equal(new Set(origins.map(origin => signingText(origin, 'restore', 'POST', '/api/desktop-access/restore', challenge, '{}'))).size, 3)
})
