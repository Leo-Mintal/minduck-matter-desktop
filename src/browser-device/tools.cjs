const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { AsyncLocalStorage } = require('node:async_hooks')
const { createPageRuntime, OWNER } = require('./page-runtime.cjs')

function createTools({ compatibility, extensionRoot, origin, fetchImpl, nativeImage }) {
  const calls = new AsyncLocalStorage()
  const listeners = new Set()
  const config = { 'matter.link': { apiBase: origin, allowedSites: [] } }
  let engine, busy = false, sequence = 0
  async function guard() {
    const current = calls.getStore()
    if (!current) return
    current.signal.throwIfAborted()
    await current.assertActive()
    current.signal.throwIfAborted()
  }
  const request = async (method, params) => { await guard(); return compatibility.request(method, params) }
  const page = createPageRuntime({ compatibility, extensionRoot, guard })
  const chrome = {
    runtime: { id: OWNER, getManifest: () => JSON.parse(fs.readFileSync(path.join(extensionRoot, 'manifest.json'), 'utf8')) },
    storage: { local: { get: async key => ({ [key]: config[key] }) } },
    tabs: {
      get: tabId => request('tabs.get', { tabId }), query: queryInfo => request('tabs.query', { queryInfo }),
      create: options => request('tabs.create', options), update: (tabId, updateProperties) => request('tabs.update', { tabId, updateProperties }),
      remove: tabIds => request('tabs.remove', { tabIds }), reload: tabId => request('tabs.reload', { tabId }),
      goBack: tabId => request('tabs.goBack', { tabId }), goForward: tabId => request('tabs.goForward', { tabId }),
      group: options => request('tabs.group', options), sendMessage: page.sendMessage,
      onUpdated: { addListener: listener => listeners.add(listener), removeListener: listener => listeners.delete(listener) },
    },
    tabGroups: { get: groupId => request('tabGroups.get', { groupId }), query: queryInfo => request('tabGroups.query', { queryInfo }),
      update: (groupId, updateProperties) => request('tabGroups.update', { groupId, updateProperties }) },
    windows: { get: (windowId, getInfo) => request('windows.get', { windowId, getInfo }),
      getAll: getInfo => request('windows.getAll', { getInfo }), getLastFocused: getInfo => request('windows.getLastFocused', { getInfo }),
      create: options => request('windows.create', options), update: (windowId, updateInfo) => request('windows.update', { windowId, updateInfo }) },
    debugger: { getTargets: () => request('debugger.getTargets', { extensionId: OWNER }),
      attach: async target => { await guard(); await page.attach(target.tabId) },
      // The native runtime owns this connection across tool calls; detaching here
      // would destroy helper contexts and reject pending dialog evaluations.
      detach: async () => {},
      // Page was enabled on attach. Re-enabling it while a modal is open blocks
      // the handler before it can send Page.handleJavaScriptDialog.
      sendCommand: async (target, method, commandParams) => {
        await guard()
        if (method === 'Page.enable' && page.isDialogOpen(target.tabId)) return {}
        return compatibility.request('debugger.sendCommand', { target, method, commandParams, extensionId: OWNER })
      } },
    scripting: { executeScript: page.executeScript },
  }
  async function mediaFetch(input) {
    await guard()
    const url = new URL(input)
    if (url.origin !== origin || !decodeURIComponent(url.pathname).startsWith('/media/')
      || decodeURIComponent(url.pathname).includes('..') || url.username || url.password) throw new Error('仅允许读取当前 Matter 的 /media/ 文件')
    const response = await fetchImpl(url.href, { redirect: 'error', signal: calls.getStore()?.signal })
    if (Number(response.headers.get('content-length')) > 20 * 1024 * 1024) {
      await response.body?.cancel().catch(() => {})
      throw new Error('上传文件不能超过 20MB')
    }
    // Bound the streamed body as well; Content-Length is not authoritative.
    return { ok: response.ok, status: response.status, headers: response.headers,
      async arrayBuffer() {
        const chunks = []; let size = 0
        for await (const chunk of response.body) {
          size += chunk.length
          if (size > 20 * 1024 * 1024) { await response.body.cancel?.().catch(() => {}); throw new Error('上传文件不能超过 20MB') }
          chunks.push(Buffer.from(chunk))
        }
        const bytes = Buffer.concat(chunks)
        return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
      } }
  }
  const source = fs.readFileSync(path.join(extensionRoot, 'background.js'), 'utf8')
  vm.runInNewContext(source, { chrome, URL, AbortController, setTimeout, clearTimeout, performance,
    console: { log() {}, warn() {}, error() {} }, fetch: mediaFetch, btoa: value => Buffer.from(value, 'binary').toString('base64'),
    __minduckNativeTools: {
      register: value => { engine = value },
      compressImage: data => ({ dataUrl: 'data:image/jpeg;base64,' + nativeImage.createFromDataURL(data).toJPEG(80).toString('base64'), mimeType: 'image/jpeg' }),
    },
  }, { filename: 'matter-browser-tools.js', timeout: 2000 })
  if (!engine || engine.schemas.length !== 15) throw new Error('内置浏览器工具版本不匹配')
  engine.watchGroupMembership()
  return {
    isDialogOpen: page.isDialogOpen,
    release: page.release,
    schemas: JSON.parse(JSON.stringify(engine.schemas)), version: chrome.runtime.getManifest().version,
    async execute(params, signal, assertActive) {
      if (busy) throw new Error('上一项浏览器操作仍在结束，请等待；不要重放可能已执行的动作')
      const args = params?.arguments ?? {}
      if (!params || typeof params.name !== 'string' || typeof args !== 'object'
        || Array.isArray(args)) throw new Error('浏览器工具参数无效')
      busy = true
      const requestId = 'native-' + ++sequence
      engine.beginCall(requestId)
      const cancel = () => { engine.cancel(requestId); page.release() }
      signal.addEventListener('abort', cancel, { once: true })
      try {
        return await calls.run({ signal, assertActive }, async () => {
          await guard()
          return engine.execute({ name: params.name, args, requestId })
        })
      } finally {
        signal.removeEventListener('abort', cancel); engine.endCall(requestId); busy = false
      }
    },
    notifyTabUpdated(tab, changeInfo) {
      for (const listener of listeners) listener(tab.id, changeInfo, tab)
    },
  }
}

module.exports = { createTools }
