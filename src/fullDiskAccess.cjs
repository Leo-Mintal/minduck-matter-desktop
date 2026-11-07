const fs = require('node:fs')

const FULL_DISK_ACCESS_SETTINGS_URL = 'x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles'
const FULL_DISK_ACCESS_PROBE_PATH = '/Library/Application Support/com.apple.TCC/TCC.db'

function hasFullDiskAccess({ platform, accessSync = fs.accessSync, probePath = FULL_DISK_ACCESS_PROBE_PATH } = {}) {
  if (platform !== 'darwin') return false
  try {
    accessSync(probePath, fs.constants.R_OK)
    return true
  } catch {
    return false
  }
}

function shouldPromptForFullDiskAccess({ platform, promptedThisSession, settings, permissionGranted = false }) {
  return platform === 'darwin'
    && !promptedThisSession
    && settings?.fullDiskAccessPromptAcknowledged !== true
    && permissionGranted !== true
}

module.exports = {
  FULL_DISK_ACCESS_SETTINGS_URL,
  FULL_DISK_ACCESS_PROBE_PATH,
  hasFullDiskAccess,
  shouldPromptForFullDiskAccess,
}
