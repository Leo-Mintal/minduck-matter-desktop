const PANEL_TRANSITION_DURATION = 220

function easeOutCubic(progress) {
  const value = Math.max(0, Math.min(1, progress))
  return 1 - (1 - value) ** 3
}

function interpolateBounds(from, to, progress) {
  const amount = easeOutCubic(progress)
  return Object.fromEntries(Object.keys(from).map((key) => [key, Math.round(from[key] + (to[key] - from[key]) * amount)]))
}

function interpolatePanelFrame(from, to, progress) {
  return Object.fromEntries(Object.keys(to).map((key) => [key, interpolateBounds(from[key], to[key], progress)]))
}

function offscreenBounds(bounds, windowWidth) {
  return { ...bounds, x: windowWidth }
}

function panelTransitionFrame({ closedLayout, kind, openLayout, progress, windowWidth }) {
  if (!openLayout?.panel) throw new Error('An open panel layout is required for motion')

  const open = {
    dragRegion: openLayout.dragRegion,
    matter: openLayout.matter,
    panel: openLayout.panel,
    shell: openLayout.shell,
  }
  const closed = {
    dragRegion: closedLayout.dragRegion,
    matter: closedLayout.matter,
    panel: offscreenBounds(openLayout.panel, windowWidth),
    shell: offscreenBounds(openLayout.shell, windowWidth),
  }
  const [from, to] = kind === 'opening' ? [closed, open] : [open, closed]

  return interpolatePanelFrame(from, to, progress)
}

module.exports = { PANEL_TRANSITION_DURATION, easeOutCubic, interpolatePanelFrame, panelTransitionFrame }
