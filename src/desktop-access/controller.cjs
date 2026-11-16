function createAccessController({ service, onChange = () => {}, onActive = async () => {}, onBlocked = async () => {},
  intervalMs = 20000, setIntervalImpl = setInterval, clearIntervalImpl = clearInterval }) {
  let state = { status: 'checking', message: '' }
  let pending, timer, disposed = false, generation = 0
  const listeners = new Set([onChange])
  const snapshot = () => ({ ...state })
  function publish(status, message = '') {
    if (disposed) return
    state = { status, message }
    for (const listener of listeners) listener(snapshot())
  }
  async function run(code) {
    if (disposed) return snapshot()
    if (pending) return pending
    const wasActive = state.status === 'active', expected = generation
    if (!wasActive) publish('checking')
    pending = (async () => {
      let startingBusiness = false
      try {
        const required = await service.policy()
        if (required) {
          if (code !== undefined) await service.activate(code)
          else if (wasActive) await service.renew()
          else await service.restore()
        }
        if (disposed || expected !== generation) return snapshot()
        if (!wasActive) { startingBusiness = true; await onActive() }
        publish('active')
      } catch (error) {
        if (disposed || expected !== generation) return snapshot()
        const status = error.code === 'device_unactivated' ? 'unactivated' : error.code === 'device_revoked' ? 'revoked'
          : error.code === 'secure_key_unsupported' ? 'unsupported' : 'retryable_error'
        // Stop business abilities before exposing the blocked state.
        if (wasActive || startingBusiness) await onBlocked()
        publish(status, error.message || '激活检查失败，请重试')
      }
      return snapshot()
    })().finally(() => { pending = undefined })
    return pending
  }
  return { snapshot, check: () => run(), activate: code => run(code),
    subscribe(listener) { listeners.add(listener); listener(snapshot()); return () => listeners.delete(listener) },
    start() { if (!timer) { timer = setIntervalImpl(() => void run(), intervalMs); timer.unref?.() } return run() },
    dispose() { disposed = true; generation++; clearIntervalImpl(timer); listeners.clear() },
  }
}
module.exports = { createAccessController }
