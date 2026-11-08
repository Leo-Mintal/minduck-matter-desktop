const fs = require('node:fs/promises')
const { createStore, EXECUTION_POLICY } = require('./store.cjs')
const { createWorkspaces } = require('./workspace.cjs')
const { createPairing, deviceSocketURL } = require('./pairing.cjs')
const { connectDesktop } = require('./connection.cjs')
const { validateCall, tokenAccount, requestHeaders } = require('./contract.cjs')
const { runSandboxed, resolveUserPath } = require('./shell.cjs')
const { SANDBOX_EXEC } = require('./sandbox.cjs')
const { fileOperation, fileDiff } = require('./files.cjs')
const { hasFullDiskAccess } = require('../fullDiskAccess.cjs')

function createController({ app, safeStorage, fetchImpl, origin, getContents, onPermissionNeeded = () => {},
  platform = process.platform, home = require('node:os').homedir(), checkPermission = hasFullDiskAccess, connectImpl = connectDesktop, resolvePath = resolveUserPath,
  store = createStore(app.getPath('userData')) }) {
  const workspaces = createWorkspaces({ store, userData: app.getPath('userData'), home, systemAccess: true })
  const pairing = createPairing({ store, safeStorage, fetchImpl, origin, version: app.getVersion() })
  const revisions = new Map()
  const mutations = new Set()
  let account = '', state = store.get().loadError || '已关闭', connection, disposed = false, polling = false, enabling = false, userPath
  let generation = 0, retryAt = 0, blockedAccount = ''
  const permitted = () => platform === 'darwin' && checkPermission({ platform })

  async function identity(withToken = false) {
    const contents = getContents()
    if (!contents || contents.isDestroyed() || new URL(contents.getURL() || 'about:blank').origin !== origin) return { account: '' }
    const token = await contents.executeJavaScriptInIsolatedWorld(1002, [{ code: "localStorage.getItem('matter.token') || ''" }])
    return { account: tokenAccount(token), ...(withToken ? { token } : {}) }
  }
  function stop(status = '已关闭') {
    generation++; connection?.stop(); connection = undefined; state = status; revisions.clear()
  }
  async function assertActive(expected, signal) {
    const current = await identity()
    if (disposed || signal?.aborted || expected !== generation || !permitted() || !store.get().enabled
      || store.get().executionPolicy !== EXECUTION_POLICY
      || !account || current.account !== account || store.get().pairing?.account !== account || store.get().pairing?.origin !== origin) throw new Error('本机执行未获系统授权、账号已变化或操作已取消')
  }
  function connect() {
    if (connection || disposed || !permitted() || !store.get().enabled || store.get().executionPolicy !== EXECUTION_POLICY || !account || store.get().pairing?.account !== account || store.get().pairing?.origin !== origin) return
    connection = connectImpl({ url: deviceSocketURL(store.get().pairing.wsURL, origin), token: pairing.token(),
      deviceId: store.get().pairing.deviceId, version: app.getVersion(), execute,
      onState: next => { state = next },
      onRevoked: () => { blockedAccount = account; stop('配对已撤销，请重新启动客户端'); store.update({ enabled: false, allowNetwork: false, pairing: null, grants: {}, workspaces: {} }) },
    })
  }
  async function refresh() {
    if (polling || disposed || enabling) return
    polling = true
    try {
      const current = await identity()
      if (current.account !== account) {
        const previous = account
        account = current.account
        stop(account ? '正在连接本机执行' : '请先登录 Matter')
        retryAt = 0; blockedAccount = ''
        if (previous || (store.get().pairing && (store.get().pairing.account !== account || store.get().pairing.origin !== origin))) store.update({ enabled: false, allowNetwork: false, grants: {}, workspaces: {} })
      }
      if (!permitted()) {
        if (store.get().enabled || connection) { stop('请在系统设置开启完全磁盘访问'); store.update({ enabled: false }) }
        state = platform === 'darwin' ? '请在系统设置开启完全磁盘访问' : '本机执行目前仅支持 macOS'
        void Promise.resolve(onPermissionNeeded()).catch(error => console.error('无法打开系统权限提示:', error))
        return
      }
      if (account && blockedAccount !== account && Date.now() >= retryAt) {
        if (!store.get().enabled || store.get().executionPolicy !== EXECUTION_POLICY || store.get().pairing?.account !== account || store.get().pairing?.origin !== origin) {
          retryAt = Date.now() + 15000
          await setEnabled(true)
        } else if (!connection) {
          await fs.access(SANDBOX_EXEC, fs.constants.X_OK)
          userPath ||= await resolvePath()
          connect()
        }
      }
    } catch (error) { stop(error.message || '本机执行暂不可用') }
    finally { polling = false }
  }
  const timer = setInterval(() => void refresh(), 1000)
  timer.unref()

  async function execute(params, signal) {
    const { name, args, meta } = validateCall(params)
    const expected = generation
    await assertActive(expected, signal)
    // Keep mutations serialized while execution is pending.
    const mutation = name !== 'local_read_file'
    if (mutation && mutations.has(meta.conversation_id)) throw new Error('本会话已有本机修改正在等待或执行，请等待结果')
    if (mutation) mutations.add(meta.conversation_id)
    try {
      const resolved = await workspaces.resolve(meta.conversation_id, meta.conversation_title, name === 'local_shell' ? args.cwd : args.path)
      const options = { roots: resolved.allowed, denied: workspaces.denied, cwd: resolved.allowed[0], userPath, home }
      if (name === 'local_read_file') {
        await assertActive(expected, signal)
        const result = await fileOperation({ action: 'read', filename: resolved.filename, args }, options, signal)
        revisions.set(account + ':' + meta.conversation_id + ':' + resolved.filename, result.revision)
        if (revisions.size > 10000) revisions.delete(revisions.keys().next().value)
        return result
      }
      if (name === 'local_shell') return await executeShell(args, meta, resolved, options, expected, signal)
      return await executeFile(name, args, meta, resolved, options, expected, signal)
    } finally { if (mutation) mutations.delete(meta.conversation_id) }
  }
  async function executeShell(args, meta, resolved, options, expected, signal) {
    if (!(await fs.stat(resolved.filename)).isDirectory()) throw new Error('cwd 必须是文件夹')
    await assertActive(expected, signal)
    const checked = await workspaces.resolve(meta.conversation_id, meta.conversation_title, resolved.filename)
    if (!checked.authorized || checked.filename !== resolved.filename) throw new Error('工作目录已变化，请重新发起')
    await assertActive(expected, signal)
    return runSandboxed({ ...options, roots: checked.allowed, cwd: checked.filename, network: args.needs_network === true }, '/bin/zsh', ['-f', '-c', args.command], { signal, timeoutMs: args.timeout_ms || 120000 })
  }
  async function executeFile(name, args, meta, resolved, options, expected, signal) {
    const key = account + ':' + meta.conversation_id + ':' + resolved.filename
    const revision = revisions.get(key) ?? null
    const prepared = await fileOperation({ action: name === 'local_edit_file' ? 'prepare-edit' : 'prepare-write',
      filename: resolved.filename, args, expectedRevision: revision }, options, signal)
    await assertActive(expected, signal)
    const checked = await workspaces.resolve(meta.conversation_id, meta.conversation_title, resolved.filename)
    if (!checked.authorized || checked.filename !== resolved.filename) throw new Error('文件路径已变化，请重新读取')
    await assertActive(expected, signal)
    const result = await fileOperation({ action: 'commit', filename: checked.filename,
      args: { content: prepared.after }, expectedRevision: prepared.revision }, { ...options, roots: checked.allowed }, signal)
    revisions.set(key, result.revision)
    return { ...result, diff: fileDiff(resolved.filename, prepared.before, prepared.after) }
  }
  async function setEnabled(enabled) {
    if (!enabled) { blockedAccount = account; stop(); store.update({ enabled: false }); return }
    if (enabling) throw new Error('正在开启本机执行')
    enabling = true
    stop('正在开启')
    const expected = generation
    try {
      if (!permitted()) throw new Error('请先在 macOS 系统设置中开启完全磁盘访问')
      await fs.access(SANDBOX_EXEC, fs.constants.X_OK)
      const current = await identity(true)
      if (!current.account) throw new Error('请先在 Matter 主窗口登录')
      account = current.account
      if (store.get().pairing?.account !== account || store.get().pairing?.origin !== origin) {
        store.update({ allowNetwork: false, grants: {}, workspaces: {} })
        await pairing.pair(current.token, account)
      }
      userPath ||= await resolvePath()
      if (disposed || !permitted() || expected !== generation || (await identity()).account !== account) throw new Error('开启已取消或登录账号已变化，请重新开启')
      store.update({ enabled: true, allowNetwork: true, executionPolicy: EXECUTION_POLICY, setupSeen: true, loadError: undefined }); retryAt = 0; connect()
    } catch (error) { store.update({ enabled: false }); stop(error.message); throw error }
    finally { enabling = false }
  }
  function currentConversation() {
    try { return new URL(getContents()?.getURL()).pathname.match(/^\/c\/([A-Za-z0-9_-]{1,80})(?:\/|$)/)?.[1] || '' } catch { return '' }
  }
  return {
    refresh, setEnabled, execute,
    headers(headers, url) { return requestHeaders(headers, { origin, url, account, pairing: store.get().pairing, ready: store.get().enabled && state === '在线' && permitted() }) },
    snapshot() {
      const conversationId = currentConversation()
      return { enabled: store.get().enabled, allowNetwork: store.get().allowNetwork === true, canEnable: Boolean(account) && permitted(), state, root: store.get().root, conversationId,
        grants: conversationId ? store.get().grants[conversationId] || [] : [], deviceId: store.get().pairing?.deviceId || '' }
    },
    suspend() { stop('窗口已关闭'); account = '' },
    dispose() { disposed = true; clearInterval(timer); stop() },
  }
}

module.exports = { createController }
