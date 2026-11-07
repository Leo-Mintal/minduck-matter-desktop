const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')
const { loadBrowserPreferences, saveBrowserPreferences } = require('../src/browserPreferences.cjs')
const { browserStartURL, isBrowserStartURL } = require('../src/browserStartPage.cjs')
const { browserURLForInput } = require('../src/agentBrowserPolicy.cjs')

test('persists browser preferences independently and rejects arbitrary URL settings', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'matter-browser-prefs-'))
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  const existing = '{"matterOrigin":"https://matter.example.com"}'
  fs.writeFileSync(path.join(directory, 'agent-settings.json'), existing)
  assert.deepEqual(loadBrowserPreferences(directory), { browserSearchEngine: 'bing', browserStartPage: 'local' })
  const saved = { browserSearchEngine: 'google', browserStartPage: 'google' }
  saveBrowserPreferences(directory, saved)
  assert.deepEqual(loadBrowserPreferences(directory), saved)
  assert.equal(fs.readFileSync(path.join(directory, 'agent-settings.json'), 'utf8'), existing)
  assert.equal(fs.statSync(path.join(directory, 'browser-preferences.json')).mode & 0o077, 0)
  for (const value of [null, [], {}, { ...saved, browserSearchEngine: 'https://evil.example' },
    { ...saved, browserStartPage: 'file:///etc/passwd' }]) {
    assert.throws(() => saveBrowserPreferences(directory, value), /浏览器设置无效/)
    assert.deepEqual(loadBrowserPreferences(directory), saved)
  }
})

test('recognizes only the exact local new-tab page and keeps arbitrary files blocked', () => {
  const url = browserStartURL({ browserSearchEngine: 'google', browserStartPage: 'local' }, 'light')
  assert.equal(isBrowserStartURL(url), true)
  assert.equal(new URL(url).searchParams.get('engine'), 'google')
  assert.equal(new URL(url).searchParams.get('theme'), 'light')
  for (const unsafe of ['file:///etc/passwd?surface=newtab', url.replace('surface=newtab', 'surface=settings'),
    'https://evil.example/index.html?surface=newtab', 'invalid']) assert.equal(isBrowserStartURL(unsafe), false)
  assert.equal(browserStartURL({ browserStartPage: 'google' }), 'https://www.google.com/')
})

test('search preference changes only keyword searches and falls back safely', () => {
  assert.equal(browserURLForInput('a & b', 'google'), 'https://www.google.com/search?q=a%20%26%20b')
  assert.equal(browserURLForInput('a & b', 'invalid'), 'https://www.bing.com/search?q=a%20%26%20b')
  assert.equal(browserURLForInput('https://example.com/path?q=1', 'google'), 'https://example.com/path?q=1')
})
