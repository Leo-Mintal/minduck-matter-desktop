function extensionPopupURL(extension) {
  if (!extension || typeof extension.url !== 'string') return null

  try {
    const base = new URL(extension.url)
    if (base.protocol !== 'chrome-extension:' || !base.host) return null
    return new URL('popup.html', base).toString()
  } catch {
    return null
  }
}

function isExtensionPage(value, extension) {
  const popupURL = extensionPopupURL(extension)
  if (!popupURL || typeof value !== 'string') return false

  try {
    const page = new URL(value)
    const base = new URL(popupURL)
    return page.protocol === 'chrome-extension:' && page.host === base.host
  } catch {
    return false
  }
}

module.exports = {
  extensionPopupURL,
  isExtensionPage,
}
