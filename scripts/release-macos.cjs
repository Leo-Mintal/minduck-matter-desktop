#!/usr/bin/env node

const { spawnSync } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { createHash } = require('node:crypto')
const { verifyUpdateArtifacts } = require('./macos-update-artifacts.cjs')
const {
  LATEST_DMG_URL,
  LEGACY_UPDATE_DOWNLOAD_BASE_URL,
  UPDATE_MANIFEST_URL,
  compareVersions,
  parseManifest,
  parseVersion,
} = require('../src/updateCheck.cjs')

const PROJECT_DIR = path.resolve(__dirname, '..')
const PACKAGE_JSON = path.join(PROJECT_DIR, 'package.json')
const RELEASE_DIR = path.join(PROJECT_DIR, 'release')
const REMOTE_RELEASE_DIR = '/root/minduck-matter-download/releases'
const REMOTE_USER = 'root'
const REMOTE_HOST = '124.70.149.30'
const NOTARY_PROFILE = process.env.MINDUCK_NOTARY_PROFILE || 'MinduckNotary'

function artifactName(version, extension = 'dmg') {
  parseVersion(version)
  if (!['dmg', 'zip'].includes(extension)) throw new Error('无效的发布文件类型')
  return `MinduckMatter-${version}-arm64.${extension}`
}

function localReleasePaths(version, releaseRoot = RELEASE_DIR) {
  parseVersion(version)
  const directory = path.join(releaseRoot, version)
  const metadataDirectory = path.join(directory, 'metadata')
  return {
    directory,
    dmgPath: path.join(directory, artifactName(version)),
    zipPath: path.join(directory, artifactName(version, 'zip')),
    manifestPath: path.join(metadataDirectory, 'latest-mac.yml'),
    reportPath: path.join(metadataDirectory, `MinduckMatter-${version}-arm64.release.json`),
  }
}

function releaseDownloadURL(version) {
  return new URL(artifactName(version), UPDATE_MANIFEST_URL).href
}

function assertVersionProgression({ currentVersion, latestVersion, nextVersion, allowSameVersion = false }) {
  parseVersion(currentVersion)
  parseVersion(latestVersion)
  parseVersion(nextVersion)
  if (compareVersions(nextVersion, currentVersion) < 0) {
    throw new Error(`发布版本 ${nextVersion} 不能低于本地版本 ${currentVersion}`)
  }
  if (compareVersions(nextVersion, latestVersion) < 0
    || (!allowSameVersion && compareVersions(nextVersion, latestVersion) === 0)) {
    throw new Error(`发布版本 ${nextVersion} 必须高于服务器当前版本 ${latestVersion}`)
  }
}

function selectReleaseVersion({ currentVersion, latestVersion, requestedVersion, uploadOnly = false }) {
  let nextVersion = uploadOnly ? currentVersion : requestedVersion
  if (nextVersion === undefined) {
    const base = compareVersions(currentVersion, latestVersion) >= 0 ? currentVersion : latestVersion
    const [major, minor, patch] = parseVersion(base)
    nextVersion = `${major}.${minor}.${patch + 1}`
  }
  assertVersionProgression({ currentVersion, latestVersion, nextVersion, allowSameVersion: uploadOnly })
  return nextVersion
}

function updatePackageVersion(packagePath, version) {
  const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8'))
  parseVersion(packageJson.version)
  parseVersion(version)
  if (packageJson.version === version) return false
  packageJson.version = version
  fs.writeFileSync(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`)
  return true
}

function remotePublishScript() {
  return [
    'set -euo pipefail',
    'version="$1"',
    'download_url="$2"',
    'expected_checksum="$3"',
    'zip_checksum="$4"',
    'manifest_checksum="$5"',
    `release_dir="${REMOTE_RELEASE_DIR}"`,
    'dmg="MinduckMatter-${version}-arm64.dmg"',
    'zip="MinduckMatter-${version}-arm64.zip"',
    '',
    'test -s "$release_dir/$dmg.uploading"',
    'actual_checksum="$(shasum -a 256 "$release_dir/$dmg.uploading" | awk \'{print $1}\')"',
    'test "$actual_checksum" = "$expected_checksum"',
    'test -s "$release_dir/$zip.uploading"',
    'test "$(shasum -a 256 "$release_dir/$zip.uploading" | awk \'{print $1}\')" = "$zip_checksum"',
    'test -s "$release_dir/latest-mac.yml.uploading"',
    'test "$(shasum -a 256 "$release_dir/latest-mac.yml.uploading" | awk \'{print $1}\')" = "$manifest_checksum"',
    'chmod 644 "$release_dir/$dmg.uploading" "$release_dir/$zip.uploading" "$release_dir/latest-mac.yml.uploading"',
    'mv "$release_dir/$dmg.uploading" "$release_dir/$dmg"',
    'mv "$release_dir/$zip.uploading" "$release_dir/$zip"',
    'ln -sfn "$dmg" "$release_dir/latest.dmg.next"',
    'mv -f "$release_dir/latest.dmg.next" "$release_dir/latest.dmg"',
    'mv "$release_dir/latest-mac.yml.uploading" "$release_dir/latest-mac.yml"',
    '',
    "printf '{\\n  \"version\": \"%s\",\\n  \"downloadUrl\": \"%s\"\\n}\\n' \"$version\" \"$download_url\" > \"$release_dir/latest.json.next\"",
    'chmod 644 "$release_dir/latest.json.next"',
    'mv "$release_dir/latest.json.next" "$release_dir/latest.json"',
    '',
  ].join('\n')
}

function remoteCleanupScript() {
  return [
    'set -euo pipefail',
    'version="$1"',
    `cd "${REMOTE_RELEASE_DIR}"`,
    'test "$(shasum -a 256 latest-mac.yml | awk \'{print $1}\')" = "$2"',
    'test "$(shasum -a 256 latest.json | awk \'{print $1}\')" = "$3"',
    'older() {',
    '  local a b c x y z',
    '  IFS=. read -r a b c <<< "$1"',
    '  IFS=. read -r x y z <<< "$2"',
    '  if (( 10#$a != 10#$x )); then (( 10#$a < 10#$x )); return; fi',
    '  if (( 10#$b != 10#$y )); then (( 10#$b < 10#$y )); return; fi',
    '  (( 10#$c < 10#$z ))',
    '}',
    'shopt -s nullglob',
    'for file in MinduckMatter-* latest.json.before-* latest-mac.yml.before-*; do',
    '  [[ -f "$file" && ! -L "$file" ]] || continue',
    '  if [[ "$file" =~ ^MinduckMatter-([0-9]+\\.[0-9]+\\.[0-9]+)-arm64(\\.dmg|(-app)?\\.zip)(\\.(blockmap|sha256|release\\.json))?$ ]]; then',
    '    candidate="${BASH_REMATCH[1]}"',
    '    if older "$candidate" "$version"; then rm -- "$file"; printf "已清理旧版文件：%s\\n" "$file"; fi',
    '  elif [[ "$file" =~ ^(latest\\.json|latest-mac\\.yml)\\.before-([0-9]+\\.[0-9]+\\.[0-9]+)$ ]]; then',
    '    candidate="${BASH_REMATCH[2]}"',
    '    if [[ "$candidate" == "$version" ]] || older "$candidate" "$version"; then rm -- "$file"; fi',
    '  fi',
    'done',
  ].join('\n')
}

function verifyExistingNotarization({ version, checksum, zipChecksum, localDMG }) {
  const reportFile = localReleasePaths(version).reportPath
  if (fs.existsSync(reportFile)) {
    const report = JSON.parse(fs.readFileSync(reportFile, 'utf8'))
    if (report.version === version && report.notarization?.app?.status === 'Accepted'
      && report.notarization?.dmg?.status === 'Accepted'
      && report.artifacts?.[artifactName(version)]?.sha256 === checksum
      && report.artifacts?.[artifactName(version, 'zip')]?.sha256 === zipChecksum) return
  }
  run('codesign', ['--verify', '--strict', localDMG])
  run('xcrun', ['stapler', 'validate', localDMG])
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: PROJECT_DIR,
    encoding: 'utf8',
    stdio: 'inherit',
    ...options,
  })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`${command} 执行失败，退出码 ${result.status}`)
  return result.stdout || ''
}

function curlText(url) {
  return run('curl', [
    '--silent',
    '--show-error',
    '--fail',
    '--noproxy', '*',
    '--max-time', '30',
    url,
  ], { stdio: ['ignore', 'pipe', 'inherit'] })
}

function remoteLatestRelease() {
  let manifest
  try {
    manifest = JSON.parse(curlText(UPDATE_MANIFEST_URL))
  } catch (error) {
    throw new Error(`无法读取发布清单 ${UPDATE_MANIFEST_URL}: ${error.message}`)
  }
  return parseManifest(manifest)
}

function sha256(file) {
  const output = run('shasum', ['-a', '256', file], { stdio: ['ignore', 'pipe', 'inherit'] }).trim()
  const checksum = output.split(/\s+/)[0]
  if (!/^[a-f0-9]{64}$/i.test(checksum)) throw new Error(`无法校验安装包 SHA-256：${file}`)
  return checksum
}

function verifyPublishedRelease({ version, downloadURL, updateManifest }) {
  const manifest = parseManifest(JSON.parse(curlText(UPDATE_MANIFEST_URL)))
  if (manifest.version !== version || manifest.downloadURL !== downloadURL) {
    throw new Error('服务器返回的发布清单与本次发布不一致')
  }
  const remoteUpdateManifest = curlText(new URL('latest-mac.yml', UPDATE_MANIFEST_URL).href)
  if (remoteUpdateManifest !== updateManifest) throw new Error('服务器返回的应用内更新清单与本次发布不一致')
  run('curl', [
    '--head',
    '--silent',
    '--show-error',
    '--fail',
    '--noproxy', '*',
    '--max-time', '30',
    downloadURL,
  ])
  run('curl', ['--head', '--silent', '--show-error', '--fail', '--noproxy', '*', '--max-time', '30',
    LATEST_DMG_URL])
  run('curl', ['--head', '--silent', '--show-error', '--fail', '--noproxy', '*', '--max-time', '30',
    new URL(artifactName(version, 'zip'), UPDATE_MANIFEST_URL).href])
}

function openReleaseSSH(remoteTarget) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'minduck-release-ssh-'))
  const controlPath = path.join(directory, 'control')
  const options = [
    '-o', 'ControlPath=' + controlPath,
    '-o', 'ControlMaster=auto',
    '-o', 'ControlPersist=90m',
    '-o', 'ServerAliveInterval=30',
    '-o', 'ServerAliveCountMax=3',
  ]
  try {
    // Authenticate before the lengthy notarized build and reuse it for upload.
    run('ssh', [...options, '-MNf', remoteTarget])
  } catch (error) {
    fs.rmSync(directory, { recursive: true, force: true })
    throw new Error('无法建立服务器 SSH 连接: ' + error.message)
  }
  return {
    options,
    close: () => {
      spawnSync('ssh', ['-S', controlPath, '-O', 'exit', remoteTarget], { stdio: 'ignore' })
      fs.rmSync(directory, { recursive: true, force: true })
    },
  }
}

function publish(requestedVersion, { uploadOnly = false } = {}) {
  if (requestedVersion !== undefined) parseVersion(requestedVersion)
  if (process.env.MINDUCK_MACOS_SIGN === '0') throw new Error('对外发布必须启用签名和公证')
  const packageJson = JSON.parse(fs.readFileSync(PACKAGE_JSON, 'utf8'))
  const remote = remoteLatestRelease()
  const version = selectReleaseVersion({ currentVersion: packageJson.version, latestVersion: remote.version,
    requestedVersion, uploadOnly })
  console.log(`准备${uploadOnly ? '上传' : '发布'} ${version}（本地 ${packageJson.version}，线上 ${remote.version}）`)
  const remoteTarget = `${REMOTE_USER}@${REMOTE_HOST}`
  const ssh = openReleaseSSH(remoteTarget)

  try {
    if (!uploadOnly) {
      run('xcrun', ['notarytool', 'history', '--keychain-profile', NOTARY_PROFILE])
      run('pnpm', ['test'])
      const changedVersion = updatePackageVersion(PACKAGE_JSON, version)
      if (changedVersion) console.log(`已更新 package.json 版本：${packageJson.version} -> ${version}`)
      else console.log(`复用待发布版本：${version}`)
      run('pnpm', ['dist:mac'])
    }

    const dmg = artifactName(version)
    const { directory, dmgPath: localDMG, zipPath: localZIP, manifestPath: localManifest } = localReleasePaths(version)
    if (!fs.statSync(localDMG).isFile()) throw new Error(`打包后未找到 ${localDMG}`)
    const checksum = sha256(localDMG)
    const zip = artifactName(version, 'zip')
    verifyUpdateArtifacts(directory, localManifest, version)
    const zipChecksum = sha256(localZIP)
    const manifestChecksum = sha256(localManifest)
    if (uploadOnly) verifyExistingNotarization({ version, checksum, zipChecksum, localDMG })
    const downloadURL = releaseDownloadURL(version)
    const manifestDownloadURL = new URL(dmg, LEGACY_UPDATE_DOWNLOAD_BASE_URL).href
    const remoteArtifact = `${REMOTE_RELEASE_DIR}/${dmg}.uploading`

    run('scp', [...ssh.options, localDMG, `${remoteTarget}:${remoteArtifact}`])
    run('scp', [...ssh.options, localZIP, `${remoteTarget}:${REMOTE_RELEASE_DIR}/${zip}.uploading`])
    run('scp', [...ssh.options, localManifest, `${remoteTarget}:${REMOTE_RELEASE_DIR}/latest-mac.yml.uploading`])
    // Older installed clients require this legacy field to remain same-origin.
    run('ssh', [...ssh.options, remoteTarget, 'bash -s', '--', version, manifestDownloadURL,
      checksum, zipChecksum, manifestChecksum], {
      input: remotePublishScript(),
      stdio: ['pipe', 'inherit', 'inherit'],
    })
    verifyPublishedRelease({ version, downloadURL, updateManifest: fs.readFileSync(localManifest, 'utf8') })
    if (uploadOnly) {
      const legacyManifest = JSON.stringify({ version, downloadUrl: manifestDownloadURL }, null, 2) + '\n'
      const legacyChecksum = createHash('sha256').update(legacyManifest).digest('hex')
      run('ssh', [...ssh.options, remoteTarget, 'bash -s', '--', version, manifestChecksum, legacyChecksum], {
        input: remoteCleanupScript(), stdio: ['pipe', 'inherit', 'inherit'],
      })
    }
    console.log(`发布完成：${LATEST_DMG_URL}`)
  } finally {
    ssh.close()
  }
}

function main() {
  const argument = process.argv[2]
  if (process.argv.length > 3) {
    console.error('用法：pnpm release:mac [x.y.z] 或 pnpm upload:mac')
    process.exitCode = 1
    return
  }
  try {
    const uploadOnly = argument === '--upload-only'
    publish(uploadOnly ? undefined : argument, { uploadOnly })
  } catch (error) {
    console.error(`发布未完成：${error.message}`)
    process.exitCode = 1
  }
}

if (require.main === module) main()

module.exports = {
  REMOTE_RELEASE_DIR,
  artifactName,
  assertVersionProgression,
  localReleasePaths,
  openReleaseSSH,
  releaseDownloadURL,
  remotePublishScript,
  remoteCleanupScript,
  selectReleaseVersion,
  updatePackageVersion,
}
