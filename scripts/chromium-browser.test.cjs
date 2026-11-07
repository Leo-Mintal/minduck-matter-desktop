const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const {
  browserProfileDirectory,
  chromiumBinaryForApp,
  chromiumRuntimeApp,
  extensionPaths,
  launchArguments,
  createMatterBackgroundTab,
} = require('../src/chromiumBrowser.cjs')
const { BROWSER_MAX_WIDTH, browserWidth, desktopWindowLayout } = require('../src/desktopWindowLayout.cjs')

test('places Matter and the Chromium browser side by side in one display work area', () => {
  const layout = desktopWindowLayout({ x: 20, y: 40, width: 1280, height: 800 })
  assert.deepEqual(layout.matter, { x: 20, y: 40, width: 819, height: 800 })
  assert.deepEqual(layout.browser, { x: 839, y: 40, width: 461, height: 800 })
  assert.equal(layout.matter.width + layout.browser.width, 1280)
  assert.equal(browserWidth(2400), BROWSER_MAX_WIDTH)
})

test('uses an app-owned Chromium profile rather than the user Chrome profile', () => {
  assert.equal(
    browserProfileDirectory('/Users/example'),
    '/Users/example/Library/Application Support/Minduck Matter Desktop Browser',
  )
})

test('resolves development and packaged Chromium runtime paths with unpacked extensions', () => {
  assert.equal(
    chromiumBinaryForApp('/Applications/Chromium.app'),
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
  )
  assert.equal(
    chromiumRuntimeApp({ isPackaged: true, resourcesPath: '/Applications/Minduck Matter.app/Contents/Resources' }),
    '/Applications/Minduck Matter.app/Contents/Resources/chromium/Chromium.app',
  )
  assert.deepEqual(
    extensionPaths({ isPackaged: true, resourcesPath: '/Resources' }),
    ['/Resources/app.asar.unpacked/extensions/matter-browser', '/Resources/app.asar.unpacked/extensions/xiaohongshu'],
  )
})

test('launches a normal Chromium window with the existing extensions and a debugging port', () => {
  const args = launchArguments({
    profile: '/tmp/minduck-profile',
    bounds: { x: 819, y: 0, width: 461, height: 800 },
    extensions: ['/extensions/matter-browser', '/extensions/xiaohongshu'],
    origin: 'http://localhost:3001/',
  })
  assert.ok(args.includes('--remote-debugging-port=0'))
  assert.ok(args.includes('--user-data-dir=/tmp/minduck-profile'))
  assert.ok(args.includes('--window-position=819,0'))
  assert.ok(args.includes('--window-size=461,800'))
  assert.ok(args.includes('--load-extension=/extensions/matter-browser,/extensions/xiaohongshu'))
  assert.deepEqual(args.slice(-2), ['--new-window', 'about:blank'])
})

test('creates the background Matter target only after a debugging endpoint resolves', async () => {
  const commands = []
  const originalWebSocket = global.WebSocket
  global.WebSocket = class FakeWebSocket {
    constructor() {
      queueMicrotask(() => this.open?.())
    }
    addEventListener(name, callback) {
      if (name === 'open') this.open = callback
      if (name === 'message') this.message = callback
    }
    send(payload) {
      commands.push(JSON.parse(payload))
      queueMicrotask(() => this.message({ data: JSON.stringify({ id: 1, result: { targetId: 'matter-target' } }) }))
    }
    close() {}
  }

  try {
    const result = await createMatterBackgroundTab(
      { webSocketDebuggerUrl: 'ws://127.0.0.1:9222/devtools/browser/test' },
      'http://localhost:3001/',
    )
    assert.equal(result.targetId, 'matter-target')
    assert.deepEqual(commands[0], {
      id: 1,
      method: 'Target.createTarget',
      params: { url: 'http://localhost:3001/', background: true },
    })
  } finally {
    global.WebSocket = originalWebSocket
  }
})
