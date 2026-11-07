const assert = require('node:assert/strict')
const test = require('node:test')
const {
  UPDATE_MANIFEST_URL,
  compareVersions,
  checkForUpdate,
  parseManifest,
} = require('../src/updateCheck.cjs')

const manifest = (version, url = `http://124.70.149.30:8091/MinduckMatter-${version}-arm64.dmg`) => JSON.stringify({ version, downloadUrl: url })
const response = body => ({ ok: true, text: async () => body })

test('compares release versions without accepting malformed values', () => {
  assert.equal(compareVersions('0.1.3', '0.1.2'), 1)
  assert.equal(compareVersions('1.0.0', '1.0.0'), 0)
  assert.equal(compareVersions('1.0.0', '1.0.1'), -1)
  for (const value of ['v1.0.0', '1.0', '01.0.0', '1.0.0-beta', '1.0.0.1']) assert.throws(() => compareVersions(value, '1.0.0'))
})

test('accepts only the matching same-origin arm64 DMG from the update manifest', () => {
  assert.deepEqual(parseManifest(JSON.parse(manifest('0.1.3'))), {
    version: '0.1.3',
    downloadURL: 'http://124.70.149.30:8091/MinduckMatter-0.1.3-arm64.dmg',
  })
  for (const url of [
    'https://124.70.149.30:8091/MinduckMatter-0.1.3-arm64.dmg',
    'http://evil.example/MinduckMatter-0.1.3-arm64.dmg',
    'http://124.70.149.30:8091/MinduckMatter-0.1.2-arm64.dmg',
    'http://124.70.149.30:8091/MinduckMatter-0.1.3-arm64.zip',
    'http://124.70.149.30:8091/MinduckMatter-0.1.3-arm64.dmg?next=1',
  ]) assert.throws(() => parseManifest(JSON.parse(manifest('0.1.3', url))))
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
    downloadURL: 'http://124.70.149.30:8091/MinduckMatter-0.1.3-arm64.dmg',
  })
  assert.equal(calls[0].url, UPDATE_MANIFEST_URL)
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
