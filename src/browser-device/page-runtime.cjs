const fs = require('node:fs')
const path = require('node:path')

const OWNER = 'matter-native-browser'
const WORLD = 'minduck-browser-tools'
const HELPERS = new Set(['accessibility-tree-helper.js', 'click-helper.js', 'fill-helper.js',
  'interactive-elements-helper.js', 'keyboard-helper.js', 'screenshot-helper.js',
  'web-fetcher-helper.js', 'wait-helper.js', 'dom-observer.js', 'inject-bridge.js'])

// Installed in a private CDP world. It supplies only the helper's message interface;
// there is no IPC, filesystem, Node.js or extension privilege in this world.
function installMessages() {
  if (globalThis.__minduckMessages) return
  const listeners = new Set()
  globalThis.chrome = { runtime: { onMessage: { addListener: listener => listeners.add(listener) } } }
  globalThis.__minduckMessages = async message => {
    return new Promise((resolve, reject) => {
      let answered = false, waiting = false
      const timer = setTimeout(() => reject(new Error('页面工具响应超时')), 15000)
      const respond = value => { if (!answered) { answered = true; clearTimeout(timer); resolve(value) } }
      for (const listener of listeners) {
        try { if (listener(message, {}, respond) === true) waiting = true } catch (error) {
          clearTimeout(timer); reject(error); return
        }
        if (answered) break
      }
      if (!answered && !waiting) { clearTimeout(timer); reject(new Error('页面工具尚未注入')) }
    })
  }
}

function createPageRuntime({ compatibility, extensionRoot, guard }) {
  const frameIds = new WeakMap()
  const sessions = new WeakMap()
  const dialogs = new Map()
  const childTargets = { autoAttach: true, waitForDebuggerOnStart: false, flatten: true,
    filter: [{ type: 'iframe', exclude: false }, { exclude: true }] }
  async function attach(tabId) {
    const contents = compatibility.tabById(tabId).view.webContents
    if (!dialogs.has(tabId)) {
      dialogs.set(tabId, false)
      const children = new Map()
      sessions.set(contents, children)
      contents.debugger.on('message', (_event, method, params) => {
        if (method === 'Page.javascriptDialogOpening') dialogs.set(tabId, true)
        if (method === 'Page.javascriptDialogClosed') dialogs.set(tabId, false)
        if (method === 'Target.attachedToTarget' && params.targetInfo.type === 'iframe') {
          children.set(params.targetInfo.targetId, params.sessionId)
        }
        if (method === 'Target.detachedFromTarget') {
          for (const [id, sessionId] of children) if (sessionId === params.sessionId) children.delete(id)
        }
      })
      contents.debugger.on('detach', () => { children.clear(); dialogs.set(tabId, false) })
      contents.once('destroyed', () => dialogs.delete(tabId))
    }
    const attached = contents.debugger.isAttached()
    compatibility.debuggerAttach({ target: { tabId }, requiredVersion: '1.3', extensionId: OWNER })
    if (!attached) {
      await contents.debugger.sendCommand('Page.enable')
      // This page's child iframe targets only; no browser-wide target discovery.
      await contents.debugger.sendCommand('Target.setAutoAttach', childTargets)
    }
    return contents
  }
  async function command(tabId, method, params = {}, sessionId) {
    await guard()
    const contents = await attach(tabId)
    return contents.debugger.sendCommand(method, params, sessionId)
  }
  async function frames(tabId) {
    const contents = compatibility.tabById(tabId).view.webContents
    const { frameTree } = await command(tabId, 'Page.getFrameTree')
    let ids = frameIds.get(contents)
    if (!ids) { ids = new Map(); frameIds.set(contents, ids) }
    const result = new Map()
    const visit = (node, main = false, sessionId) => {
      if (!ids.has(node.frame.id)) ids.set(node.frame.id, main ? 0 : ids.size)
      result.set(node.frame.id, { id: node.frame.id, frameId: ids.get(node.frame.id), sessionId })
      for (const child of node.childFrames || []) visit(child, false, sessionId)
    }
    visit(frameTree, true)
    for (const sessionId of sessions.get(contents).values()) {
      await command(tabId, 'Target.setAutoAttach', childTargets, sessionId)
      const child = await command(tabId, 'Page.getFrameTree', {}, sessionId)
      visit(child.frameTree, false, sessionId)
    }
    return [...result.values()]
  }
  async function evaluate(tabId, frame, expression, world = 'ISOLATED') {
    const params = { expression, awaitPromise: true, returnByValue: true, userGesture: true }
    if (world !== 'MAIN') {
      const { executionContextId } = await command(tabId, 'Page.createIsolatedWorld', {
        frameId: frame.id, worldName: WORLD, grantUniveralAccess: false,
      }, frame.sessionId)
      params.contextId = executionContextId
    } else if (frame.frameId !== 0) throw new Error('MAIN 脚本仅支持主框架')
    const response = await command(tabId, 'Runtime.evaluate', params, frame.sessionId)
    if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception?.description || response.exceptionDetails.text)
    await guard()
    return response.result?.value
  }
  async function executeScript({ target, files, func, args = [], world = 'ISOLATED' }) {
    const all = await frames(target.tabId)
    const selected = target.frameIds ? all.filter(frame => target.frameIds.includes(frame.frameId))
      : target.allFrames ? all : all.slice(0, 1)
    if (!selected.length) throw new Error('页面框架已变化，请重新读取页面')
    let code
    if (files) {
      if (world === 'MAIN') throw new Error('工具辅助脚本必须使用隔离环境')
      code = '(' + installMessages.toString() + ')();\n' + files.map(file => {
        const name = file.replace(/^inject-scripts\//, '')
        if (!HELPERS.has(name)) throw new Error('不支持的页面辅助脚本')
        return fs.readFileSync(path.join(extensionRoot, 'inject-scripts', name), 'utf8')
      }).join('\n') + '\nvoid 0'
    } else {
      if (typeof func !== 'function') throw new Error('页面脚本无效')
      code = '(' + func.toString() + ')(...' + JSON.stringify(args) + ')'
    }
    const results = []
    for (const frame of selected) results.push({ frameId: frame.frameId,
      result: await evaluate(target.tabId, frame, code, world) })
    return results
  }
  return {
    attach,
    isDialogOpen: tabId => tabId === undefined ? [...dialogs.values()].includes(true) : dialogs.get(tabId) === true,
    release() {
      for (const tabId of dialogs.keys()) {
        if (compatibility.debuggerOwners.get(tabId) !== OWNER) continue
        try { compatibility.debuggerDetach({ target: { tabId }, extensionId: OWNER }) } catch {}
        dialogs.set(tabId, false)
      }
    },
    executeScript,
    async sendMessage(tabId, message, options = {}) {
      const all = await frames(tabId)
      const frame = all.find(item => item.frameId === (options.frameId ?? 0))
      if (!frame) throw new Error('页面框架已变化，请重新读取页面')
      return evaluate(tabId, frame, 'globalThis.__minduckMessages(' + JSON.stringify(message) + ')')
    },
  }
}

module.exports = { createPageRuntime, OWNER }
