const fs = require('node:fs')
const path = require('node:path')

const CURSOR_ID = '__minduck_agent_cursor__'
const CURSOR_SIZE = 22
const CURSOR_HOTSPOT = CURSOR_SIZE * 3 / 24 // Keep the SVG arrow tip fixed while its tail sways.
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
      const style = document.createElement('style');
      style.textContent = \`
        :host { all: initial; }
        .glow {
          position: absolute;
          inset: -10px;
          border-radius: 50%;
          background: radial-gradient(circle, rgba(130, 240, 167, .3), rgba(100, 220, 145, .1) 40%, transparent 70%);
          filter: blur(4px);
          pointer-events: none;
          animation: glow-breathe 2400ms ease-in-out infinite;
        }
        img {
          position: relative;
          width: 100%;
          height: 100%;
          display: block;
          pointer-events: none;
          user-select: none;
          transform-origin: ${CURSOR_HOTSPOT}px ${CURSOR_HOTSPOT}px;
          filter: drop-shadow(0 0 1px white) drop-shadow(0 0 3px rgba(155, 255, 186, .45)) drop-shadow(0 1px 2px rgba(0, 0, 0, .3));
          animation: tail-sway 1800ms ease-in-out infinite;
        }
        @keyframes tail-sway {
          0%, 100% { transform: rotate(-3deg); }
          50% { transform: rotate(3deg); }
        }
        @keyframes glow-breathe {
          0%, 100% { opacity: .65; transform: scale(.94); }
          50% { opacity: 1; transform: scale(1.04); }
        }
        @media (prefers-reduced-motion: reduce) {
          :host { transition: none !important; }
          img, .glow { animation: none; }
        }
      \`;
      const glow = document.createElement('span');
      glow.className = 'glow';
      const image = document.createElement('img');
      image.alt = '';
      image.draggable = false;
      shadow.append(style, glow, image);
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
