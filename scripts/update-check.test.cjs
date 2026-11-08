const assert = require('node:assert/strict')
const test = require('node:test')
const {
  LEGACY_UPDATE_DOWNLOAD_BASE_URL,
  UPDATE_MANIFEST_URL,
  compareVersions,
  checkForUpdate,
  parseManifest,
} = require('../src/updateCheck.cjs')

const manifest = (version, url = `https://matter-desktop.yogeeai.com/download/MinduckMatter-${version}-arm64.dmg`) => JSON.stringify({ version, downloadUrl: url })
const response = body => ({ ok: true, text: async () => body })

test('compares release versions without accepting malformed values', () => {
  assert.equal(compareVersions('0.1.3', '0.1.2'), 1)
  assert.equal(compareVersions('1.0.0', '1.0.0'), 0)
  assert.equal(compareVersions('1.0.0', '1.0.1'), -1)
  for (const value of ['v1.0.0', '1.0', '01.0.0', '1.0.0-beta', '1.0.0.1']) assert.throws(() => compareVersions(value, '1.0.0'))
})

test('accepts only the matching arm64 DMG under the configured download path', () => {
  assert.deepEqual(parseManifest(JSON.parse(manifest('0.1.3'))), {
    version: '0.1.3',
    downloadURL: 'https://matter-desktop.yogeeai.com/download/MinduckMatter-0.1.3-arm64.dmg',
  })
  for (const url of [
    'http://matter-desktop.yogeeai.com/download/MinduckMatter-0.1.3-arm64.dmg',
    'http://evil.example/MinduckMatter-0.1.3-arm64.dmg',
    'https://matter-desktop.yogeeai.com/download/MinduckMatter-0.1.2-arm64.dmg',
    'https://matter-desktop.yogeeai.com/download/MinduckMatter-0.1.3-arm64.zip',
    'https://matter-desktop.yogeeai.com/download/MinduckMatter-0.1.3-arm64.dmg?next=1',
    'https://matter-desktop.yogeeai.com/download/MinduckMatter-0.1.3-arm64.dmg#other',
    'https://user@matter-desktop.yogeeai.com/download/MinduckMatter-0.1.3-arm64.dmg',
    'https://matter-desktop.yogeeai.com/MinduckMatter-0.1.3-arm64.dmg',
  ]) assert.throws(() => parseManifest(JSON.parse(manifest('0.1.3', url))))
})

test('maps only the exact legacy manifest URL to HTTPS for migration', () => {
  const legacy = `${LEGACY_UPDATE_DOWNLOAD_BASE_URL}MinduckMatter-0.1.5-arm64.dmg`
  assert.deepEqual(parseManifest(JSON.parse(manifest('0.1.5', legacy))), {
    version: '0.1.5',
    downloadURL: 'https://matter-desktop.yogeeai.com/download/MinduckMatter-0.1.5-arm64.dmg',
  })
  for (const url of [
    legacy.replace('http:', 'https:'),
    legacy.replace('0.1.5', '0.1.4'),
    legacy.replace('/MinduckMatter', '/other/MinduckMatter'),
    `${legacy}?next=1`,
    `${legacy}#other`,
    legacy.replace('http://', 'http://user@'),
  ]) assert.throws(() => parseManifest(JSON.parse(manifest('0.1.5', url))))
  assert.throws(() => parseManifest(JSON.parse(manifest('0.1.5', legacy)), 'https://other.example/latest.json'))
})

test('reports only newer releases and bypasses cached manifest responses', async () => {
  const calls = []
  const newer = await checkForUpdate({ currentVersion: '0.1.2', fetchImpl: async (url, options) => {
    calls.push({ url, options })
    return response(manifest('0.1.3'))
  } })
  assert.deepEqual(newer, {
    available: true,
    version: '0.1.3',
    downloadURL: 'https://matter-desktop.yogeeai.com/download/MinduckMatter-0.1.3-arm64.dmg',
  })
  assert.equal(calls[0].url, UPDATE_MANIFEST_URL)
  assert.equal(calls[0].url, 'https://matter-desktop.yogeeai.com/download/latest.json')
  assert.equal(calls[0].options.cache, 'no-store')
  assert.equal(calls[0].options.redirect, 'error')

  const current = await checkForUpdate({ currentVersion: '0.1.3', fetchImpl: async () => response(manifest('0.1.3')) })
  assert.deepEqual(current, { available: false, currentVersion: '0.1.3', latestVersion: '0.1.3' })
})

test('rejects unavailable, oversized, malformed and untrusted manifests', async () => {
  await assert.rejects(checkForUpdate({ currentVersion: '0.1.2', fetchImpl: async () => ({ ok: false, text: async () => '' }) }))
  await assert.rejects(checkForUpdate({ currentVersion: '0.1.2', fetchImpl: async () => response('{') }))
  await assert.rejects(checkForUpdate({ currentVersion: '0.1.2', fetchImpl: async () => response('x'.repeat(16 * 1024 + 1)) }))
  await assert.rejects(checkForUpdate({ currentVersion: '0.1.2', fetchImpl: async () => response(manifest('0.1.3', 'http://evil.example/package.dmg')) }))
})
