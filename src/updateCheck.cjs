const UPDATE_MANIFEST_URL = 'https://matter-desktop.yogeeai.com/download/latest.json'
// Keep the manifest's legacy URL compatible with already installed clients.
// New clients validate it but always open the HTTPS download URL below.
const LEGACY_UPDATE_DOWNLOAD_BASE_URL = 'http://124.70.149.30:8091/'
const UPDATE_TIMEOUT_MS = 10_000
const MAX_MANIFEST_BYTES = 16 * 1024

function parseVersion(value) {
  if (typeof value !== 'string') throw new Error('版本号无效')
  const match = value.match(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/)
  if (!match) throw new Error('版本号无效')
  const parts = match.slice(1).map(Number)
  if (parts.some(part => !Number.isSafeInteger(part))) throw new Error('版本号无效')
  return parts
}

function compareVersions(left, right) {
  const leftParts = parseVersion(left)
  const rightParts = parseVersion(right)
  for (let index = 0; index < leftParts.length; index++) {
    if (leftParts[index] !== rightParts[index]) return leftParts[index] > rightParts[index] ? 1 : -1
  }
  return 0
}

function parseManifest(value, manifestURL = UPDATE_MANIFEST_URL) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('更新清单无效')
  const version = value.version
  parseVersion(version)
  if (typeof value.downloadUrl !== 'string') throw new Error('更新清单无效')

  let manifest, download
  try {
    manifest = new URL(manifestURL)
    download = new URL(value.downloadUrl)
  } catch {
    throw new Error('更新清单无效')
  }

  const expectedFilename = `MinduckMatter-${version}-arm64.dmg`
  const expectedDownload = new URL(expectedFilename, manifest)
  const legacyDownload = new URL(expectedFilename, LEGACY_UPDATE_DOWNLOAD_BASE_URL)
  const acceptsLegacy = manifest.href === UPDATE_MANIFEST_URL && download.href === legacyDownload.href
  if (download.href !== expectedDownload.href && !acceptsLegacy) {
    throw new Error('更新下载地址无效')
  }

  return { version, downloadURL: expectedDownload.href }
}

async function checkForUpdate({ currentVersion, fetchImpl, manifestURL = UPDATE_MANIFEST_URL, timeoutMs = UPDATE_TIMEOUT_MS }) {
  parseVersion(currentVersion)
  if (typeof fetchImpl !== 'function') throw new Error('更新检查不可用')

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  let response
  try {
    response = await fetchImpl(manifestURL, {
      cache: 'no-store',
      redirect: 'error',
      signal: controller.signal,
    })
  } finally {
    clearTimeout(timer)
  }

  if (!response?.ok) throw new Error('更新服务暂时不可用')
  const text = await response.text()
  if (text.length > MAX_MANIFEST_BYTES) throw new Error('更新清单无效')

  let manifest
  try {
    manifest = JSON.parse(text)
  } catch {
    throw new Error('更新清单无效')
  }

  const latest = parseManifest(manifest, manifestURL)
  return compareVersions(latest.version, currentVersion) > 0
    ? { available: true, ...latest }
    : { available: false, currentVersion, latestVersion: latest.version }
}

module.exports = {
  LEGACY_UPDATE_DOWNLOAD_BASE_URL,
  MAX_MANIFEST_BYTES,
  UPDATE_MANIFEST_URL,
  compareVersions,
  checkForUpdate,
  parseManifest,
  parseVersion,
}
