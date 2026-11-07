const { installMatterTaskMonitor } = require('./task-monitor.cjs')
const { isMatterWebURL } = require('../matterService.cjs')
const { createQaContract } = require('./qa-contract.cjs')

const TASK_WORLD = 1001
const MONITOR = '__minduckTaskMonitor'
const expression = `(() => {
  globalThis.${MONITOR} ??= (${installMatterTaskMonitor.toString()})((${createQaContract.toString()})());
  return globalThis.${MONITOR}.tick();
})()`

// Observe the fixed Matter view, independent of its current SPA route or window visibility.
function createMatterTaskBridge({ contents, origin, onOutput }) {
  let disposed = false, busy = false, generation = 0, previous = ''
  function publish(output = { active: false }) {
    const serialized = JSON.stringify(output)
    if (serialized !== previous) { previous = serialized; onOutput(output) }
  }
  function reset(_event, _url, inPlace, mainFrame) {
    if (mainFrame && !inPlace) { generation++; publish() }
  }
  async function tick() {
    if (disposed || busy || contents.isDestroyed()) return
    if (!isMatterWebURL(contents.getURL(), origin)) { publish(); return }
    busy = true
    const current = generation
    try {
      const output = await contents.executeJavaScriptInIsolatedWorld(TASK_WORLD, [{ code: expression }])
      if (!disposed && current === generation) publish(output)
    } catch { if (!disposed && current === generation) publish() }
    finally { busy = false }
  }
  const timer = setInterval(() => void tick(), 500)
  timer.unref()
  contents.on('did-start-navigation', reset)
  contents.on('did-finish-load', tick)
  contents.once('destroyed', dispose)
  function dispose() {
    if (disposed) return
    disposed = true; generation++
    clearInterval(timer)
    contents.removeListener('did-start-navigation', reset)
    contents.removeListener('did-finish-load', tick)
    if (!contents.isDestroyed()) void contents.executeJavaScriptInIsolatedWorld(TASK_WORLD,
      [{ code: `globalThis.${MONITOR}?.stop()` }]).catch(() => {})
    publish()
  }
  async function executeQa(command, target, files) {
    if (disposed || contents.isDestroyed() || !isMatterWebURL(contents.getURL(), origin)) {
      throw new Error('Matter 会话暂不可用')
    }
    return contents.executeJavaScriptInIsolatedWorld(TASK_WORLD, [{ code:
      `globalThis.${MONITOR}.act(${JSON.stringify(command)},${JSON.stringify(target)},${JSON.stringify(files ?? [])})` }])
  }
  return { dispose, executeQa }
}

module.exports = { createMatterTaskBridge }
