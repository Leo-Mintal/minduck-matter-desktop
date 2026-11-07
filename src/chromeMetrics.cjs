function opaqueColor(value) {
  if (typeof value !== 'string') return undefined
  if (/^#[\da-f]{6}$/i.test(value)) return value
  const match = /^rgb\(\s*(\d{1,3}),\s*(\d{1,3}),\s*(\d{1,3})\s*\)$/.exec(value)
  if (!match || match.slice(1).some((part) => Number(part) > 255)) return undefined
  return '#' + match.slice(1).map((part) => Number(part).toString(16).padStart(2, '0')).join('')
}

function parseChromeMetrics(value) {
  if (!value || typeof value !== 'object' || !['dark', 'light'].includes(value.theme)) return null
  const ranges = {
    toolbarHeight: [0, 300], panelMin: [200, 800], panelDefault: [200, 1000],
    panelReserve: [200, 1000], panelMaxRatio: [0.4, 0.95], resizeHitWidth: [5, 32],
  }
  const result = { theme: value.theme }
  for (const [key, [minimum, maximum]] of Object.entries(ranges)) {
    if (!Number.isFinite(value[key]) || value[key] < minimum || value[key] > maximum) return null
    result[key] = value[key]
  }
  for (const key of ['canvas', 'surface', 'divider']) {
    result[key] = opaqueColor(value[key])
    if (!result[key]) return null
  }
  return result
}

module.exports = { parseChromeMetrics }
