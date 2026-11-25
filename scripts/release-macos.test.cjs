const assert = require('node:assert/strict')
const { execFileSync, spawnSync } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')
const { LEGACY_UPDATE_DOWNLOAD_BASE_URL, parseManifest } = require('../src/updateCheck.cjs')
const { refreshUpdateManifest, verifyUpdateArtifacts } = require('./macos-update-artifacts.cjs')
const {
  REMOTE_RELEASE_DIR,
  artifactName,
  assertVersionProgression,
  localReleasePaths,
  openReleaseSSH,
  releaseDownloadURL,
  remoteCleanupScript,
  remotePublishScript,
  selectReleaseVersion,
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
  for (const args of [[], ['0.1.8'], ['--upload-only']]) {
    const result = spawnSync(process.execPath, [path.join(__dirname, 'release-macos.cjs'), ...args], {
      encoding: 'utf8', env: { ...process.env, MINDUCK_MACOS_SIGN: '0' },
    })
    assert.equal(result.status, 1)
    assert.match(result.stderr, /必须启用签名和公证/)
  }
})

test('local release paths isolate each version and its notarization report', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'minduck-versioned-releases-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  // Flat legacy output must never take precedence over the chosen version.
  fs.mkdirSync(path.join(root, 'metadata'))
  fs.writeFileSync(path.join(root, 'metadata', 'latest-mac.yml'), 'invalid legacy manifest')
  for (const version of ['0.1.10', '0.1.11']) {
    const files = localReleasePaths(version, root)
    assert.equal(files.directory, path.join(root, version))
    assert.equal(files.reportPath, path.join(root, version, 'metadata', `MinduckMatter-${version}-arm64.release.json`))
    fs.mkdirSync(path.dirname(files.manifestPath), { recursive: true })
    fs.writeFileSync(files.dmgPath, `installer ${version}`)
    fs.writeFileSync(files.zipPath, `updater ${version}`)
    const generatedManifest = path.join(files.directory, 'latest-mac.yml')
    fs.writeFileSync(generatedManifest, JSON.stringify({ version, files: [] }))
    refreshUpdateManifest(files.directory, version)
    fs.renameSync(generatedManifest, files.manifestPath)
  }
  for (const version of ['0.1.10', '0.1.11']) {
    const files = localReleasePaths(version, root)
    assert.equal(verifyUpdateArtifacts(files.directory, files.manifestPath, version).version, version)
  }
  const old = localReleasePaths('0.1.10', root), current = localReleasePaths('0.1.11', root)
  fs.copyFileSync(current.manifestPath, old.manifestPath)
  assert.throws(() => verifyUpdateArtifacts(old.directory, old.manifestPath, '0.1.10'), /版本不一致/)
  assert.throws(() => localReleasePaths('../0.1.11', root))
})

test('packaging output keeps installers, sidecars and manifests inside their own version', t => {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'minduck-packaging-layout-'))
  t.after(() => fs.rmSync(project, { recursive: true, force: true }))
  const source = fs.readFileSync(path.join(__dirname, 'package-macos.sh'), 'utf8')
  const outputStart = source.indexOf('\nnode "$script_dir/macos-update-artifacts.cjs"')
  assert.ok(outputStart > 0)
  const directoryStart = source.indexOf('\ntest_build_name=')
  const directoryEnd = source.indexOf('\nactivation_profile=', directoryStart)
  assert.ok(directoryStart > 0 && directoryEnd > directoryStart)
  // Exercise the actual output section without building, signing or uploading.
  const outputScript = [
    'set -euo pipefail',
    source.slice(directoryStart, directoryEnd),
    'mkdir -p "$metadata_dir"',
    source.slice(outputStart),
  ].join('\n')
  let previous
  for (const [version, testBuild] of [['0.1.10', ''], ['0.1.11', ''], ['0.1.11', 'suit-duck-test']]) {
    const stage = path.join(project, `stage-${version}-${testBuild}`)
    fs.mkdirSync(stage)
    const dmg = artifactName(version), zip = artifactName(version, 'zip')
    for (const name of [dmg, zip, `${dmg}.blockmap`, `${zip}.blockmap`]) {
      fs.writeFileSync(path.join(stage, name), `${name} fixture`)
    }
    fs.writeFileSync(path.join(stage, 'latest-mac.yml'), JSON.stringify({ version, files: [] }))
    const result = spawnSync('bash', ['-c', outputScript], { encoding: 'utf8', env: {
      ...process.env, project_dir: project, version, stage_dir: stage, script_dir: __dirname,
      artifact: dmg, update_archive: zip, sign_release: '0',
      MINDUCK_MACOS_TEST_BUILD_NAME: testBuild,
    } })
    assert.equal(result.status, 0, result.stderr)
    const files = localReleasePaths(version, path.join(project, 'release'))
    const directory = testBuild ? path.join(files.directory, 'tests', testBuild) : files.directory
    const manifest = path.join(directory, 'metadata/latest-mac.yml')
    assert.equal(verifyUpdateArtifacts(directory, manifest, version).version, version)
    for (const name of [dmg, zip]) {
      assert.equal(fs.readFileSync(path.join(directory, name), 'utf8'), `${name} fixture`)
      const metadata = path.join(directory, 'metadata')
      assert.equal(fs.readFileSync(path.join(metadata, `${name}.blockmap`), 'utf8'), `${name}.blockmap fixture`)
      execFileSync('shasum', ['-a', '256', '-c', path.join(metadata, `${name}.sha256`)], { cwd: directory })
    }
    if (previous) assert.equal(fs.readFileSync(previous.path, 'utf8'), previous.text)
    previous = { path: manifest, text: fs.readFileSync(manifest, 'utf8') }
  }
  assert.deepEqual(fs.readdirSync(path.join(project, 'release')).sort(), ['0.1.10', '0.1.11'])
})

test('automatic release increments the patch above both local and published versions', () => {
  for (const [currentVersion, latestVersion, expected] of [
    ['0.1.16', '0.1.15', '0.1.17'],
    ['0.1.9', '0.1.10', '0.1.11'],
    ['0.1.16', '0.1.16', '0.1.17'],
    ['1.9.99', '1.10.0', '1.10.1'],
  ]) {
    assert.equal(selectReleaseVersion({ currentVersion, latestVersion }), expected)
  }
  assert.throws(() => selectReleaseVersion({ currentVersion: '0.1.1', latestVersion: 'bad' }))
  assert.throws(() => selectReleaseVersion({ currentVersion: '1.0.' + Number.MAX_SAFE_INTEGER, latestVersion: '0.1.1' }))
})

test('an explicit version or upload of a built package keeps the chosen version', () => {
  const versions = { currentVersion: '0.1.16', latestVersion: '0.1.15' }
  assert.equal(selectReleaseVersion({ ...versions, requestedVersion: '0.2.0' }), '0.2.0')
  assert.equal(selectReleaseVersion({ ...versions, requestedVersion: '0.1.16' }), '0.1.16')
  assert.equal(selectReleaseVersion({ ...versions, uploadOnly: true }), '0.1.16')
  assert.throws(() => selectReleaseVersion({ ...versions, requestedVersion: '0.1.14' }))
  assert.throws(() => selectReleaseVersion({ ...versions, latestVersion: '0.1.17', uploadOnly: true }))
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
  const alias = path.join(directory, 'latest.dmg')
  const previous = 'MinduckMatter-0.1.3-arm64.dmg'
  fs.writeFileSync(path.join(directory, previous), 'previous installer')
  fs.symlinkSync(previous, alias)
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
    assert.equal(fs.readlinkSync(alias), previous)
  }
  execFileSync('bash', ['-c', script, '--', version, downloadURL, checksum, zipChecksum, manifestChecksum])
  assert.equal(fs.existsSync(path.join(directory, dmg)), true)
  assert.equal(fs.readlinkSync(alias), dmg)
  assert.equal(fs.readFileSync(alias, 'utf8'), 'verified installer bytes')
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
