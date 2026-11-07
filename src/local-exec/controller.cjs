const fs = require('node:fs/promises')
const path = require('node:path')
const { createStore, EXECUTION_POLICY } = require('./store.cjs')
const { createWorkspaces } = require('./workspace.cjs')
const { createPairing, deviceSocketURL } = require('./pairing.cjs')
const { connectDesktop } = require('./connection.cjs')
const { validateCall, tokenAccount, requestHeaders } = require('./contract.cjs')
const { runSandboxed, resolveUserPath } = require('./shell.cjs')
const { SANDBOX_EXEC } = require('./sandbox.cjs')
const { fileOperation, fileDiff } = require('./files.cjs')
const { systemFolderFor, requestSystemFolder: requestNativeSystemFolder } = require('./system-folders.cjs')

function createController({ app, safeStorage, fetchImpl, origin, dialog, getContents, getWindow, onSetupNeeded = () => {},
  platform = process.platform, home = require('node:os').homedir(), requestSystemFolder = requestNativeSystemFolder,
  store = createStore(app.getPath('userData')) }) {
  const workspaces = createWorkspaces({ store, userData: app.getPath('userData'), home })
  const pairing = createPairing({ store, safeStorage, fetchImpl, origin, version: app.getVersion() })
  const revisions = new Map()
  const mutations = new Set()
  let account = '', state = store.get().loadError || '已关闭', connection, disposed = false, polling = false, enabling = false, userPath
  let generation = 0, setupPresented = false, directoryRequest = false

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
    if (disposed || signal?.aborted || expected !== generation || !store.get().enabled
      || store.get().executionPolicy !== EXECUTION_POLICY
      || !account || current.account !== account || store.get().pairing?.account !== account) throw new Error('本机执行已关闭、账号已变化或操作已取消')
  }
  function connect() {
    if (connection || disposed || !store.get().enabled || store.get().executionPolicy !== EXECUTION_POLICY || !account || store.get().pairing?.account !== account || store.get().pairing?.origin !== origin) return
    connection = connectDesktop({ url: deviceSocketURL(store.get().pairing.wsURL, origin), token: pairing.token(),
      deviceId: store.get().pairing.deviceId, version: app.getVersion(), execute,
      onState: next => { state = next },
      onRevoked: () => { stop('配对已失效，请重新开启'); store.update({ enabled: false, allowNetwork: false, pairing: null, grants: {}, workspaces: {} }) },
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
        stop(account ? '请开启本机执行' : '请先登录 Matter')
        if (previous || (store.get().pairing && (store.get().pairing.account !== account || store.get().pairing.origin !== origin))) store.update({ enabled: false, allowNetwork: false, grants: {}, workspaces: {} })
      }
      if (account && !store.get().setupSeen && !setupPresented) {
        setupPresented = true
        onSetupNeeded()
      }
      if (store.get().enabled && platform === 'darwin') {
        await fs.access(SANDBOX_EXEC, fs.constants.X_OK)
        userPath ||= await resolveUserPath()
        connect()
      }
    } catch { stop('本机执行不可用，请在设置中重新开启') }
    finally { polling = false }
  }
  const timer = setInterval(() => void refresh(), 1000)
  timer.unref()

  async function chooseFolder(requested) {
    if (directoryRequest) throw new Error('已有文件夹授权窗口打开，请先完成选择')
    directoryRequest = true
    try {
      const options = { title: '允许 Matter 访问此文件夹', message: '选择后，本会话可在该文件夹内执行命令和读写文件，无需逐次确认。',
        properties: ['openDirectory', 'createDirectory', 'dontAddToRecent'] }
      if (requested) options.defaultPath = await fs.stat(requested).then(value => value.isDirectory() ? requested : path.dirname(requested)).catch(() => path.dirname(requested))
      const window = getWindow()
      if (window && !window.isDestroyed()) { window.show?.(); window.focus?.() }
      const result = window && !window.isDestroyed() ? await dialog.showOpenDialog(window, options) : await dialog.showOpenDialog(options)
      if (result.canceled || result.filePaths.length !== 1) throw Object.assign(new Error('用户取消了文件夹授权，不要换写法重试'), { denied: true })
      return result.filePaths[0]
    } finally { directoryRequest = false }
  }
  async function authorize(meta, requested, expected, signal) {
    const systemFolder = platform === 'darwin' ? systemFolderFor(requested, home) : null
    if (systemFolder) {
      if (directoryRequest) throw new Error('已有文件夹授权请求，请先完成系统授权')
      directoryRequest = true
      try {
        await assertActive(expected, signal)
        if (await requestSystemFolder(systemFolder)) {
          await workspaces.grant(meta.conversation_id, systemFolder.root, () => assertActive(expected, signal))
        }
      } finally { directoryRequest = false }
    }
    await assertActive(expected, signal)
    let resolved = await workspaces.resolve(meta.conversation_id, meta.conversation_title, requested)
    if (resolved.authorized) return resolved
    await assertActive(expected, signal)
    const selected = await chooseFolder(resolved.filename)
    await assertActive(expected, signal)
    await workspaces.grant(meta.conversation_id, selected, () => assertActive(expected, signal))
    resolved = await workspaces.resolve(meta.conversation_id, meta.conversation_title, requested)
    if (!resolved.authorized) throw new Error('所选授权目录不包含请求路径，请让 Matter 使用你选择的目录')
    return resolved
  }
  async function execute(params, signal) {
    const { name, args, meta } = validateCall(params)
    const expected = generation
    await assertActive(expected, signal)
    // Keep mutations serialized while directory authorization or execution is pending.
    const mutation = name !== 'local_read_file'
    if (mutation && mutations.has(meta.conversation_id)) throw new Error('本会话已有本机修改正在等待或执行，请等待结果')
    if (mutation) mutations.add(meta.conversation_id)
    try {
      const resolved = await authorize(meta, name === 'local_shell' ? args.cwd : args.path, expected, signal)
      const options = { roots: resolved.allowed, denied: workspaces.denied, cwd: resolved.allowed[0], userPath }
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
    if (args.needs_network && !store.get().allowNetwork) return { denied: true, permission_required: 'network',
      error: '本机联网尚未授权。请在本机执行设置中开启联网；不要重复请求或去掉 needs_network 绕过。' }
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
    if (!enabled) { stop(); store.update({ enabled: false }); return }
    if (enabling) throw new Error('正在开启本机执行')
    enabling = true
    stop('正在开启')
    const expected = generation
    try {
      if (platform !== 'darwin') throw new Error('本机执行目前仅支持 macOS')
      await fs.access(SANDBOX_EXEC, fs.constants.X_OK)
      const current = await identity(true)
      if (!current.account) throw new Error('请先在 Matter 主窗口登录')
      account = current.account
      if (store.get().pairing?.account !== account || store.get().pairing?.origin !== origin) {
        store.update({ allowNetwork: false, grants: {}, workspaces: {} })
        await pairing.pair(current.token, account)
      }
      userPath = await resolveUserPath()
      if (disposed || expected !== generation || (await identity()).account !== account) throw new Error('开启已取消或登录账号已变化，请重新开启')
      store.update({ enabled: true, executionPolicy: EXECUTION_POLICY, setupSeen: true, loadError: undefined }); connect()
    } catch (error) { store.update({ enabled: false }); stop(error.message); throw error }
    finally { enabling = false }
  }
  function currentConversation() {
    try { return new URL(getContents()?.getURL()).pathname.match(/^\/c\/([A-Za-z0-9_-]{1,80})(?:\/|$)/)?.[1] || '' } catch { return '' }
  }
  return {
    refresh, setEnabled, execute,
    headers(headers, url) { return requestHeaders(headers, { origin, url, account, pairing: store.get().pairing, ready: store.get().enabled && state === '在线' }) },
    snapshot() {
      const conversationId = currentConversation()
      return { enabled: store.get().enabled, allowNetwork: store.get().allowNetwork === true, canEnable: Boolean(account), state, root: store.get().root, conversationId,
        grants: conversationId ? store.get().grants[conversationId] || [] : [], deviceId: store.get().pairing?.deviceId || '' }
    },
    acknowledgeSetup() { store.update({ setupSeen: true, executionPolicy: EXECUTION_POLICY }) },
    setNetworkAllowed(allowed) {
      if (typeof allowed !== 'boolean') throw new Error('联网授权值无效')
      if (allowed === store.get().allowNetwork) return
      stop('联网授权已更改'); store.update({ allowNetwork: allowed }); connect()
    },
    async chooseRoot() {
      const selected = await require('./workspace.cjs').canonical(await chooseFolder())
      await workspaces.validateRoot(selected)
      stop('根目录已更换，请重新开启')
      store.update({ enabled: false, root: selected, workspaces: {} })
    },
    async addFolder() {
      const id = currentConversation()
      if (!id || !account || store.get().pairing?.account !== account) throw new Error('请登录并打开已配对账号的具体会话')
      const expected = generation, owner = account
      const selected = await chooseFolder()
      await workspaces.grant(id, selected, async () => {
        const current = await identity()
        if (expected !== generation || currentConversation() !== id || current.account !== owner || account !== owner) throw new Error('会话或账号已变化，请重试')
      })
    },
    removeFolder(directory) {
      const id = currentConversation()
      stop('授权已变更，请重新开启'); store.update({ enabled: false, grants: { ...store.get().grants, [id]: (store.get().grants[id] || []).filter(value => value !== directory) } })
    },
    async currentFolder() { const id = currentConversation(); if (!id) throw new Error('请先打开具体会话'); return workspaces.folder(id, '') },
    async revoke() { stop('已断开'); store.update({ enabled: false }); await pairing.revoke() },
    suspend() { stop('窗口已关闭'); account = '' },
    dispose() { disposed = true; clearInterval(timer); stop() },
  }
}

module.exports = { createController }
