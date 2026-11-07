const test = require('node:test')
const assert = require('node:assert/strict')
const {
  browserNavigationDisposition,
  browserURLForInput,
  isXiaohongshuURL,
} = require('../src/agentBrowserPolicy.cjs')

test('keeps the bundled extension scoped to HTTPS Xiaohongshu origins', () => {
  assert.equal(isXiaohongshuURL('https://www.xiaohongshu.com/explore'), true)
  assert.equal(isXiaohongshuURL('https://creator.xiaohongshu.com/publish/publish'), true)
  assert.equal(isXiaohongshuURL('http://www.xiaohongshu.com/explore'), false)
  assert.equal(isXiaohongshuURL('https://xiaohongshu.com.evil.example/'), false)
})

test('allows ordinary HTTP(S) browsing but blocks unsafe navigation protocols', () => {
  assert.equal(browserNavigationDisposition('https://www.xiaohongshu.com/explore'), 'navigate')
  assert.equal(browserNavigationDisposition('https://example.com/'), 'navigate')
  assert.equal(browserNavigationDisposition('http://localhost:3001/'), 'navigate')
  assert.equal(browserNavigationDisposition('mailto:support@example.com'), 'external')
  assert.equal(browserNavigationDisposition('javascript:alert(1)'), 'blocked')
  assert.equal(browserNavigationDisposition('file:///etc/passwd'), 'blocked')
})

test('turns address-bar input into a safe URL or search request', () => {
  assert.equal(browserURLForInput('https://example.com/path'), 'https://example.com/path')
  assert.equal(browserURLForInput('matter.minduck.com'), 'https://matter.minduck.com')
  assert.equal(browserURLForInput('localhost:3001'), 'https://localhost:3001')
  assert.equal(browserURLForInput('小红书运营技巧'), 'https://www.bing.com/search?q=%E5%B0%8F%E7%BA%A2%E4%B9%A6%E8%BF%90%E8%90%A5%E6%8A%80%E5%B7%A7')
  assert.equal(browserURLForInput(''), null)
})
