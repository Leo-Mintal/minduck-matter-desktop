#!/usr/bin/env node

const { spawnSync } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const {
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

function artifactName(version) {
  parseVersion(version)
  return `MinduckMatter-${version}-arm64.dmg`
}

function releaseDownloadURL(version) {
  return new URL(artifactName(version), UPDATE_MANIFEST_URL).href
}

function assertVersionProgression({ currentVersion, latestVersion, nextVersion }) {
  parseVersion(currentVersion)
  parseVersion(latestVersion)
  parseVersion(nextVersion)
  if (compareVersions(nextVersion, currentVersion) < 0) {
    throw new Error(`发布版本 ${nextVersion} 不能低于本地版本 ${currentVersion}`)
  }
  if (compareVersions(nextVersion, latestVersion) <= 0) {
    throw new Error(`发布版本 ${nextVersion} 必须高于服务器当前版本 ${latestVersion}`)
  }
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
    `release_dir="${REMOTE_RELEASE_DIR}"`,
    'dmg="MinduckMatter-${version}-arm64.dmg"',
    '',
    'test -s "$release_dir/$dmg.uploading"',
    'actual_checksum="$(shasum -a 256 "$release_dir/$dmg.uploading" | awk \'{print $1}\')"',
    'test "$actual_checksum" = "$expected_checksum"',
    'mv "$release_dir/$dmg.uploading" "$release_dir/$dmg"',
    '',
    "printf '{\\n  \"version\": \"%s\",\\n  \"downloadUrl\": \"%s\"\\n}\\n' \"$version\" \"$download_url\" > \"$release_dir/latest.json.next\"",
    'mv "$release_dir/latest.json.next" "$release_dir/latest.json"',
    '',
  ].join('\n')
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

function verifyPublishedRelease({ version, downloadURL }) {
  const manifest = parseManifest(JSON.parse(curlText(UPDATE_MANIFEST_URL)))
  if (manifest.version !== version || manifest.downloadURL !== downloadURL) {
    throw new Error('服务器返回的发布清单与本次发布不一致')
  }
  run('curl', [
    '--head',
    '--silent',
    '--show-error',
    '--fail',
    '--noproxy', '*',
    '--max-time', '30',
    downloadURL,
  ])
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

function publish(version) {
  parseVersion(version)
  const packageJson = JSON.parse(fs.readFileSync(PACKAGE_JSON, 'utf8'))
  const remote = remoteLatestRelease()
  assertVersionProgression({ currentVersion: packageJson.version, latestVersion: remote.version, nextVersion: version })
  const remoteTarget = `${REMOTE_USER}@${REMOTE_HOST}`
  const ssh = openReleaseSSH(remoteTarget)

  try {
    run('xcrun', ['notarytool', 'history', '--keychain-profile', NOTARY_PROFILE])
    run('pnpm', ['test'])
    const changedVersion = updatePackageVersion(PACKAGE_JSON, version)
    if (changedVersion) console.log(`已更新 package.json 版本：${packageJson.version} -> ${version}`)
    else console.log(`复用待发布版本：${version}`)

    run('pnpm', ['dist:mac'])

    const dmg = artifactName(version)
    const localDMG = path.join(RELEASE_DIR, dmg)
    if (!fs.statSync(localDMG).isFile()) throw new Error(`打包后未找到 ${localDMG}`)
    const checksum = sha256(localDMG)
    const downloadURL = releaseDownloadURL(version)
    const manifestDownloadURL = new URL(dmg, LEGACY_UPDATE_DOWNLOAD_BASE_URL).href
    const remoteArtifact = `${REMOTE_RELEASE_DIR}/${dmg}.uploading`

    run('scp', [...ssh.options, localDMG, `${remoteTarget}:${remoteArtifact}`])
    // Older installed clients require this legacy field to remain same-origin.
    run('ssh', [...ssh.options, remoteTarget, 'bash -s', '--', version, manifestDownloadURL, checksum], {
      input: remotePublishScript(),
      stdio: ['pipe', 'inherit', 'inherit'],
    })
    verifyPublishedRelease({ version, downloadURL })
    console.log(`发布完成：${downloadURL}`)
  } finally {
    ssh.close()
  }
}

function main() {
  const [version] = process.argv.slice(2)
  if (!version || process.argv.length !== 3) {
    console.error('用法：pnpm release:mac <x.y.z>')
    process.exitCode = 1
    return
  }
  try {
    publish(version)
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
  openReleaseSSH,
  releaseDownloadURL,
  remotePublishScript,
  updatePackageVersion,
}
