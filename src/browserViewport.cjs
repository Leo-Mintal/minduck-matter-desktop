const viewports = new WeakMap()

function fitPageScale(scale, metrics, nativeWidth) {
  const { viewportWidth, clientWidth, contentWidth } = metrics || {}
  const values = [scale, viewportWidth, clientWidth, contentWidth, nativeWidth]
  if (!values.every(value => Number.isFinite(value) && value > 0)) return scale
  // Ignore stale resize/zoom measurements and offscreen renderers with a parent-sized viewport.
  if (Math.abs(viewportWidth * scale - nativeWidth) > 2 || contentWidth <= clientWidth + 1) return scale
  const scrollbar = Math.max(0, viewportWidth - clientWidth)
  return Math.max(0.1, Math.min(scale, Math.floor(nativeWidth / (contentWidth + scrollbar + 1) * 1000) / 1000))
}

function browserInputParams(contents, method, params) {
  const scale = viewports.get(contents)?.scale ?? 1
  if (method !== 'Input.dispatchMouseEvent' || scale === 1) return params
  const native = { ...params }
  for (const key of ['x', 'y', 'deltaX', 'deltaY']) {
    if (Number.isFinite(native[key])) native[key] *= scale
  }
  return native
}

class BrowserViewport {
  constructor(view) {
    this.view = view
    this.width = 0
    this.height = 0
    this.scale = 1
    this.timer = undefined
    const contents = view.webContents
    viewports.set(contents, this)
    contents.on('dom-ready', () => this.reset())
    contents.on('ipc-message', (event, channel, metrics) => {
      if (channel !== 'browser-viewport:metrics' || event.senderFrame !== contents.mainFrame || this.timer) return
      if (!/^https?:/i.test(contents.getURL()) || !view.getVisible()) return
      const next = fitPageScale(this.scale, metrics, this.width)
      if (next >= this.scale - 0.001) return
      this.scale = next
      this.applyScale()
      contents.send('browser-viewport:measure')
    })
    contents.once('destroyed', () => clearTimeout(this.timer))
  }

  applyScale() {
    if (this.scale === 1) return
    this.view.webContents.enableDeviceEmulation({ screenPosition: 'desktop', screenSize: { width: 0, height: 0 },
      viewPosition: { x: 0, y: 0 }, deviceScaleFactor: 0, scale: this.scale,
      viewSize: { width: Math.ceil(this.width / this.scale), height: Math.ceil(this.height / this.scale) },
    })
  }

  reset() {
    const contents = this.view.webContents
    if (contents.isDestroyed()) return
    // Automatic fitting belongs to this tab, never Matter or another same-origin tab.
    contents.setZoomMode('isolated')
    contents.setZoomFactor(1)
    contents.disableDeviceEmulation()
    this.scale = 1
    contents.send('browser-viewport:measure')
  }

  resize(bounds) {
    if (this.width === bounds.width && this.height === bounds.height) return
    const widthChanged = this.width !== bounds.width
    this.width = bounds.width
    this.height = bounds.height
    if (widthChanged) {
      clearTimeout(this.timer)
      this.timer = setTimeout(() => { this.timer = undefined; this.reset() }, 80)
    } else {
      this.applyScale()
      this.view.webContents.send('browser-viewport:measure')
    }
  }
}

module.exports = { BrowserViewport, fitPageScale, browserInputParams }
