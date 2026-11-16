// Measure layout in the isolated preload without exposing Electron APIs to websites.
const { ipcRenderer } = require('electron')

if (process.isMainFrame) {
  let timer
  function measure() {
    if (timer) return
    timer = setTimeout(() => {
      timer = undefined
      const root = document.documentElement
      if (!root) return
      ipcRenderer.send('browser-viewport:metrics', {
        viewportWidth: innerWidth,
        clientWidth: root.clientWidth,
        contentWidth: Math.max(root.scrollWidth, document.body?.scrollWidth || 0),
      })
    }, 60)
  }
  ipcRenderer.on('browser-viewport:measure', measure)
  addEventListener('resize', measure)
  addEventListener('load', measure, true)
  addEventListener('DOMContentLoaded', () => {
    const observer = new ResizeObserver(measure)
    observer.observe(document.documentElement)
    if (document.body) observer.observe(document.body)
    new MutationObserver(measure).observe(document.documentElement, {
      childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style'],
    })
    document.fonts?.ready.then(measure)
    measure()
  }, { once: true })
}
