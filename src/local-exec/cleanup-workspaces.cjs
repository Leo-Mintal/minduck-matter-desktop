const fs = require('node:fs/promises')
const path = require('node:path')
const { canonical, inside } = require('./workspace.cjs')

const LEGACY_NAME = /^[\p{L}\p{N}_-]{1,50}-cv_[A-Za-z0-9]{26}$/u

// rmdir never removes files, populated folders, or a symbolic link's target.
async function removeEmpty(directory) {
  try { await fs.rmdir(directory); return true }
  catch (error) {
    if (['ENOENT', 'ENOTEMPTY', 'EEXIST', 'ENOTDIR', 'EACCES', 'EPERM'].includes(error.code)) return false
    throw error
  }
}

async function cleanupLegacyWorkspaces({ root, home, workspaces = {} }) {
  const result = { removed: 0, preserved: 0, errors: 0 }
  if (!root || !path.isAbsolute(root) || root === home || inside(root, home)) return result
  try {
    if (await canonical(root) !== path.resolve(root)) return result
    const known = new Set(Object.values(workspaces).filter(name => typeof name === 'string' && path.basename(name) === name))
    const entries = await fs.readdir(root, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isDirectory() || !(known.has(entry.name) || LEGACY_NAME.test(entry.name))) continue
      const directory = path.join(root, entry.name)
      await removeEmpty(path.join(directory, '.matter-cache'))
      if (await removeEmpty(directory)) result.removed++
      else result.preserved++
    }
  } catch (error) { if (error.code !== 'ENOENT') result.errors++ }
  return result
}

module.exports = { cleanupLegacyWorkspaces }
