// Startup fallbacks; the Web renderer reports the resolved shared design tokens.
const TOOLBAR_HEIGHT = 84
const MATTER_TOP_INSET = 36
const FRAME_DRAG_START = 196
const FRAME_RAIL_WIDTH = 49
const FRAME_EDGE = 4
const FRAME_GAP = 1
const FRAME_RADIUS = 12
const CLOSED_PANEL_BUTTON_SIZE = 36
const CLOSED_PANEL_BUTTON_INSET = 8
const SIDEBAR_MIN_WIDTH = 380
const PANEL_RESIZER_WIDTH = 11

function contentWidth(windowWidth) {
  return Math.max(0, windowWidth - FRAME_RAIL_WIDTH - FRAME_EDGE)
}

function clampSidebarWidth(windowWidth, width, metrics = {}) {
  const available = contentWidth(windowWidth)
  const minimum = Math.min(available, metrics.panelMin ?? SIDEBAR_MIN_WIDTH)
  const maximum = Math.max(minimum, Math.min(
    Math.round(available * (metrics.panelMaxRatio ?? 0.82)),
    available - FRAME_GAP - (metrics.panelReserve ?? 300),
  ))
  return Math.round(Math.max(minimum, Math.min(maximum, width)))
}

function sidebarWidth(windowWidth, preferredWidth, metrics = {}) {
  const requested = Number.isFinite(preferredWidth) && preferredWidth > 0
    ? preferredWidth : metrics.panelDefault ?? 384
  return clampSidebarWidth(windowWidth, requested, metrics)
}

function matterContentBounds(matterBounds) {
  return { ...matterBounds }
}

// The shared workspace owns the existing rail, so its popovers share the content's renderer.
function workspaceFrameBounds(bounds, enabled) {
  return enabled ? { ...bounds, x: 0, width: bounds.width + bounds.x } : { ...bounds }
}

function rightPanelLayout(windowWidth, windowHeight, isOpen, preferredPanelWidth, metrics = {}) {
  const panelWidth = isOpen ? sidebarWidth(windowWidth, preferredPanelWidth, metrics) : 0
  const panelX = windowWidth - FRAME_EDGE - panelWidth
  const top = Math.min(windowHeight, MATTER_TOP_INSET)
  const height = Math.max(0, windowHeight - top - FRAME_EDGE)
  const toolbarHeight = Math.min(Math.max(0, windowHeight - FRAME_EDGE), metrics.toolbarHeight || TOOLBAR_HEIGHT)
  const resizerWidth = Math.round(metrics.resizeHitWidth ?? PANEL_RESIZER_WIDTH)
  return {
    dragRegion: {
      x: FRAME_DRAG_START, y: 0,
      width: Math.max(0, (isOpen ? panelX - FRAME_GAP : windowWidth - 56) - FRAME_DRAG_START), height: top,
    },
    matter: {
      x: FRAME_RAIL_WIDTH, y: top,
      width: Math.max(0, contentWidth(windowWidth) - panelWidth - (isOpen ? FRAME_GAP : 0)), height,
    },
    panel: isOpen ? { x: panelX, y: top, width: panelWidth, height } : null,
    resizer: isOpen ? {
      x: panelX - Math.ceil((FRAME_GAP + resizerWidth) / 2), y: top, width: resizerWidth, height,
    } : null,
    browser: isOpen ? {
      x: panelX, y: toolbarHeight, width: panelWidth, height: Math.max(0, windowHeight - FRAME_EDGE - toolbarHeight),
    } : null,
    shell: isOpen ? { x: panelX, y: 0, width: panelWidth, height: toolbarHeight }
      : { x: windowWidth - 48, y: 6, width: CLOSED_PANEL_BUTTON_SIZE, height: CLOSED_PANEL_BUTTON_SIZE },
  }
}

module.exports = {
  CLOSED_PANEL_BUTTON_SIZE, CLOSED_PANEL_BUTTON_INSET, PANEL_RESIZER_WIDTH, MATTER_TOP_INSET,
  FRAME_RAIL_WIDTH, FRAME_EDGE, FRAME_GAP, FRAME_RADIUS,
  SIDEBAR_MIN_WIDTH, TOOLBAR_HEIGHT, clampSidebarWidth, matterContentBounds, rightPanelLayout, sidebarWidth,
  workspaceFrameBounds,
}
