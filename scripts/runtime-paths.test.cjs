const test = require('node:test')
const assert = require('node:assert/strict')
const { developmentUserDataPath } = require('../src/runtimePaths.cjs')

test('keeps development browser data separate from the packaged app profile', () => {
  assert.equal(
    developmentUserDataPath('/Users/example/Library/Application Support'),
    '/Users/example/Library/Application Support/minduck-matter-desktop-dev',
  )
  assert.equal(
    developmentUserDataPath('/Users/example/Library/Application Support', '/tmp/minduck-profile'),
    '/tmp/minduck-profile',
  )
})
