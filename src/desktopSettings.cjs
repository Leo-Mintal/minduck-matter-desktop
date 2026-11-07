const { randomBytes } = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const { normalizeMatterOrigin } = require('./matterService.cjs')

// Keep the legacy filename so existing service, panel and permission preferences survive.
const DESKTOP_SETTINGS_FILE = 'agent-settings.json'

function desktopSettingsPath(userDataDirectory) {
  if (typeof userDataDirectory !== 'string' || !userDataDirectory) {
    throw new Error('Application user-data directory is required')
  }
  return path.join(userDataDirectory, DESKTOP_SETTINGS_FILE)
}

function defaultDesktopSettings() {
  return {
    fullDiskAccessPromptAcknowledged: false,
    rightPanelWidth: null,
    matterOrigin: null,
  }
}

function loadDesktopSettings(userDataDirectory) {
  let contents
  try {
    contents = fs.readFileSync(desktopSettingsPath(userDataDirectory), 'utf8')
  } catch (error) {
    if (error && error.code === 'ENOENT') return defaultDesktopSettings()
    throw error
  }

  let parsed
  try {
    parsed = JSON.parse(contents)
  } catch {
    throw new Error('应用设置文件无效')
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('应用设置文件无效')
  }
  return {
    fullDiskAccessPromptAcknowledged: parsed.fullDiskAccessPromptAcknowledged === true,
    rightPanelWidth: Number.isSafeInteger(parsed.rightPanelWidth) && parsed.rightPanelWidth > 0 ? parsed.rightPanelWidth : null,
    matterOrigin: savedMatterOrigin(parsed.matterOrigin),
  }
}

// A service address the current rules reject falls back to the default without discarding other fields.
function savedMatterOrigin(value) {
  if (typeof value !== 'string') return null
  try {
    return normalizeMatterOrigin(value)
  } catch {
    return null
  }
}

function saveDesktopSettings(userDataDirectory, settings) {
  if (!settings
    || typeof settings.fullDiskAccessPromptAcknowledged !== 'boolean'
    || (settings.rightPanelWidth !== null && (!Number.isSafeInteger(settings.rightPanelWidth) || settings.rightPanelWidth <= 0))
    || (settings.matterOrigin !== null
      && (typeof settings.matterOrigin !== 'string' || normalizeMatterOrigin(settings.matterOrigin) !== settings.matterOrigin))) {
    throw new Error('应用设置无效')
  }
  const destination = desktopSettingsPath(userDataDirectory)
  const temporary = `${destination}.${process.pid}.${randomBytes(8).toString('hex')}.tmp`
  const contents = JSON.stringify({
    fullDiskAccessPromptAcknowledged: settings.fullDiskAccessPromptAcknowledged,
    rightPanelWidth: settings.rightPanelWidth,
    matterOrigin: settings.matterOrigin,
  })
  try {
    fs.mkdirSync(userDataDirectory, { recursive: true, mode: 0o700 })
    fs.writeFileSync(temporary, contents, { encoding: 'utf8', mode: 0o600, flag: 'wx' })
    fs.renameSync(temporary, destination)
    fs.chmodSync(destination, 0o600)
  } catch (error) {
    try {
      fs.unlinkSync(temporary)
    } catch {
      // The temporary settings file was not created or has already been moved.
    }
    throw error
  }
}

module.exports = {
  DESKTOP_SETTINGS_FILE,
  desktopSettingsPath,
  defaultDesktopSettings,
  loadDesktopSettings,
  saveDesktopSettings,
}
