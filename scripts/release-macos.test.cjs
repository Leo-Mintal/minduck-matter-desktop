const assert = require('node:assert/strict')
const { execFileSync } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')
const { LEGACY_UPDATE_DOWNLOAD_BASE_URL, parseManifest } = require('../src/updateCheck.cjs')
const {
  REMOTE_RELEASE_DIR,
  artifactName,
  assertVersionProgression,
  openReleaseSSH,
  releaseDownloadURL,
  remotePublishScript,
  updatePackageVersion,
} = require('./release-macos.cjs')

test('creates only the expected versioned arm64 artifact and public URL', () => {
  assert.equal(artifactName('0.1.4'), 'MinduckMatter-0.1.4-arm64.dmg')
  assert.equal(releaseDownloadURL('0.1.4'), 'https://matter-desktop.yogeeai.com/download/MinduckMatter-0.1.4-arm64.dmg')
  assert.throws(() => artifactName('v0.1.4'))
})

test('requires a non-decreasing local version and a server-newer release', () => {
  assert.doesNotThrow(() => assertVersionProgression({ currentVersion: '0.1.3', latestVersion: '0.1.2', nextVersion: '0.1.3' }))
  assert.doesNotThrow(() => assertVersionProgression({ currentVersion: '0.1.3', latestVersion: '0.1.2', nextVersion: '0.1.4' }))
  assert.throws(() => assertVersionProgression({ currentVersion: '0.1.3', latestVersion: '0.1.2', nextVersion: '0.1.2' }))
  assert.throws(() => assertVersionProgression({ currentVersion: '0.1.3', latestVersion: '0.1.4', nextVersion: '0.1.4' }))
})

test('updates only the package version with valid JSON output', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'minduck-release-test-'))
  const packagePath = path.join(directory, 'package.json')
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  fs.writeFileSync(packagePath, '{\n  "name": "example",\n  "version": "0.1.3"\n}\n')

  assert.equal(updatePackageVersion(packagePath, '0.1.4'), true)
  assert.deepEqual(JSON.parse(fs.readFileSync(packagePath, 'utf8')), { name: 'example', version: '0.1.4' })
  assert.equal(updatePackageVersion(packagePath, '0.1.4'), false)
})

test('remote publisher checks the staged DMG before atomically switching latest.json', () => {
  const script = remotePublishScript()
  assert.match(script, new RegExp(`release_dir="${REMOTE_RELEASE_DIR}"`))
  assert.match(script, /test -s "\$release_dir\/\$dmg\.uploading"/)
  assert.match(script, /test "\$actual_checksum" = "\$expected_checksum"/)
  assert.match(script, /mv "\$release_dir\/\$dmg\.uploading" "\$release_dir\/\$dmg"/)
  assert.match(script, /mv "\$release_dir\/latest\.json\.next" "\$release_dir\/latest\.json"/)
})

test('remote publisher writes a parseable latest.json after checksum verification', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'minduck-release-remote-test-'))
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  const script = remotePublishScript().replace(REMOTE_RELEASE_DIR, directory)
  const version = '0.1.4'
  const dmg = 'MinduckMatter-' + version + '-arm64.dmg'
  const staged = path.join(directory, dmg + '.uploading')
  fs.writeFileSync(staged, 'verified installer bytes')
  const checksum = execFileSync('shasum', ['-a', '256', staged], { encoding: 'utf8' }).split(/\s+/)[0]
  const downloadURL = new URL(dmg, LEGACY_UPDATE_DOWNLOAD_BASE_URL).href

  execFileSync('bash', ['-c', script, '--', version, downloadURL, checksum])
  assert.equal(fs.existsSync(path.join(directory, dmg)), true)
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(directory, 'latest.json'), 'utf8')), {
    version,
    downloadUrl: downloadURL,
  })
  assert.equal(parseManifest(JSON.parse(fs.readFileSync(path.join(directory, 'latest.json'), 'utf8'))).downloadURL, releaseDownloadURL(version))
})

test('SSH control-master setup cleans up its temporary directory when authentication fails', () => {
  assert.throws(() => openReleaseSSH('invalid-user@127.0.0.1'), /无法建立服务器 SSH 连接/)
})
