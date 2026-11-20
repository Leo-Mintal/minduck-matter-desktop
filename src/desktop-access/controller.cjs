const ERROR_STATUS = new Map([
  ['device_unactivated', 'unactivated'],
  ['device_revoked', 'revoked'],
  ['invite_unavailable', 'invite_error'],
  ['secure_key_unsupported', 'unsupported'],
])

function createAccessController({ service, onChange = () => {}, onActive = async () => {}, onBlocked = async () => {},
  intervalMs = 20000, setIntervalImpl = setInterval, clearIntervalImpl = clearInterval }) {
  let state = { status: 'checking', message: '' }
  let pending, pendingActivation, timer, disposed = false
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
    const wasActive = state.status === 'active'
    pendingActivation = code !== undefined
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
        if (disposed) return snapshot()
        if (!wasActive) { startingBusiness = true; await onActive() }
        publish('active')
      } catch (error) {
        if (disposed) return snapshot()
        const temporary = error.code === 'desktop_access_unavailable'
        if (wasActive && temporary) {
          publish('active', error.message)
          return snapshot()
        }
        if (wasActive || startingBusiness) await onBlocked()
        const status = ERROR_STATUS.get(error.code) ?? (temporary ? 'retryable_error' : 'verification_error')
        publish(status, error.message || '激活检查失败，请重试')
      }
      return snapshot()
    })().finally(() => { pending = undefined })
    return pending
  }
  return { snapshot, check: () => run(),
    async activate(code) {
      if (pendingActivation && pending) return pending
      if (pending) await pending
      return state.status === 'active' ? snapshot() : run(code)
    },
    subscribe(listener) { listeners.add(listener); listener(snapshot()); return () => listeners.delete(listener) },
    start() { if (!timer) { timer = setIntervalImpl(() => void run(), intervalMs); timer.unref?.() } return run() },
    dispose() { disposed = true; clearIntervalImpl(timer); listeners.clear() },
  }
}
module.exports = { createAccessController }
