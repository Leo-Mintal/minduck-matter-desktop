const assert = require('node:assert/strict')
const test = require('node:test')
const {
  DEFAULT_MATTER_ORIGIN,
  isMatterWebURL,
  normalizeMatterOrigin,
  resolveMatterOrigin,
} = require('../src/matterService.cjs')

test('uses the packaged production origin unless an override is configured', () => {
  assert.equal(DEFAULT_MATTER_ORIGIN, 'https://matter.minduck.com')
  assert.equal(resolveMatterOrigin(null, null), DEFAULT_MATTER_ORIGIN)
  assert.equal(resolveMatterOrigin('https://custom.example.com', null), 'https://custom.example.com')
  assert.equal(resolveMatterOrigin('https://custom.example.com', 'http://localhost:3001'), 'http://localhost:3001')
})

test('accepts HTTPS origins, loopback HTTP origins, and the exact packaged HTTP test origin', () => {
  assert.equal(normalizeMatterOrigin(' https://matter.example.com/ '), 'https://matter.example.com')
  assert.equal(normalizeMatterOrigin('http://127.0.0.1:3001'), 'http://127.0.0.1:3001')
  assert.equal(normalizeMatterOrigin('http://192.168.11.70:3001/'), 'http://192.168.11.70:3001')
  for (const value of ['http://example.com', 'http://192.168.11.70', 'http://192.168.11.71:3001', 'file:///tmp/page.html', 'https://user:pass@example.com', 'https://example.com/path', 'https://example.com/?x=1']) {
    assert.throws(() => normalizeMatterOrigin(value))
  }
})

test('matches exact Matter origin, including its port', () => {
  assert.equal(isMatterWebURL('https://matter.example.com/team', 'https://matter.example.com'), true)
  assert.equal(isMatterWebURL('https://matter.example.com.evil.test/', 'https://matter.example.com'), false)
  assert.equal(isMatterWebURL('https://matter.example.com:8443/', 'https://matter.example.com'), false)
})
