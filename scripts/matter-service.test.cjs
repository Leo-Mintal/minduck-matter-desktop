const assert = require('node:assert/strict')
const test = require('node:test')
const {
  DEFAULT_MATTER_ORIGIN,
  isMatterWebURL,
  isMatterConversationURL,
  normalizeMatterOrigin,
  resolveMatterOrigin,
} = require('../src/matterService.cjs')

test('uses the packaged production origin unless an override is configured', () => {
  assert.equal(DEFAULT_MATTER_ORIGIN, 'https://matter.minduck.com')
  assert.equal(resolveMatterOrigin(null, null), DEFAULT_MATTER_ORIGIN)
  assert.equal(resolveMatterOrigin('https://custom.example.com', null), 'https://custom.example.com')
  assert.equal(resolveMatterOrigin('https://custom.example.com', 'http://localhost:3001'), 'http://localhost:3001')
})

test('accepts HTTPS origins, loopback HTTP origins, and the exact packaged HTTP test origins', () => {
  assert.equal(normalizeMatterOrigin(' https://matter.example.com/ '), 'https://matter.example.com')
  assert.equal(normalizeMatterOrigin('http://127.0.0.1:3001'), 'http://127.0.0.1:3001')
  assert.equal(normalizeMatterOrigin('http://192.168.11.70:3001/'), 'http://192.168.11.70:3001')
  assert.equal(normalizeMatterOrigin(' http://192.168.11.70:8080/ '), 'http://192.168.11.70:8080')
  assert.equal(resolveMatterOrigin('http://192.168.11.70:8080', null), 'http://192.168.11.70:8080')
  assert.equal(resolveMatterOrigin(null, 'http://192.168.11.70:8080'), 'http://192.168.11.70:8080')
  for (const value of ['http://example.com', 'http://192.168.11.70', 'http://192.168.11.70:8081', 'http://192.168.11.71:3001', 'http://192.168.11.71:8080', 'http://192.168.11.70.evil.test:8080', 'http://192.168.11.70:8080/api', 'http://192.168.11.70:8080/?x=1', 'http://192.168.11.70:8080/#login', 'http://user:pass@192.168.11.70:8080', 'file:///tmp/page.html', 'https://user:pass@example.com', 'https://example.com/path', 'https://example.com/?x=1']) {
    assert.throws(() => normalizeMatterOrigin(value))
  }
})

test('matches exact Matter origin, including its port', () => {
  assert.equal(isMatterWebURL('https://matter.example.com/team', 'https://matter.example.com'), true)
  assert.equal(isMatterWebURL('https://matter.example.com.evil.test/', 'https://matter.example.com'), false)
  assert.equal(isMatterWebURL('https://matter.example.com:8443/', 'https://matter.example.com'), false)
})

test('shows the browser only in Matter conversation workspaces', () => {
  const origin = 'https://matter.example.com'
  for (const route of ['/', '/?team=team_1', '/new-chat', '/new-team', '/c/conv_1', '/c/conv_1?team=team_1']) {
    assert.equal(isMatterConversationURL(origin + route, origin), true, route)
  }
  for (const route of ['/library', '/settings/acct', '/settings/ext', '/settings/org', '/settings/apis',
    '/knowledge-results', '/operations/overview', '/components', '/c/', '/c/id/other', '/new-chat/other']) {
    assert.equal(isMatterConversationURL(origin + route, origin), false, route)
  }
  for (const url of ['invalid', 'file:///tmp/index.html', 'https://matter.example.com.evil.test/c/conv_1',
    'https://matter.example.com:8443/c/conv_1']) {
    assert.equal(isMatterConversationURL(url, origin), false, url)
  }
})
