const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const {
  DEFAULT_MATTER_ORIGIN,
  chromiumBinaryForApp,
  extensionPaths,
  matterOrigin,
} = require('../minduck-matter-chromium/scripts/config.cjs')
const { launchArguments } = require('../minduck-matter-chromium/scripts/launch.cjs')

test('uses the local Matter service and the two unchanged bundled extensions', () => {
  assert.equal(matterOrigin('http://localhost:3001'), DEFAULT_MATTER_ORIGIN + '/')
  assert.deepEqual(
    extensionPaths().map((extensionPath) => path.basename(extensionPath)),
    ['matter-browser', 'xiaohongshu'],
  )
})

test('builds Chromium launch flags with an isolated profile and unpacked extensions', () => {
  const args = launchArguments('/tmp/minduck-profile', 'http://localhost:3001/')
  assert.ok(args.includes('--user-data-dir=/tmp/minduck-profile'))
  assert.ok(args.some((arg) => arg.startsWith('--load-extension=') && arg.includes('matter-browser') && arg.includes('xiaohongshu')))
  assert.equal(args.at(-1), 'http://localhost:3001/')
})

test('locates a Chromium executable inside a Chromium app bundle', () => {
  assert.equal(
    chromiumBinaryForApp('/Applications/Chromium.app'),
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
  )
})
