const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const os = require('node:os')
const EXECUTION_POLICY = 'system-access-v1'

function privateWrite(filename, value) {
  fs.mkdirSync(path.dirname(filename), { recursive: true, mode: 0o700 })
  const temporary = `${filename}.${crypto.randomUUID()}.tmp`
  try {
    fs.writeFileSync(temporary, JSON.stringify(value), { mode: 0o600, flag: 'wx' })
    fs.renameSync(temporary, filename)
    fs.chmodSync(filename, 0o600)
  } finally {
    fs.rmSync(temporary, { force: true })
  }
}

function createStore(userData) {
  const filename = path.join(userData, 'local-exec', 'settings.json')
  const defaults = { enabled: false, allowNetwork: false, setupSeen: false, executionPolicy: null, root: path.join(os.homedir(), 'Matter'), grants: {}, workspaces: {}, pairing: null }
  let value = { ...defaults }
  try {
    const parsed = JSON.parse(fs.readFileSync(filename, 'utf8'))
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('本机执行设置无效')
    // Saved flags are not OS permission; the controller must check Full Disk Access.
    value = { ...defaults, ...parsed, enabled: parsed.enabled === true && parsed.executionPolicy === EXECUTION_POLICY,
      allowNetwork: parsed.allowNetwork === true && parsed.executionPolicy === EXECUTION_POLICY, setupSeen: parsed.setupSeen === true && parsed.executionPolicy === EXECUTION_POLICY }
    if (typeof value.root !== 'string' || !path.isAbsolute(value.root)
      || !value.grants || typeof value.grants !== 'object' || Array.isArray(value.grants)
      || !value.workspaces || typeof value.workspaces !== 'object' || Array.isArray(value.workspaces)
      || Object.values(value.grants).some(grants => !Array.isArray(grants) || grants.some(item => typeof item !== 'string' || !path.isAbsolute(item)))
      || Object.values(value.workspaces).some(item => typeof item !== 'string')) throw new Error('本机执行设置无效')
  } catch (error) {
    if (error.code !== 'ENOENT') {
      // Fail closed without preventing the rest of Matter from opening.
      value = { ...defaults, loadError: '本机执行设置无法读取，已安全关闭；重新开启会重建设置' }
    }
  }
  return {
    get: () => value,
    save(next) { privateWrite(filename, next); value = next; return value },
    update(patch) { return this.save({ ...value, ...patch }) },
  }
}

module.exports = { createStore, privateWrite, EXECUTION_POLICY }
