const assert = require('node:assert/strict')
const { test } = require('node:test')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const { execFileSync } = require('node:child_process')
const { loopbackOrigin, hostCommand, runtimeRoot } = require('../src/companion/runtime.cjs')
const { createSettingsProtocol, windowFile } = require('../src/companion/settings-protocol.cjs')

test('companion child uses this app and separate data, never an installed Coopanion', () => {
  const app = { isPackaged: false, getAppPath: () => '/app' }
  const command = hostCommand(app, '/runtime', '/profile/companion')
  assert.equal(command[0], process.execPath)
  assert.equal(command[1], '/app')
  assert.ok(command.includes('--minduck-companion-host'))
  assert.ok(command.includes('--companion-data=/profile/companion'))
  assert.equal(hostCommand({ isPackaged: true }, '/runtime', '/data')[1], '--minduck-companion-host')
  assert.match(runtimeRoot(app), /vendor\/coopanion\/runtime$/)
})

test('only a parsed IPv4 loopback HTTP origin is an eligible pet server', () => {
  assert.equal(loopbackOrigin('http://127.0.0.1:17897/pet#key=redacted'), 'http://127.0.0.1:17897')
  for (const value of ['https://example.com', 'http://127.0.0.1.evil:17897', 'file:///tmp/pet', 'invalid']) {
    assert.equal(loopbackOrigin(value), null)
  }
})

test('settings files are contained, including encoded traversal and symlink escapes', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'companion-protocol-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const directory = path.join(root, 'ui')
  fs.mkdirSync(directory)
  fs.writeFileSync(path.join(directory, 'index.html'), '<h1>Settings</h1>')
  fs.writeFileSync(path.join(root, 'secret'), 'private')
  fs.symlinkSync(path.join(root, 'secret'), path.join(directory, 'escape'))
  const origin = 'http://127.0.0.1:17888'
  assert.equal(await windowFile(directory, new URL(origin + '/coopanion/')).text(), '<h1>Settings</h1>')
  assert.equal(windowFile(directory, new URL(origin + '/coopanion/escape')).status, 403)
  assert.notEqual(windowFile(directory, new URL(origin + '/coopanion/%2e%2e%2fsecret')).status, 200)
})

test('settings proxy refuses remote origins and sandbox-to-Core API requests', async () => {
  const handler = createSettingsProtocol({ directory: '/unused', coreOrigin: () => 'http://127.0.0.1:17888',
    petOrigin: async () => 'http://127.0.0.1:17897', core: {} })
  for (const [url, referrer] of [
    ['https://example.com/api', 'http://127.0.0.1:17888/coopanion/'],
    ['http://127.0.0.1:17888/api/config', 'http://127.0.0.1:17897/figure-frame'],
    ['http://127.0.0.1:17888/api/config', ''],
    ['http://127.0.0.1:17897/api/private', ''],
    ['http://127.0.0.1:17899/api', 'http://127.0.0.1:17888/coopanion/'],
  ]) {
    assert.equal((await handler({ url, referrer, method: 'GET' })).status, 403)
  }
})

test('vendor defaults use the ordinary duck and preserve explicit setup isolated from Matter', () => {
  const root = path.resolve(__dirname, '../vendor/coopanion/runtime')
  const seed = fs.readFileSync(path.join(root, 'core/seed.ts'), 'utf8')
  assert.match(seed, /figure: 'minduck-duck'/)
  const figure = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../src/companion/figures/minduck-duck/figure.json'), 'utf8'))
  assert.equal(figure.id, 'minduck-duck')
  assert.equal(figure.api, 2)
  assert.equal(figure.export, 'createDuckBody')
  assert.match(seed, /telemetry: false/)
  assert.match(seed, /asr: \{ enabled: false \}/)
  const main = fs.readFileSync(path.join(__dirname, '../src/main.cjs'), 'utf8')
  assert.doesNotMatch(main, /pet:drag|PET_WINDOW_SIZE|function createPetWindow/)
})

function seedProfile(home) {
  const root = path.resolve(__dirname, '../vendor/coopanion/runtime')
  execFileSync(process.execPath, ['--import', path.join(root, 'node_modules/tsx/dist/loader.mjs'),
    '--import', path.join(root, 'build/cortico/src/extensions/runtime.ts'),
    '--input-type=module', '-e', 'const {seed}=await import(process.argv[1]);seed(process.argv[2],"zh")',
    pathToFileURL(path.join(root, 'core/seed.ts')).href, home], { cwd: root, timeout: 15000 })
  return path.join(home, 'companion/config.json')
}

test('a fresh profile explicitly opens the desktop window with the default duck', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'companion-default-visible-'))
  try {
    const config = JSON.parse(fs.readFileSync(seedProfile(home), 'utf8'))
    assert.equal(config.worlds['desktop-pet'].enabled, true)
    assert.equal(config.worlds['desktop-pet'].window.enabled, true)
    assert.equal(config.worlds['desktop-pet'].skin.figure, 'minduck-duck')
    assert.equal(config.worlds['desktop-pet'].asr.enabled, false)
    assert.equal(config.companion.telemetry, false)
  } finally { fs.rmSync(home, { recursive: true, force: true }) }
})

test('seeding again preserves explicit existing visibility and character choices', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'companion-saved-visibility-'))
  try {
    const file = seedProfile(home)
    const config = JSON.parse(fs.readFileSync(file, 'utf8'))
    config.worlds['desktop-pet'].enabled = false
    config.worlds['desktop-pet'].window = { enabled: false, scale: 1.25 }
    config.worlds['desktop-pet'].skin.figure = 'minduck-suit-duck'
    fs.writeFileSync(file, JSON.stringify(config))
    seedProfile(home)
    assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), config)
  } finally { fs.rmSync(home, { recursive: true, force: true }) }
})
