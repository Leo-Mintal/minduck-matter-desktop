const fs = require('node:fs')
const path = require('node:path')

const CURSOR_ID = '__minduck_agent_cursor__'
const CURSOR_SIZE = 28
const CURSOR_HOTSPOT = 3.5 // Arrow tip in the 24-unit SVG, scaled to 28px.
const CURSOR_ASSET_PATH = path.join(__dirname, 'assets', 'agent-cursor.svg')
const CURSOR_DATA_URI = `data:image/svg+xml;base64,${fs.readFileSync(CURSOR_ASSET_PATH).toString('base64')}`

function finiteCoordinate(value) {
  return typeof value === 'number' && Number.isFinite(value)
}

function installationExpression() {
  return `(() => {
    const id = ${JSON.stringify(CURSOR_ID)};
    const root = document.documentElement || document.body;
    if (!root) return false;
    let cursor = document.getElementById(id);
    if (!cursor) {
      cursor = document.createElement('div');
      cursor.id = id;
      cursor.setAttribute('aria-hidden', 'true');
      cursor.draggable = false;
      const shadow = cursor.attachShadow({ mode: 'open' });
      const image = document.createElement('img');
      image.alt = '';
      image.draggable = false;
      Object.assign(image.style, {
        width: '100%',
        height: '100%',
        display: 'block',
        pointerEvents: 'none',
        userSelect: 'none',
        filter: 'drop-shadow(0 0 1px white) drop-shadow(0 1px 2px rgba(0, 0, 0, 0.3))',
      });
      shadow.appendChild(image);
      root.appendChild(cursor);
    }
    const image = cursor.shadowRoot?.querySelector('img');
    if (!image) return false;
    image.src = ${JSON.stringify(CURSOR_DATA_URI)};
    Object.assign(cursor.style, {
      position: 'fixed',
      zIndex: '2147483647',
      width: '${CURSOR_SIZE}px',
      height: '${CURSOR_SIZE}px',
      maxWidth: 'none',
      pointerEvents: 'none',
      userSelect: 'none',
      display: 'none',
      transition: 'left 90ms ease-out, top 90ms ease-out',
    });
    return true;
  })()`
}

function presenceExpression() {
  return `Boolean(document.getElementById(${JSON.stringify(CURSOR_ID)}))`
}

function moveExpression(x, y) {
  return `(() => {
    const cursor = document.getElementById(${JSON.stringify(CURSOR_ID)});
    if (!cursor) return false;
    cursor.style.left = ${JSON.stringify(`${x - CURSOR_HOTSPOT}px`)};
    cursor.style.top = ${JSON.stringify(`${y - CURSOR_HOTSPOT}px`)};
    cursor.style.display = 'block';
    cursor.style.opacity = '1';
    return true;
  })()`
}

function hideExpression() {
  return `(() => {
    const cursor = document.getElementById(${JSON.stringify(CURSOR_ID)});
    if (!cursor) return false;
    cursor.style.display = 'none';
    return true;
  })()`
}

class AgentCursorOverlay {
  constructor(webContents) {
    this.webContents = webContents
    this.installed = false
    this.visible = false
    this.lastPoint = null
    this.installPromise = null
    this.disposed = false
  }

  supportsExecution() {
    return Boolean(
      !this.disposed &&
      this.webContents &&
      typeof this.webContents.executeJavaScript === 'function' &&
      (!this.webContents.isDestroyed || !this.webContents.isDestroyed()),
    )
  }

  async evaluate(expression) {
    if (!this.supportsExecution()) return undefined
    try {
      return await this.webContents.executeJavaScript(expression, true)
    } catch {
      this.installed = false
      return undefined
    }
  }

  async ensureInstalled() {
    if (!this.supportsExecution()) return false
    if (this.installPromise) return this.installPromise

    this.installPromise = (async () => {
      const present = await this.evaluate(presenceExpression())
      if (present === true) {
        this.installed = true
        return true
      }
      const installed = await this.evaluate(installationExpression())
      this.installed = installed === true
      return this.installed
    })().finally(() => {
      this.installPromise = null
    })
    return this.installPromise
  }

  async showAt(x, y) {
    if (!finiteCoordinate(x) || !finiteCoordinate(y) || !this.supportsExecution()) return false
    this.lastPoint = { x, y }
    if (!(await this.ensureInstalled())) return false
    const moved = await this.evaluate(moveExpression(x, y))
    this.visible = moved === true
    return this.visible
  }

  async hide() {
    this.visible = false
    await this.evaluate(hideExpression())
  }

  async withHidden(callback) {
    const wasVisible = this.visible
    if (wasVisible) await this.hide()
    try {
      return await callback()
    } finally {
      if (wasVisible && this.lastPoint) await this.showAt(this.lastPoint.x, this.lastPoint.y)
    }
  }

  dispose() {
    const canHide = this.supportsExecution()
    this.disposed = true
    this.visible = false
    this.lastPoint = null
    if (canHide) void this.webContents.executeJavaScript(hideExpression(), true).catch(() => {})
  }
}

module.exports = {
  AgentCursorOverlay,
  CURSOR_ASSET_PATH,
  CURSOR_ID,
}
