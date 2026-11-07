// Startup fallbacks; the Web renderer reports the resolved shared design tokens.
const TOOLBAR_HEIGHT = 106
// hiddenInset window controls end at 24px; leave 12px before the Matter content.
const MATTER_TOP_INSET = 36
const CLOSED_PANEL_BUTTON_SIZE = 44
const CLOSED_PANEL_BUTTON_INSET = 12
const SIDEBAR_MIN_WIDTH = 380
const PANEL_RESIZER_WIDTH = 11

function clampSidebarWidth(windowWidth, width, metrics = {}) {
  const minimum = metrics.panelMin ?? SIDEBAR_MIN_WIDTH
  const maximum = Math.max(minimum, Math.min(
    Math.round(windowWidth * (metrics.panelMaxRatio ?? 0.82)),
    windowWidth - (metrics.panelReserve ?? 300),
  ))
  return Math.round(Math.max(minimum, Math.min(maximum, width)))
}

function sidebarWidth(windowWidth, preferredWidth, metrics = {}) {
  const requested = Number.isFinite(preferredWidth) && preferredWidth > 0
    ? preferredWidth : metrics.panelDefault ?? 384
  return clampSidebarWidth(windowWidth, requested, metrics)
}

function matterContentBounds(matterBounds, topInset = MATTER_TOP_INSET) {
  const height = Math.max(0, matterBounds.height)
  const inset = Math.min(height, Math.max(0, Math.round(topInset)))
  return {
    x: matterBounds.x,
    y: matterBounds.y + inset,
    width: matterBounds.width,
    height: height - inset,
  }
}

function rightPanelLayout(windowWidth, windowHeight, isOpen, preferredPanelWidth, metrics = {}) {
  const panelWidth = isOpen ? sidebarWidth(windowWidth, preferredPanelWidth, metrics) : 0
  const panelX = windowWidth - panelWidth
  const toolbarHeight = Math.min(windowHeight, metrics.toolbarHeight || TOOLBAR_HEIGHT)
  const resizerWidth = Math.round(metrics.resizeHitWidth ?? PANEL_RESIZER_WIDTH)
  const dragRegionWidth = isOpen
    ? Math.max(0, panelX - Math.floor(resizerWidth / 2))
    : Math.max(0, windowWidth - CLOSED_PANEL_BUTTON_SIZE - CLOSED_PANEL_BUTTON_INSET * 2)
  return {
    dragRegion: {
      x: 0,
      y: 0,
      width: dragRegionWidth,
      height: MATTER_TOP_INSET,
    },
    matter: {
      x: 0,
      y: 0,
      width: panelX,
      height: windowHeight,
    },
    panel: isOpen
      ? { x: panelX, y: 0, width: panelWidth, height: windowHeight }
      : null,
    resizer: isOpen
      ? {
          x: panelX - Math.floor(resizerWidth / 2),
          y: 0,
          width: resizerWidth,
          height: windowHeight,
        }
      : null,
    browser: isOpen
      ? { x: panelX + 1, y: toolbarHeight, width: panelWidth - 1, height: windowHeight - toolbarHeight }
      : null,
    shell: isOpen
      ? { x: panelX, y: 0, width: panelWidth, height: toolbarHeight }
      : {
          x: Math.max(CLOSED_PANEL_BUTTON_INSET, windowWidth - CLOSED_PANEL_BUTTON_SIZE - CLOSED_PANEL_BUTTON_INSET),
          y: CLOSED_PANEL_BUTTON_INSET,
          width: CLOSED_PANEL_BUTTON_SIZE,
          height: CLOSED_PANEL_BUTTON_SIZE,
        },
  }
}

module.exports = {
  CLOSED_PANEL_BUTTON_SIZE,
  CLOSED_PANEL_BUTTON_INSET,
  PANEL_RESIZER_WIDTH,
  MATTER_TOP_INSET,
  SIDEBAR_MIN_WIDTH,
  TOOLBAR_HEIGHT,
  clampSidebarWidth,
  matterContentBounds,
  rightPanelLayout,
  sidebarWidth,
}
