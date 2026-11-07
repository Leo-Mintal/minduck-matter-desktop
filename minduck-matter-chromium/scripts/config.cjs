const fs = require('node:fs')
const path = require('node:path')

const chromiumRoot = path.resolve(__dirname, '..')
const projectRoot = path.resolve(chromiumRoot, '..')
const DEFAULT_MATTER_ORIGIN = 'http://localhost:3001'

function matterOrigin(value = process.env.MINDUCK_MATTER_ORIGIN) {
  const raw = value || DEFAULT_MATTER_ORIGIN
  let url
  try {
    url = new URL(raw)
  } catch {
    throw new Error('MINDUCK_MATTER_ORIGIN must be an HTTP(S) URL')
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('MINDUCK_MATTER_ORIGIN must be an HTTP(S) URL')
  }

  return url.href
}

function chromiumBinaryForApp(appPath) {
  return path.join(appPath, 'Contents', 'MacOS', 'Chromium')
}

function extensionPaths() {
  return [
    path.join(projectRoot, 'extensions', 'matter-browser'),
    path.join(projectRoot, 'extensions', 'xiaohongshu'),
  ]
}

function downloadedChromiumApp() {
  return path.join(chromiumRoot, 'vendor', 'chromium', 'Chromium.app')
}

function resolveChromiumBinary() {
  if (process.env.MINDUCK_CHROMIUM_BINARY) return path.resolve(process.env.MINDUCK_CHROMIUM_BINARY)
  if (process.env.MINDUCK_CHROMIUM_APP) return chromiumBinaryForApp(path.resolve(process.env.MINDUCK_CHROMIUM_APP))
  return chromiumBinaryForApp(downloadedChromiumApp())
}

function assertLaunchPrerequisites(binary = resolveChromiumBinary()) {
  if (!fs.existsSync(binary)) {
    throw new Error(
      'Chromium runtime not found. Run "pnpm chromium:download" or set MINDUCK_CHROMIUM_BINARY.',
    )
  }

  for (const extensionPath of extensionPaths()) {
    if (!fs.existsSync(extensionPath)) throw new Error(`Bundled extension not found: ${extensionPath}`)
  }
}

module.exports = {
  DEFAULT_MATTER_ORIGIN,
  assertLaunchPrerequisites,
  chromiumBinaryForApp,
  chromiumRoot,
  downloadedChromiumApp,
  extensionPaths,
  matterOrigin,
  projectRoot,
  resolveChromiumBinary,
}
