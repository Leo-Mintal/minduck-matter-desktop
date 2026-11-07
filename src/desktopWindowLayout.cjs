const MATTER_MIN_WIDTH = 640
const BROWSER_MIN_WIDTH = 320
const BROWSER_PREFERRED_MIN_WIDTH = 360
const BROWSER_MAX_WIDTH = 480

function browserWidth(workAreaWidth) {
  const preferred = Math.round(workAreaWidth * 0.36)
  const cappedPreferred = Math.min(BROWSER_MAX_WIDTH, Math.max(BROWSER_PREFERRED_MIN_WIDTH, preferred))
  const available = Math.max(BROWSER_MIN_WIDTH, workAreaWidth - MATTER_MIN_WIDTH)
  return Math.min(cappedPreferred, available, workAreaWidth)
}

function desktopWindowLayout(workArea) {
  const width = browserWidth(workArea.width)
  const matterWidth = Math.max(0, workArea.width - width)

  return {
    matter: {
      x: workArea.x,
      y: workArea.y,
      width: matterWidth,
      height: workArea.height,
    },
    browser: {
      x: workArea.x + matterWidth,
      y: workArea.y,
      width,
      height: workArea.height,
    },
  }
}

module.exports = {
  BROWSER_MAX_WIDTH,
  BROWSER_MIN_WIDTH,
  BROWSER_PREFERRED_MIN_WIDTH,
  MATTER_MIN_WIDTH,
  browserWidth,
  desktopWindowLayout,
}
