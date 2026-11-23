const fs = require('node:fs/promises')
const { createStore, EXECUTION_POLICY } = require('./store.cjs')
const { createWorkspaces } = require('./workspace.cjs')
const { validateCall, tokenAccount } = require('./contract.cjs')
const { runSandboxed, resolveUserPath } = require('./shell.cjs')
const { SANDBOX_EXEC } = require('./sandbox.cjs')
const { fileOperation, fileDiff } = require('./files.cjs')
const { openLocalPath } = require('./open-file.cjs')
const { createNativeAccess, accessDeniedResult } = require('./system-folders.cjs')
const { createPathAccess } = require('./path-access.cjs')
const { cleanupLegacyWorkspaces } = require('./cleanup-workspaces.cjs')

function createController({ app, origin, getContents, probeAccess, openPath, confirmAccess,
  platform = process.platform, home = require('node:os').homedir(), resolvePath = resolveUserPath,
  store = createStore(app.getPath('userData')) }) {
  const workspaces = createWorkspaces({ store, userData: app.getPath('userData'), home, systemAccess: true })
  const revisions = new Map()
  const mutations = new Set()
  const activeCalls = new Set()
  const permissions = createNativeAccess({ home, denied: workspaces.denied, probeAccess })
  const pathAccess = createPathAccess({ home, userData: app.getPath('userData'), confirmAccess })
  let cleanup
  let account = '', state = store.get().loadError || '已关闭', disposed = false, polling = false, enabling = false, userPath
  let generation = 0, retryAt = 0, blockedAccount = '', waitingPermissions = 0
  const supported = () => platform === 'darwin'

  async function identity(withToken = false) {
    const contents = getContents()
    if (!contents || contents.isDestroyed() || new URL(contents.getURL() || 'about:blank').origin !== origin) return { account: '' }
    const token = await contents.executeJavaScriptInIsolatedWorld(1002, [{ code: "localStorage.getItem('matter.token') || ''" }])
    return { account: tokenAccount(token), ...(withToken ? { token } : {}) }
  }
  function stop(status = '已关闭') {
    generation++; for (const call of activeCalls) call.abort(); state = status; waitingPermissions = 0; revisions.clear(); permissions.clear(); pathAccess.clear()
  }
  async function assertIdentity(expected, signal) {
    const current = await identity()
    if (disposed || signal?.aborted || expected !== generation || !account || current.account !== account) throw new Error('账号已变化或操作已取消')
  }
  async function assertActive(expected, signal) {
    await assertIdentity(expected, signal)
    if (!supported() || !store.get().enabled || store.get().executionPolicy !== EXECUTION_POLICY) throw new Error('本机执行器不可用或已关闭')
  }
  async function refresh() {
    if (polling || disposed || enabling) return
    polling = true
    try {
      cleanup ||= cleanupLegacyWorkspaces({ root: store.get().root, home, workspaces: store.get().workspaces })
      await cleanup
      const current = await identity()
      if (current.account !== account) {
        const previous = account
        account = current.account
        stop(account ? '正在连接本机执行' : '请先登录 Matter')
        retryAt = 0; blockedAccount = ''
        if (previous) store.update({ enabled: false, allowNetwork: false, grants: {}, workspaces: {} })
      }
      if (!supported()) {
        if (store.get().enabled) { stop('本机执行目前仅支持 macOS'); store.update({ enabled: false }) }
        state = '本机执行目前仅支持 macOS'
        return
      }
      if (account && blockedAccount !== account && Date.now() >= retryAt) {
        if (!store.get().enabled || store.get().executionPolicy !== EXECUTION_POLICY) {
          retryAt = Date.now() + 15000
          await setEnabled(true)
        } else {
          await fs.access(SANDBOX_EXEC, fs.constants.X_OK)
          userPath ||= await resolvePath()
          state = waitingPermissions ? '等待系统授权' : '在线'
        }
      }
    } catch (error) {
      retryAt = Math.max(retryAt, Date.now() + (error.retryAfterMs || 15000))
      stop(error.message || '本机执行暂不可用')
    }
    finally { polling = false }
  }
  const timer = setInterval(() => void refresh(), 1000)
  timer.unref()

  async function execute(params, externalSignal) {
    const call = new AbortController()
    const signal = externalSignal ? AbortSignal.any([externalSignal, call.signal]) : call.signal
    activeCalls.add(call)
    try { return await executeCall(params, signal) }
    finally { activeCalls.delete(call) }
  }
  async function executeCall(params, signal) {
    const { name, args, meta } = validateCall(params)
    const expected = generation
    if (name === 'local_request_permission') {
      await assertIdentity(expected, signal)
      if (platform !== 'darwin') return { status: 'unsupported', permission_required: false, command_executed: false, message: '本机执行目前仅支持 macOS。' }
    }
    await assertActive(expected, signal)
    if (name === 'local_open_file' && typeof openPath !== 'function') return { status:'client_upgrade_required', isError:true,
      command_executed:false, message:'当前客户端没有原生文件打开能力，请更新客户端；本次未打开文件。' }
    // Keep mutations serialized while execution is pending.
    const mutation = name !== 'local_read_file' && name !== 'local_transfer_read'
    if (mutation && mutations.has(meta.conversation_id)) throw new Error('本会话已有本机修改正在等待或执行，请等待结果')
    if (mutation) mutations.add(meta.conversation_id)
    try {
      const workspace = await workspaces.folder(meta.conversation_id, meta.conversation_title)
      const requested = name === 'local_shell' ? args.cwd : args.path
      const resolved = await workspaces.resolve(meta.conversation_id, meta.conversation_title, requested)
      const task = JSON.stringify([account, meta.conversation_id, meta.run_id || meta.tool_call_id || 'current'])
      const access = ['local_read_file', 'local_transfer_read', 'local_open_file'].includes(name) ? 'read' : 'write'
      const approval = await pathAccess.request(resolved.filename, { task, access, reason: args.reason || args.description,
        conversation: meta.conversation_title, signal, validate: () => assertActive(expected, signal) })
      if (approval?.denied) return approval
      if (name !== 'local_shell' || requested || approval) {
        waitingPermissions++; state = '等待系统授权'
        let access
        try { access = await permissions.request(resolved.filename, { attempt: meta.run_id || meta.tool_call_id || meta.conversation_id,
          validate: () => assertActive(expected, signal) }) }
        finally { if (expected === generation) { waitingPermissions--; state = waitingPermissions ? '等待系统授权' : '在线' } }
        if (access.denied && approval) pathAccess.revoke(task, resolved.filename)
        if (name === 'local_request_permission' || access.denied) return access
      }
      const checked = await workspaces.resolve(meta.conversation_id, meta.conversation_title, requested)
      if (checked.filename !== resolved.filename) throw new Error('文件路径已变化，请重新发起任务')
      const options = { roots: resolved.allowed, denied: workspaces.denied, restricted: await pathAccess.restrictions(),
        grants: pathAccess.grants(task), cwd: workspace, userPath, home }
      if (name === 'local_open_file') {
        if (!resolved.authorized) throw new Error('文件路径未获授权')
        return await openLocalPath(resolved.filename, { openPath, validate:() => assertActive(expected, signal) })
      }
      if (name === 'local_transfer_read') {
        if (!resolved.authorized) throw new Error('文件路径未获授权')
        await assertActive(expected, signal)
        const result = await fileOperation({ action: 'transfer-read', filename: resolved.filename, args }, options, signal)
        await assertActive(expected, signal)
        return result
      }
      if (name === 'local_read_file') {
        await assertActive(expected, signal)
        const result = await fileOperation({ action: 'read', filename: resolved.filename, args }, options, signal)
        revisions.set(account + ':' + meta.conversation_id + ':' + resolved.filename, result.revision)
        if (revisions.size > 10000) revisions.delete(revisions.keys().next().value)
        return result
      }
      if (name === 'local_shell') return await executeShell(args, meta, resolved, options, expected, signal)
      return await executeFile(name, args, meta, resolved, options, expected, signal)
    } catch (error) {
      await assertActive(expected, signal)
      if (!['EACCES', 'EPERM'].includes(error.code)) throw error
      return accessDeniedResult(error.path || args.path || args.cwd || '', error, {
        commandExecuted: error.operation_started === true, partial: error.may_have_partial_effects === true,
      })
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
      if (!supported()) throw new Error('本机执行目前仅支持 macOS')
      await fs.access(SANDBOX_EXEC, fs.constants.X_OK)
      const current = await identity(true)
      if (!current.account) throw new Error('请先在 Matter 主窗口登录')
      account = current.account
      userPath ||= await resolvePath()
      if (disposed || expected !== generation || (await identity()).account !== account) throw new Error('开启已取消或登录账号已变化，请重新开启')
      store.update({ enabled: true, allowNetwork: true, executionPolicy: EXECUTION_POLICY, setupSeen: true, loadError: undefined }); retryAt = 0; state = '在线'
    } catch (error) { store.update({ enabled: false }); stop(error.message); throw error }
    finally { enabling = false }
  }
  function currentConversation() {
    try { return new URL(getContents()?.getURL()).pathname.match(/^\/c\/([A-Za-z0-9_-]{1,80})(?:\/|$)/)?.[1] || '' } catch { return '' }
  }
  return {
    refresh, setEnabled, execute,
    async retry() {
      if (blockedAccount && blockedAccount === account) return
      retryAt = 0
      await refresh()
    },
    snapshot() {
      const conversationId = currentConversation()
      return { enabled: store.get().enabled, ready: store.get().enabled && ['在线', '等待系统授权'].includes(state), allowNetwork: store.get().allowNetwork === true, canEnable: Boolean(account) && supported(), permissionRequired: false, canRequestPermission: supported() && store.get().enabled, canOpenFile:supported() && typeof openPath === 'function', state, root: home, conversationId,
        grants: conversationId ? store.get().grants[conversationId] || [] : [],  }
    },
    suspend() { stop('窗口已关闭'); account = '' },
    dispose() { disposed = true; clearInterval(timer); stop() },
  }
}

module.exports = { createController }
