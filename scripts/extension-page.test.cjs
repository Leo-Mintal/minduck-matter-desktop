const test = require('node:test')
const assert = require('node:assert/strict')
const { extensionPopupURL, isExtensionPage } = require('../src/extensionPage.cjs')

const extension = { url: 'chrome-extension://abcdefghijklmnop/' }

test('builds a popup URL only for a Chrome extension origin', () => {
  assert.equal(extensionPopupURL(extension), 'chrome-extension://abcdefghijklmnop/popup.html')
  assert.equal(extensionPopupURL({ url: 'https://example.com/' }), null)
  assert.equal(extensionPopupURL(null), null)
})

test('allows only pages from the loaded extension origin', () => {
  assert.equal(isExtensionPage('chrome-extension://abcdefghijklmnop/chunks/popup.js', extension), true)
  assert.equal(isExtensionPage('chrome-extension://evilabcdefghijklmnop/popup.html', extension), false)
  assert.equal(isExtensionPage('https://example.com/', extension), false)
})
