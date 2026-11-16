const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { systemFolderFor } = require('../src/local-exec/system-folders.cjs')

test('system folder routing accepts only absolute or tilde paths inside three standard folders', () => {
  const home = '/Users/example'
  for (const name of ['Desktop', 'Documents', 'Downloads']) {
    assert.equal(systemFolderFor(`~/${name}/project/a.txt`, home).root, `${home}/${name}`)
    assert.equal(systemFolderFor(`${home}/${name}`, home).root, `${home}/${name}`)
  }
  for (const request of [undefined, '~', '~/Desktop-old', '~/Documents/../.ssh', 'Documents/file', '/tmp/Documents']) {
    assert.equal(systemFolderFor(request, home), null)
  }
})

test('packaging declares the three system folder access purposes', () => {
  const info = require('../package.json').build.mac.extendInfo
  for (const name of ['Desktop', 'Documents', 'Downloads']) {
    assert.ok(info[`NS${name}FolderUsageDescription`].includes('Matter'))
  }
})

test('packaging declares the file-provider access purpose for iCloud and cloud drives', () => {
  const info = require('../package.json').build.mac.extendInfo
  assert.ok(info.NSFileProviderDomainUsageDescription.includes('iCloud'))
})

test('packaging declares why Matter needs access to the photo library', () => {
  const info = require('../package.json').build.mac.extendInfo
  assert.match(info.NSPhotoLibraryUsageDescription, /Matter/)
  assert.match(info.NSPhotoLibraryUsageDescription, /照片/)
})

test('the hardened runtime signature permits macOS to prompt for Photos access', () => {
  const mac = require('../package.json').build.mac
  assert.equal(mac.hardenedRuntime, true)
  const entitlements = fs.readFileSync(path.join(__dirname, '..', mac.entitlements), 'utf8')
  assert.match(entitlements, /<key>com\.apple\.security\.personal-information\.photos-library<\/key>\s*<true\s*\/>/)
})
