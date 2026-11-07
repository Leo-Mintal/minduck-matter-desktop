const assert = require('node:assert/strict')
const fs = require('node:fs')
const http = require('node:http')
const os = require('node:os')
const path = require('node:path')
const { spawn } = require('node:child_process')
const {
  assertLaunchPrerequisites,
  extensionPaths,
  resolveChromiumBinary,
} = require('./config.cjs')

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function availablePort() {
  const server = http.createServer()
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  await new Promise((resolve) => server.close(resolve))
  return address.port
}

async function waitForMatterBrowserWorker(port) {
  const deadline = Date.now() + 20_000
  let lastError
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`)
      if (response.ok) {
        const targets = await response.json()
        const workers = targets.filter((target) => target.type === 'service_worker' && target.webSocketDebuggerUrl)
        for (const worker of workers) {
          const name = await evaluate(worker.webSocketDebuggerUrl, 'chrome.runtime.getManifest().name')
          if (name === 'Minduck Matter 浏览器助手') return worker
        }
      }
    } catch (error) {
      lastError = error
    }
    await delay(200)
  }
  throw new Error(`Matter Browser extension service worker did not become inspectable: ${lastError?.message || 'timed out'}`)
}

function evaluate(webSocketDebuggerUrl, expression) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(webSocketDebuggerUrl)
    const timer = setTimeout(() => {
      socket.close()
      reject(new Error('Timed out evaluating extension APIs'))
    }, 10_000)

    socket.addEventListener('open', () => {
      socket.send(JSON.stringify({
        id: 1,
        method: 'Runtime.evaluate',
        params: { expression, awaitPromise: true, returnByValue: true },
      }))
    })
    socket.addEventListener('message', (event) => {
      const response = JSON.parse(event.data)
      if (response.id !== 1) return
      clearTimeout(timer)
      socket.close()
      if (response.result?.exceptionDetails) {
        reject(new Error(JSON.stringify(response.result.exceptionDetails)))
        return
      }
      resolve(response.result?.result?.value)
    })
    socket.addEventListener('error', (event) => {
      clearTimeout(timer)
      reject(new Error(`DevTools WebSocket failed: ${event.message || 'unknown error'}`))
    })
  })
}

async function stop(child) {
  if (child.exitCode !== null || child.signalCode) return
  child.kill('SIGTERM')
  const deadline = Date.now() + 5_000
  while (child.exitCode === null && child.signalCode === null && Date.now() < deadline) await delay(100)
  if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
}

async function smoke() {
  const binary = resolveChromiumBinary()
  assertLaunchPrerequisites(binary)

  const port = await availablePort()
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'minduck-matter-chromium-smoke-'))
  const child = spawn(binary, [
    '--no-first-run',
    '--no-default-browser-check',
    '--remote-allow-origins=*',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    `--load-extension=${extensionPaths().join(',')}`,
    'about:blank',
  ], { stdio: 'ignore' })

  try {
    const worker = await waitForMatterBrowserWorker(port)
    const raw = await evaluate(worker.webSocketDebuggerUrl, `
      const inspect = (promise) => promise
        .then((value) => ({ ok: true, count: value.length }))
        .catch((error) => ({ ok: false, error: String(error?.message || error) }));
      const unavailable = (name) => Promise.resolve({ ok: false, error: name + ' is unavailable' });
      Promise.all([
        chrome.tabs?.query ? inspect(chrome.tabs.query({})) : unavailable('chrome.tabs.query'),
        chrome.tabGroups?.query ? inspect(chrome.tabGroups.query({})) : unavailable('chrome.tabGroups.query'),
        chrome.debugger?.getTargets ? inspect(chrome.debugger.getTargets()) : unavailable('chrome.debugger.getTargets'),
      ]).then(async ([tabs, groups, debuggerTargets]) => ({
        apis: {
          tabs: typeof chrome.tabs?.query,
          scripting: typeof chrome.scripting?.executeScript,
          debugger: typeof chrome.debugger?.attach,
          tabGroups: typeof chrome.tabGroups?.query,
        },
        extension: (() => {
          const manifest = chrome.runtime.getManifest();
          return {
            name: manifest.name,
            version: manifest.version,
            permissions: manifest.permissions,
          };
        })(),
        runtime: {
          id: chrome.runtime.id,
          platform: await chrome.runtime.getPlatformInfo(),
        },
        calls: { tabs, groups, debuggerTargets },
      }))
    `)
    console.log(JSON.stringify({ worker: worker.url, ...raw }))
    assert.deepEqual(raw.apis, {
      tabs: 'function',
      scripting: 'function',
      debugger: 'function',
      tabGroups: 'function',
    })
    assert.deepEqual(raw.calls, {
      tabs: { ok: true, count: raw.calls.tabs.count },
      groups: { ok: true, count: raw.calls.groups.count },
      debuggerTargets: { ok: true, count: raw.calls.debuggerTargets.count },
    })
  } finally {
    await stop(child)
    fs.rmSync(profile, { recursive: true, force: true })
  }
}

smoke().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
