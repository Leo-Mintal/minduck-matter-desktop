const { WebContentsView } = require('electron')
const { FRAME_RADIUS } = require('./rightPanelLayout.cjs')

// A host-owned corner above the native page also covers native scrollbars.
// Its size is in window pixels, independent of page layout, scrolling and zoom.
class BrowserCorner {
  constructor(parent, color) {
    this.parent = parent
    this.color = color
    this.page = undefined
    this.view = new WebContentsView({ webPreferences: {
      contextIsolation: true, sandbox: true, nodeIntegration: false, webSecurity: true,
    } })
    this.view.setBackgroundColor('#00000000')
    this.view.setVisible(false)
    parent.addChildView(this.view)
    const contents = this.view.webContents
    contents.on('dom-ready', () => this.setColor(this.color))
    contents.on('will-navigate', event => event.preventDefault())
    contents.setWindowOpenHandler(() => ({ action: 'deny' }))
    contents.on('before-mouse-event', (event, mouse) => {
      event.preventDefault()
      if (!this.page || this.page.webContents.isDestroyed()) return
      if (mouse.x ** 2 + mouse.y ** 2 > FRAME_RADIUS ** 2) return
      const page = this.page.getBounds()
      if (mouse.type === 'mouseDown') this.page.webContents.focus()
      this.page.webContents.sendInputEvent({ ...mouse,
        x: page.width - FRAME_RADIUS + mouse.x, y: page.height - FRAME_RADIUS + mouse.y,
      })
    })
    const html = `<meta name="color-scheme" content="light dark"><style>
      html,body { margin:0; width:100%; height:100%; overflow:hidden; background:transparent; }
      svg { display:block; width:100%; height:100%; }
      </style><svg viewBox="0 0 12 12" aria-hidden="true">
      <path fill="currentColor" d="M12 0A12 12 0 0 1 0 12H12Z"/></svg>`
    void contents.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html))
      .catch(error => console.error('Failed to load browser corner:', error))
  }

  setColor(color) {
    this.color = color
    if (!this.view.webContents.isDestroyed()) {
      void this.view.webContents.executeJavaScript(`document.documentElement.style.color = ${JSON.stringify(color)}`)
        .catch(error => console.error('Failed to update browser corner:', error))
    }
  }

  layout(page, bounds) {
    if (!page || !bounds || bounds.width < FRAME_RADIUS || bounds.height < FRAME_RADIUS) {
      this.view.setVisible(false)
      return
    }
    if (this.page !== page) {
      this.parent.removeChildView(this.view)
      this.parent.addChildView(this.view)
      this.page = page
    }
    this.view.setBounds({ x: bounds.x + bounds.width - FRAME_RADIUS,
      y: bounds.y + bounds.height - FRAME_RADIUS, width: FRAME_RADIUS, height: FRAME_RADIUS })
    this.view.setVisible(true)
  }

  dispose() {
    this.parent.removeChildView(this.view)
    if (!this.view.webContents.isDestroyed()) this.view.webContents.close()
  }
}

module.exports = { BrowserCorner }
