const assert = require('node:assert/strict')
const test = require('node:test')
const { hasFullDiskAccess } = require('../src/fullDiskAccess.cjs')

test('FDA probe actually opens protected file read-only, closes it, and never reads its contents', () => {
  let closes = 0
  assert.equal(hasFullDiskAccess({ platform: 'darwin', openSync: (filename, flags) => {
    assert.ok(filename.endsWith('/com.apple.TCC/TCC.db'))
    assert.equal(flags, require('node:fs').constants.O_RDONLY)
    return 0
  }, closeSync: fd => { assert.equal(fd, 0); closes++ } }), true)
  assert.equal(closes, 1)
  assert.equal(hasFullDiskAccess({ platform: 'darwin', openSync: () => { throw Error('denied') } }), false)
  assert.equal(hasFullDiskAccess({ platform: 'linux', openSync: () => assert.fail('not macOS') }), false)
})
