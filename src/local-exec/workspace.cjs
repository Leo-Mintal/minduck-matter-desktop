const fs = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')

function inside(root, filename) {
  const relative = path.relative(root, filename)
  return relative === '' || (relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative))
}

function sensitivePaths(home = os.homedir(), userData) {
  return ['.ssh', '.aws', '.gnupg', '.kube', '.docker', '.netrc', '.npmrc', '.pypirc',
    'Library/Keychains', 'Library/Application Support', 'Library/Messages', 'Library/Mail']
    .map(value => path.join(home, value)).concat(userData ? [userData] : [])
}

async function canonical(filename) {
  if (typeof filename !== 'string' || !filename || filename.includes('\0')) throw new Error('文件路径无效')
  const absolute = path.resolve(filename)
  try { return await fs.realpath(absolute) }
  catch (error) {
    if (error.code !== 'ENOENT') throw error
    const parent = path.dirname(absolute)
    if (parent === absolute) throw error
    return path.join(await canonical(parent), path.basename(absolute))
  }
}

function createWorkspaces({ store, userData, home = os.homedir() }) {
  const denied = sensitivePaths(home, userData)
  const forbidden = filename => denied.some(root => inside(root, filename))
  async function validateRoot(selected = store.get().root) {
    const root = await canonical(selected)
    if (root !== path.resolve(selected)) throw new Error('根目录已被符号链接替换，请重新选择')
    if (forbidden(root) || inside(root, home)) throw new Error('工作目录范围过大或位于敏感目录')
    await fs.mkdir(root, { recursive: true, mode: 0o700 })
    return root
  }
  async function folder(conversationId, title = '') {
    if (!/^[A-Za-z0-9_-]{1,80}$/.test(conversationId)) throw new Error('会话标识无效')
    const root = await validateRoot()
    let name = store.get().workspaces[conversationId]
    if (!name) {
      const safeTitle = String(title).normalize('NFKC').replace(/[^\p{L}\p{N}_-]/gu, '-').slice(0, 50) || '会话'
      name = `${safeTitle}-${conversationId}`
      store.update({ workspaces: { ...store.get().workspaces, [conversationId]: name } })
    }
    if (path.basename(name) !== name) throw new Error('工作目录映射无效')
    const directory = await canonical(path.join(root, name))
    if (directory !== path.join(root, name) || forbidden(directory)) throw new Error('工作目录越界或被符号链接替换')
    await fs.mkdir(directory, { recursive: true, mode: 0o700 })
    return directory
  }
  async function roots(conversationId, title) {
    const workspace = await folder(conversationId, title)
    const saved = store.get().grants[conversationId] || []
    const grants = await Promise.all(saved.map(canonical))
    if (grants.some((value, index) => forbidden(value) || value !== saved[index])) throw new Error('授权目录已变化或包含敏感路径，请重新授权')
    return [workspace, ...grants]
  }
  async function resolve(conversationId, title, requested) {
    const allowed = await roots(conversationId, title)
    const expanded = requested === '~' ? home : requested?.startsWith('~/') ? path.join(home, requested.slice(2)) : requested
    const filename = await canonical(path.resolve(allowed[0], expanded || '.'))
    if (forbidden(filename)) throw new Error('敏感路径禁止访问')
    return { filename, allowed, authorized: allowed.some(root => inside(root, filename)) }
  }
  async function grant(conversationId, selected, validate = async () => {}) {
    const directory = await canonical(selected)
    if (forbidden(directory) || inside(directory, home) || !(await fs.stat(directory)).isDirectory()) throw new Error('不可授权此目录，请选择具体项目文件夹')
    await validate()
    const grants = [...new Set([...(store.get().grants[conversationId] || []), directory])]
    store.update({ grants: { ...store.get().grants, [conversationId]: grants } })
    return directory
  }
  return { folder, roots, resolve, grant, denied, validateRoot }
}

module.exports = { canonical, inside, sensitivePaths, createWorkspaces }
