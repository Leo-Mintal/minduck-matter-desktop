const path = require('node:path')
const { pathToFileURL } = require('node:url')

const SHELL_PAGE = pathToFileURL(path.join(__dirname, '..', 'web-dist', 'desktop-shell', 'index.html'))

function browserStartURL(preferences, theme = 'dark') {
  if (preferences.browserStartPage === 'google') return 'https://www.google.com/'
  const url = new URL(SHELL_PAGE)
  url.searchParams.set('surface', 'newtab')
  url.searchParams.set('engine', preferences.browserSearchEngine === 'google' ? 'google' : 'bing')
  url.searchParams.set('theme', theme === 'light' ? 'light' : 'dark')
  return url.href
}

function isBrowserStartURL(value) {
  try {
    const url = new URL(value)
    return url.protocol === 'file:' && url.pathname === SHELL_PAGE.pathname && url.searchParams.get('surface') === 'newtab'
  } catch { return false }
}

module.exports = { browserStartURL, isBrowserStartURL }
