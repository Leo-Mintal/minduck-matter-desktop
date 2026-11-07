const SEARCH_URL = 'https://www.bing.com/search?q='

function asURL(value) {
  try {
    return new URL(value)
  } catch {
    return null
  }
}

function isXiaohongshuURL(value) {
  const url = asURL(value)
  return Boolean(
    url &&
      url.protocol === 'https:' &&
      (url.hostname === 'xiaohongshu.com' || url.hostname.endsWith('.xiaohongshu.com')),
  )
}

function browserNavigationDisposition(value) {
  const url = asURL(value)
  if (!url) return 'blocked'
  if (url.protocol === 'http:' || url.protocol === 'https:') return 'navigate'
  if (url.protocol === 'mailto:') return 'external'
  return 'blocked'
}

function isLikelyWebAddress(value) {
  return /^(?:(?:localhost)|(?:127(?:\.\d{1,3}){3})|(?:\[::1\])|(?:(?:[a-z0-9-]+\.)+[a-z]{2,}))(?::\d+)?(?:[/?#].*)?$/i.test(value)
}

function browserURLForInput(value, searchEngine = 'bing') {
  const input = typeof value === 'string' ? value.trim() : ''
  if (!input) return null

  const directURL = asURL(input)
  if (directURL && (directURL.protocol === 'http:' || directURL.protocol === 'https:')) {
    return directURL.href
  }

  if (isLikelyWebAddress(input)) {
    return `https://${input}`
  }

  const searchURL = searchEngine === 'google' ? 'https://www.google.com/search?q=' : SEARCH_URL
  return `${searchURL}${encodeURIComponent(input)}`
}

module.exports = {
  agentBrowserDisposition: browserNavigationDisposition,
  browserNavigationDisposition,
  browserURLForInput,
  isXiaohongshuURL,
}
