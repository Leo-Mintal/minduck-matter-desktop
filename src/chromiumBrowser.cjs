const fs = require('node:fs')
const http = require('node:http')
const os = require('node:os')
const path = require('node:path')
const { spawn } = require('node:child_process')
const { DEFAULT_MATTER_ORIGIN, normalizeMatterOrigin } = require('./matterService.cjs')

const MATTER_ORIGIN = DEFAULT_MATTER_ORIGIN
const PROJECT_ROOT = path.resolve(__dirname, '..')
const RUNTIME_APP_NAME = 'Chromium.app'
const PROFILE_NAME = 'Minduck Matter Desktop Browser'
const DEVTOOLS_ACTIVE_PORT = 'DevToolsActivePort'

function matterOrigin(value = process.env.MINDUCK_MATTER_ORIGIN) {
  return normalizeMatterOrigin(value || MATTER_ORIGIN) + '/'
}

function chromiumBinaryForApp(appPath) {
  return path.join(appPath, 'Contents', 'MacOS', 'Chromium')
}

function chromiumRuntimeApp(runtime = {}) {
  if (runtime.isPackaged) {
    return path.join(runtime.resourcesPath, 'chromium', RUNTIME_APP_NAME)
  }
  return path.join(PROJECT_ROOT, 'minduck-matter-chromium', 'vendor', 'chromium', RUNTIME_APP_NAME)
}

function chromiumBinary(runtime = {}) {
  if (process.env.MINDUCK_DESKTOP_CHROMIUM_BINARY) {
    return path.resolve(process.env.MINDUCK_DESKTOP_CHROMIUM_BINARY)
  }
  return chromiumBinaryForApp(chromiumRuntimeApp(runtime))
}

function extensionPaths(runtime = {}) {
  const root = runtime.isPackaged
    ? path.join(runtime.resourcesPath, 'app.asar.unpacked', 'extensions')
    : path.join(PROJECT_ROOT, 'extensions')
  return [path.join(root, 'matter-browser'), path.join(root, 'xiaohongshu')]
}

function browserProfileDirectory(homeDirectory = os.homedir()) {
  if (process.env.MINDUCK_DESKTOP_CHROMIUM_PROFILE) {
    return path.resolve(process.env.MINDUCK_DESKTOP_CHROMIUM_PROFILE)
  }
  return path.join(homeDirectory, 'Library', 'Application Support', PROFILE_NAME)
}

function launchArguments({ profile, bounds, extensions, origin }) {
  return [
    '--no-first-run',
    '--no-default-browser-check',
    '--remote-debugging-port=0',
    `--user-data-dir=${profile}`,
    `--load-extension=${extensions.join(',')}`,
    `--window-position=${bounds.x},${bounds.y}`,
    `--window-size=${bounds.width},${bounds.height}`,
    '--new-window',
    'about:blank',
  ]
}

function assertLaunchPrerequisites(binary, extensions) {
  if (!fs.existsSync(binary)) {
    throw new Error('Chromium runtime not found. Run "pnpm chromium:download" before starting Matter Desktop.')
  }
  for (const extensionPath of extensions) {
    if (!fs.existsSync(extensionPath)) throw new Error(`Bundled extension not found: ${extensionPath}`)
  }
}

function requestJSON(url) {
  return new Promise((resolve, reject) => {
    const request = http.get(url, { timeout: 3_000 }, (response) => {
      let body = ''
      response.setEncoding('utf8')
      response.on('data', (chunk) => {
        body += chunk
      })
      response.on('end', () => {
        if (response.statusCode !== 200) {
          reject(new Error(`Chromium debugging endpoint returned ${response.statusCode}`))
          return
        }
        try {
          resolve(JSON.parse(body))
        } catch (error) {
          reject(error)
        }
      })
    })
    request.once('timeout', () => request.destroy(new Error('Chromium debugging endpoint timed out')))
    request.once('error', reject)
  })
}

function waitForDevToolsActivePort(profile, timeout = 10_000) {
  const file = path.join(profile, DEVTOOLS_ACTIVE_PORT)
  const deadline = Date.now() + timeout

  return new Promise((resolve, reject) => {
    const attempt = () => {
      try {
        const [port] = fs.readFileSync(file, 'utf8').trim().split(/\r?\n/)
        if (/^\d+$/.test(port)) {
          resolve(Number(port))
          return
        }
      } catch (error) {
        if (error.code !== 'ENOENT') {
          reject(error)
          return
        }
      }

      if (Date.now() >= deadline) {
        reject(new Error('Chromium did not expose its debugging port in time'))
        return
      }
      setTimeout(attempt, 100)
    }
    attempt()
  })
}

function cdpCommand(webSocketDebuggerUrl, method, params = {}) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(webSocketDebuggerUrl)
    const id = 1
    let settled = false
    const timer = setTimeout(() => fail(new Error(`Chromium CDP command timed out: ${method}`)), 5_000)

    const finish = (callback, value) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      socket.close()
      callback(value)
    }
    const fail = (error) => finish(reject, error)

    socket.addEventListener('open', () => {
      socket.send(JSON.stringify({ id, method, params }))
    })
    socket.addEventListener('error', () => fail(new Error(`Chromium CDP connection failed: ${method}`)))
    socket.addEventListener('message', (event) => {
      let message
      try {
        message = JSON.parse(event.data)
      } catch (error) {
        fail(error)
        return
      }
      if (message.id !== id) return
      if (message.error) {
        fail(new Error(`Chromium CDP ${method} failed: ${message.error.message || 'unknown error'}`))
        return
      }
      finish(resolve, message.result)
    })
  })
}

async function debuggingEndpoint(profile) {
  const port = await waitForDevToolsActivePort(profile)
  const version = await requestJSON(`http://127.0.0.1:${port}/json/version`)
  if (!version.webSocketDebuggerUrl) throw new Error('Chromium did not return a browser debugging URL')
  return { port, webSocketDebuggerUrl: version.webSocketDebuggerUrl }
}

async function createMatterBackgroundTab(endpoint, origin) {
  return cdpCommand(endpoint.webSocketDebuggerUrl, 'Target.createTarget', {
    url: origin,
    background: true,
  })
}

async function setBrowserWindowBounds(endpoint, bounds) {
  const targets = await cdpCommand(endpoint.webSocketDebuggerUrl, 'Target.getTargets')
  const target = targets.targetInfos.find((item) => item.type === 'page' && item.url !== matterOrigin())
    || targets.targetInfos.find((item) => item.type === 'page')
  if (!target) throw new Error('Chromium has no browser page to arrange')

  const { windowId } = await cdpCommand(endpoint.webSocketDebuggerUrl, 'Browser.getWindowForTarget', {
    targetId: target.targetId,
  })
  return cdpCommand(endpoint.webSocketDebuggerUrl, 'Browser.setWindowBounds', {
    windowId,
    bounds: {
      left: bounds.x,
      top: bounds.y,
      width: bounds.width,
      height: bounds.height,
      windowState: 'normal',
    },
  })
}

function startChromiumBrowser({ runtime, bounds, origin = matterOrigin(), logger = console, spawnProcess = spawn } = {}) {
  if (!bounds) throw new Error('Chromium browser bounds are required')

  const binary = chromiumBinary(runtime)
  const extensions = extensionPaths(runtime)
  const profile = browserProfileDirectory()
  assertLaunchPrerequisites(binary, extensions)
  fs.mkdirSync(profile, { recursive: true })
  fs.rmSync(path.join(profile, DEVTOOLS_ACTIVE_PORT), { force: true })

  const child = spawnProcess(binary, launchArguments({ profile, bounds, extensions, origin }), {
    detached: false,
    stdio: 'ignore',
  })
  child.unref()
  child.once('error', (error) => logger.error('Failed to launch bundled Chromium:', error.message))

  let endpointPromise
  const endpoint = () => {
    if (!endpointPromise) endpointPromise = debuggingEndpoint(profile)
    return endpointPromise
  }

  return {
    child,
    profile,
    binary,
    extensions,
    createMatterBackgroundTab: () => endpoint().then((value) => createMatterBackgroundTab(value, origin)),
    setBounds: (nextBounds) => endpoint().then((value) => setBrowserWindowBounds(value, nextBounds)),
    stop: () => {
      if (!child.killed) child.kill()
    },
  }
}

module.exports = {
  DEVTOOLS_ACTIVE_PORT,
  MATTER_ORIGIN,
  PROFILE_NAME,
  RUNTIME_APP_NAME,
  assertLaunchPrerequisites,
  browserProfileDirectory,
  cdpCommand,
  chromiumBinary,
  chromiumBinaryForApp,
  chromiumRuntimeApp,
  createMatterBackgroundTab,
  debuggingEndpoint,
  extensionPaths,
  launchArguments,
  matterOrigin,
  setBrowserWindowBounds,
  startChromiumBrowser,
  waitForDevToolsActivePort,
}
