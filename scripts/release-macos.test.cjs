const assert = require('node:assert/strict')
const { execFileSync, spawnSync } = require('node:child_process')
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
  remoteCleanupScript,
  remotePublishScript,
  updatePackageVersion,
} = require('./release-macos.cjs')

test('creates only the expected versioned arm64 artifact and public URL', () => {
  assert.equal(artifactName('0.1.4'), 'MinduckMatter-0.1.4-arm64.dmg')
  assert.equal(releaseDownloadURL('0.1.4'), 'https://matter-desktop.yogeeai.com/download/MinduckMatter-0.1.4-arm64.dmg')
  assert.throws(() => artifactName('v0.1.4'))
  assert.equal(artifactName('0.1.4', 'zip'), 'MinduckMatter-0.1.4-arm64.zip')
  assert.throws(() => artifactName('0.1.4', '../app'))
})

test('release refuses unsigned update packages before contacting any server', () => {
  for (const argument of ['0.1.8', '--upload-only']) {
    const result = spawnSync(process.execPath, [path.join(__dirname, 'release-macos.cjs'), argument], {
      encoding: 'utf8', env: { ...process.env, MINDUCK_MACOS_SIGN: '0' },
    })
    assert.equal(result.status, 1)
    assert.match(result.stderr, /必须启用签名和公证/)
  }
})

test('requires a non-decreasing local version and a server-newer release', () => {
  assert.doesNotThrow(() => assertVersionProgression({ currentVersion: '0.1.3', latestVersion: '0.1.2', nextVersion: '0.1.3' }))
  assert.doesNotThrow(() => assertVersionProgression({ currentVersion: '0.1.3', latestVersion: '0.1.2', nextVersion: '0.1.4' }))
  assert.throws(() => assertVersionProgression({ currentVersion: '0.1.3', latestVersion: '0.1.2', nextVersion: '0.1.2' }))
  assert.throws(() => assertVersionProgression({ currentVersion: '0.1.3', latestVersion: '0.1.4', nextVersion: '0.1.4' }))
})

test('upload retries the same published version but refuses a downgrade', () => {
  assert.doesNotThrow(() => assertVersionProgression({
    currentVersion: '0.1.10', latestVersion: '0.1.10', nextVersion: '0.1.10', allowSameVersion: true,
  }))
  assert.throws(() => assertVersionProgression({
    currentVersion: '0.1.9', latestVersion: '0.1.10', nextVersion: '0.1.9', allowSameVersion: true,
  }))
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

test('remote publisher verifies all artifacts before switching either update manifest', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'minduck-release-remote-test-'))
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  const script = 'umask 077\n' + remotePublishScript().replace(REMOTE_RELEASE_DIR, directory)
  const version = '0.1.4'
  const dmg = 'MinduckMatter-' + version + '-arm64.dmg'
  const staged = path.join(directory, dmg + '.uploading')
  fs.writeFileSync(staged, 'verified installer bytes')
  const zip = dmg.replace('.dmg', '.zip')
  fs.writeFileSync(path.join(directory, zip + '.uploading'), 'verified updater bytes')
  fs.writeFileSync(path.join(directory, 'latest-mac.yml.uploading'), 'version: 0.1.4\n')
  fs.writeFileSync(path.join(directory, 'latest-mac.yml'), 'version: 0.1.3\n')
  fs.writeFileSync(path.join(directory, 'latest.json'), '{"version":"0.1.3"}')
  const checksum = execFileSync('shasum', ['-a', '256', staged], { encoding: 'utf8' }).split(/\s+/)[0]
  const hash = name => execFileSync('shasum', ['-a', '256', path.join(directory, name)],
    { encoding: 'utf8' }).split(/\s+/)[0]
  const zipChecksum = hash(zip + '.uploading'), manifestChecksum = hash('latest-mac.yml.uploading')
  const downloadURL = new URL(dmg, LEGACY_UPDATE_DOWNLOAD_BASE_URL).href

  for (const checksums of [[checksum, 'wrong', manifestChecksum], [checksum, zipChecksum, 'wrong']]) {
    assert.throws(() => execFileSync('bash', ['-c', script, '--', version, downloadURL, ...checksums]))
    assert.equal(fs.readFileSync(path.join(directory, 'latest-mac.yml'), 'utf8'), 'version: 0.1.3\n')
    assert.equal(fs.readFileSync(path.join(directory, 'latest.json'), 'utf8'), '{"version":"0.1.3"}')
    assert.ok(!fs.existsSync(path.join(directory, dmg)))
  }
  execFileSync('bash', ['-c', script, '--', version, downloadURL, checksum, zipChecksum, manifestChecksum])
  assert.equal(fs.existsSync(path.join(directory, dmg)), true)
  assert.equal(fs.existsSync(path.join(directory, zip)), true)
  assert.equal(fs.readFileSync(path.join(directory, 'latest-mac.yml'), 'utf8'), 'version: 0.1.4\n')
  for (const name of [dmg, zip, 'latest-mac.yml', 'latest.json']) {
    assert.equal(fs.statSync(path.join(directory, name)).mode & 0o777, 0o644)
  }
  assert.equal(fs.readFileSync(path.join(directory, 'latest.json'), 'utf8'), JSON.stringify({
    version,
    downloadUrl: downloadURL,
  }, null, 2) + '\n')
  assert.equal(parseManifest(JSON.parse(fs.readFileSync(path.join(directory, 'latest.json'), 'utf8'))).downloadURL, releaseDownloadURL(version))
})

test('SSH control-master setup cleans up its temporary directory when authentication fails', () => {
  assert.throws(() => openReleaseSSH('invalid-user@127.0.0.1'), /无法建立服务器 SSH 连接/)
})

test('cleanup requires both current manifests and deletes only strictly older release files', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'minduck-release-cleanup-test-'))
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  const script = remoteCleanupScript().replace(REMOTE_RELEASE_DIR, directory)
  const version = '0.1.10'
  const removed = [
    'MinduckMatter-0.1.9-arm64.dmg',
    'MinduckMatter-0.1.9-arm64.zip',
    'MinduckMatter-0.1.8-arm64-app.zip',
    'MinduckMatter-0.1.8-arm64.zip.blockmap',
    'MinduckMatter-0.1.8-arm64.dmg.sha256',
    'MinduckMatter-0.1.8-arm64.dmg.release.json',
    'MinduckMatter-0.0.99-arm64.dmg',
    'latest.json.before-0.1.9',
    'latest.json.before-0.1.10',
    'latest-mac.yml.before-0.1.9',
    'latest-mac.yml.before-0.1.10',
  ]
  const preserved = [
    'MinduckMatter-0.1.10-arm64.dmg',
    'MinduckMatter-0.1.10-arm64.zip',
    'MinduckMatter-0.1.10-arm64.zip.blockmap',
    'MinduckMatter-0.1.11-arm64.dmg',
    'MinduckMatter-0.2.0-arm64.zip',
    'MinduckMatter-1.0.0-arm64.dmg',
    'MinduckMatter-0.1.9-arm64.dmg.uploading',
    'MinduckMatter-0.1.9-arm64.zip.uploading',
    'MinduckMatter-0.1.9-x64.dmg',
    'MinduckMatter-0.1.9-arm64Xdmg',
    'MinduckMatter-0.1.9-arm64.zipXsha256',
    'MinduckMatter-0x1x9-arm64.zip',
    'latest.json.before-0.1.11',
    'latest-mac.yml.before-0.1.11',
    'latestXjson.before-0.1.9',
    'latest.mac.yml.before-0.1.9',
    'latest-mac.yml.uploading',
    'unrelated.bin',
  ]
  for (const name of [...removed, ...preserved]) fs.writeFileSync(path.join(directory, name), 'fixture')
  const symlink = 'MinduckMatter-0.1.3-arm64.dmg'
  const nestedDirectory = 'MinduckMatter-0.1.4-arm64.dmg'
  fs.symlinkSync('unrelated.bin', path.join(directory, symlink))
  fs.mkdirSync(path.join(directory, nestedDirectory))
  fs.writeFileSync(path.join(directory, nestedDirectory, 'keep'), 'fixture')
  fs.writeFileSync(path.join(directory, 'latest-mac.yml'), 'version: 0.1.10\n')
  fs.writeFileSync(path.join(directory, 'latest.json'), '{"version":"0.1.10"}\n')
  const hash = name => execFileSync('shasum', ['-a', '256', path.join(directory, name)],
    { encoding: 'utf8' }).split(/\s+/)[0]
  const yamlChecksum = hash('latest-mac.yml'), jsonChecksum = hash('latest.json')

  for (const checksums of [['wrong', jsonChecksum], [yamlChecksum, 'wrong']]) {
    const result = spawnSync('bash', ['-c', script, '--', version, ...checksums], { encoding: 'utf8' })
    assert.notEqual(result.status, 0)
    for (const name of removed) assert.ok(fs.existsSync(path.join(directory, name)), name)
  }
  execFileSync('bash', ['-c', script, '--', version, yamlChecksum, jsonChecksum])
  for (const name of removed) assert.ok(!fs.existsSync(path.join(directory, name)), name)
  for (const name of preserved) assert.ok(fs.existsSync(path.join(directory, name)), name)
  assert.equal(fs.lstatSync(path.join(directory, symlink)).isSymbolicLink(), true)
  assert.equal(fs.readFileSync(path.join(directory, nestedDirectory, 'keep'), 'utf8'), 'fixture')
  assert.equal(hash('latest-mac.yml'), yamlChecksum)
  assert.equal(hash('latest.json'), jsonChecksum)
})
