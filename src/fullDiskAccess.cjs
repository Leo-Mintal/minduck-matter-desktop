const fs = require('node:fs')

const FULL_DISK_ACCESS_SETTINGS_URL = 'x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles'
const FULL_DISK_ACCESS_PROBE_PATH = '/Library/Application Support/com.apple.TCC/TCC.db'

function hasFullDiskAccess({ platform = process.platform, openSync = fs.openSync, closeSync = fs.closeSync, probePath = FULL_DISK_ACCESS_PROBE_PATH } = {}) {
  if (platform !== 'darwin') return false
  let descriptor
  try {
    // A denied open also lets macOS list the responsible app with FDA disabled (Catalina+).
    // Open without reading database contents: access/stat alone can report false positives.
    descriptor = openSync(probePath, fs.constants.O_RDONLY)
    return true
  } catch {
    return false
  } finally {
    if (descriptor !== undefined) closeSync(descriptor)
  }
}

// Optional manual Settings entry only; local execution never uses an FDA gate.
module.exports = { FULL_DISK_ACCESS_SETTINGS_URL, FULL_DISK_ACCESS_PROBE_PATH, hasFullDiskAccess }
