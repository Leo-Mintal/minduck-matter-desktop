const fs = require('node:fs')
const path = require('node:path')
const { randomBytes } = require('node:crypto')

const DEFAULT_BROWSER_PREFERENCES = Object.freeze({ browserSearchEngine: 'bing', browserStartPage: 'local' })

function normalizeBrowserPreferences(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || !['bing', 'google'].includes(value.browserSearchEngine)
    || !['local', 'google'].includes(value.browserStartPage)) {
    throw new Error('浏览器设置无效')
  }
  return { browserSearchEngine: value.browserSearchEngine, browserStartPage: value.browserStartPage }
}

function preferencesPath(userData) {
  return path.join(userData, 'browser-preferences.json')
}

function loadBrowserPreferences(userData) {
  try {
    return normalizeBrowserPreferences(JSON.parse(fs.readFileSync(preferencesPath(userData), 'utf8')))
  } catch (error) {
    if (error.code === 'ENOENT') return { ...DEFAULT_BROWSER_PREFERENCES }
    throw error
  }
}

function saveBrowserPreferences(userData, value) {
  const preferences = normalizeBrowserPreferences(value)
  const destination = preferencesPath(userData)
  const temporary = `${destination}.${process.pid}.${randomBytes(8).toString('hex')}.tmp`
  try {
    fs.mkdirSync(userData, { recursive: true, mode: 0o700 })
    fs.writeFileSync(temporary, JSON.stringify(preferences) + '\n', { mode: 0o600, flag: 'wx' })
    fs.renameSync(temporary, destination)
    fs.chmodSync(destination, 0o600)
    return preferences
  } finally {
    fs.rmSync(temporary, { force: true })
  }
}

module.exports = { DEFAULT_BROWSER_PREFERENCES, loadBrowserPreferences, normalizeBrowserPreferences, saveBrowserPreferences }
