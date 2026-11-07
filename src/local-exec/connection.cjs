const VERSIONS = ['2025-06-18', '2025-11-25', '2025-03-26', '2024-11-05']

function connectDesktop({ url, token, deviceId, version, execute, onState = () => {}, onRevoked = () => {},
  WebSocketImpl = globalThis.WebSocket, reconnectDelay = 1000, tools, mcpResults = false, maxActive = 4,
  serverName = 'matter-desktop-local-exec', capabilities = { tools: {}, localExec: { version: 1, approval: 'local', sandbox: 'seatbelt' } } }) {
  let socket
  let timer
  let heartbeat
  let stopped = false
  let attempt = 0
  let initialized = false
  let authenticated = false
  const active = new Map()
  const seen = new Set()
  const cancelAll = () => { for (const controller of active.values()) controller.abort(); active.clear() }
  function send(current, value) { if (!stopped && socket === current && current.readyState === 1) current.send(JSON.stringify(value)) }
  function fail(current, id, message) { send(current, { jsonrpc: '2.0', id, error: { code: -32602, message } }) }
  async function message(current, raw) {
    if (typeof raw !== 'string' || Buffer.byteLength(raw) > 2 * 1024 * 1024) { current.close(4004, 'invalid frame'); return }
    let value
    try { value = JSON.parse(raw) } catch { current.close(4004, 'invalid JSON'); return }
    if (!value || typeof value !== 'object') return
    if (value.type === 'auth_ok') {
      if (value.device_id !== deviceId) { current.close(4004, 'device mismatch'); return }
      authenticated = true; attempt = 0
      return
    }
    if (value.type === 'ping') { send(current, { type: 'pong' }); return }
    if (!authenticated || value.jsonrpc !== '2.0') return
    const { method, id, params = {} } = value
    if (method === 'notifications/cancelled') { active.get(String(params.requestId))?.abort(); return }
    if (method === 'notifications/initialized') {
      if (initialized) onState('在线')
      return
    }
    if (id === undefined || id === null) return
    if (!(typeof id === 'string' && id.length > 0 && id.length <= 128) && !Number.isSafeInteger(id)) return fail(current, id, 'invalid request ID')
    if (method === 'initialize') {
      if (!VERSIONS.includes(params.protocolVersion)) return fail(current, id, 'unsupported protocol version')
      initialized = true
      return send(current, { jsonrpc: '2.0', id, result: { protocolVersion: params.protocolVersion,
        capabilities, serverInfo: { name: serverName, version } } })
    }
    if (method === 'ping') return send(current, { jsonrpc: '2.0', id, result: {} })
    if (method === 'tools/list' && initialized && tools) return send(current, { jsonrpc: '2.0', id, result: { tools } })
    if (method !== 'tools/call' || !initialized) return fail(current, id, 'unsupported desktop method')
    const key = String(id)
    if (seen.has(key) || active.size >= maxActive) return fail(current, id, 'duplicate request or desktop busy')
    if (seen.size >= 10000) { current.close(4000, 'refresh request window'); return }
    seen.add(key)
    const controller = new AbortController()
    active.set(key, controller)
    try {
      const result = await execute(params, controller.signal)
      if (!controller.signal.aborted) send(current, { jsonrpc: '2.0', id, result: mcpResults ? result : {
        content: [{ type: 'text', text: JSON.stringify(result) }],
        isError: result.denied === true || result.cancelled === true || result.timed_out === true || result.error !== undefined
          || ('exit_code' in result && result.exit_code !== 0),
      } })
    } catch (error) {
      if (!controller.signal.aborted) send(current, { jsonrpc: '2.0', id, result: {
        content: [{ type: 'text', text: JSON.stringify({ error: error.message, ...(error.denied ? { denied: true } : {}) }) }], isError: true,
      } })
    } finally { if (active.get(key) === controller) active.delete(key) }
  }
  function open() {
    if (stopped) return
    initialized = false; authenticated = false; seen.clear()
    onState('连接中')
    const current = new WebSocketImpl(url)
    socket = current
    const watch = () => {
      clearTimeout(heartbeat)
      heartbeat = setTimeout(() => { cancelAll(); current.close(4000, 'heartbeat timeout') }, 55000)
    }
    current.addEventListener('open', () => {
      if (socket !== current || stopped) return
      send(current, { type: 'auth', token, device_id: deviceId, browser: 'Matter Desktop', extension_version: version }); watch()
    })
    current.addEventListener('message', event => {
      if (socket !== current || stopped) return
      watch(); void message(current, event.data).catch(() => current.close(4004, 'invalid message'))
    })
    current.addEventListener('error', () => { if (socket === current && !stopped) { cancelAll(); onState('设备连接失败') } })
    current.addEventListener('close', event => {
      if (socket !== current || stopped) return
      clearTimeout(heartbeat); cancelAll(); onState('离线')
      if ([4001, 4002, 4003].includes(event.code)) { stopped = true; onRevoked(event.code); return }
      if (!stopped) timer = setTimeout(open, Math.min(30000, reconnectDelay * 2 ** Math.min(attempt++, 5)))
    })
  }
  open()
  return { stop() { stopped = true; clearTimeout(timer); clearTimeout(heartbeat); cancelAll(); socket?.close(1000, 'local execution stopped') } }
}

module.exports = { VERSIONS, connectDesktop }
