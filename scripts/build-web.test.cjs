const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')
const { stageSharedDesktopStyles } = require('../scripts/build-web.cjs')

test('stages the shared desktop stylesheet at a stable asset path', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'minduck-web-build-test-'))
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  const shell = path.join(directory, 'desktop-shell')
  const assets = path.join(shell, 'assets')
  fs.mkdirSync(assets, { recursive: true })
  fs.writeFileSync(path.join(shell, 'index.html'), '<link rel="stylesheet" href="./assets/index-abc.css">')
  fs.writeFileSync(path.join(assets, 'index-abc.css'), '.b-pill { border-radius: 999px; }')

  assert.equal(stageSharedDesktopStyles(directory), path.join(assets, 'shared.css'))
  assert.equal(fs.readFileSync(path.join(assets, 'shared.css'), 'utf8'), '.b-pill { border-radius: 999px; }')
})
