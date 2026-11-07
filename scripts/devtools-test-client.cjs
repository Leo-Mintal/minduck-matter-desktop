// Test-only helpers for probes that start their own --remote-debugging-port child. The app never opens one.
const fs = require('node:fs')
const path = require('node:path')

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
async function devToolsPort(userDataDirectory, timeout = 10_000) {
  const file = path.join(userDataDirectory, 'DevToolsActivePort')
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    try {
      const [port] = fs.readFileSync(file, 'utf8').trim().split(/\r?\n/)
      if (/^\d+$/.test(port)) return Number(port)
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
    }
    await delay(100)
  }
  throw new Error('Electron did not expose its DevTools endpoint')
}

class DevToolsClient {
  constructor(url) {
    this.nextId = 1
    this.pending = new Map()
    this.listeners = new Map()
    this.socket = new WebSocket(url)
    this.ready = new Promise((resolve, reject) => {
      this.socket.addEventListener('open', resolve, { once: true })
      this.socket.addEventListener('error', () => reject(new Error('DevTools WebSocket connection failed')), { once: true })
    })
    this.socket.addEventListener('message', (event) => this.handleMessage(event))
    this.socket.addEventListener('error', () => this.close(new Error('DevTools WebSocket connection failed')))
  }

  on(method, listener) {
    const listeners = this.listeners.get(method) ?? new Set()
    listeners.add(listener)
    this.listeners.set(method, listeners)
    return () => listeners.delete(listener)
  }

  async send(method, params = {}, sessionId) {
    await this.ready
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      const message = { id, method, params }
      if (sessionId) message.sessionId = sessionId
      this.socket.send(JSON.stringify(message))
    })
  }

  handleMessage(event) {
    let message
    try {
      message = JSON.parse(event.data)
    } catch {
      return
    }
    if (message.id) {
      const pending = this.pending.get(message.id)
      if (!pending) return
      this.pending.delete(message.id)
      if (message.error) {
        pending.reject(new Error(`DevTools ${message.error.message || 'command failed'}`))
      } else {
        pending.resolve(message.result)
      }
      return
    }
    for (const listener of this.listeners.get(message.method) ?? []) listener(message)
  }

  close(error = new Error('DevTools connection closed')) {
    for (const pending of this.pending.values()) pending.reject(error)
    this.pending.clear()
    this.socket.close()
  }
}

module.exports = { DevToolsClient, devToolsPort }
