(() => {
  const integration = {
    version: '0.1.0',
    path: location.pathname,
    observedAt: new Date().toISOString(),
  }

  // Keep only operational metadata in extension storage. Credentials, page text,
  // draft content, and uploaded files are deliberately never collected here.
  const setSessionState = chrome.storage?.session?.set
  if (typeof setSessionState === 'function') {
    setSessionState.call(chrome.storage.session, { minduckXiaohongshuAgent: integration }).catch(() => {})
  }
  console.info('[Minduck Agent Browser] Xiaohongshu integration active')
})()
