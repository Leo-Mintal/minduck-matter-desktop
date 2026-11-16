const test = require('node:test')
const assert = require('node:assert/strict')
const { connectDesktop } = require('../src/local-exec/connection.cjs')

function sockets() {
  const items = []
  class Socket {
    constructor() { this.readyState = 1; this.events = {}; this.sent = []; items.push(this) }
    addEventListener(name, fn) { this.events[name] = fn }
    send(text) { this.sent.push(JSON.parse(text)) }
    close(code) { this.readyState = 3; this.events.close?.({ code }) }
  }
  return { items, Socket }
}
const tick = () => new Promise(resolve => setImmediate(resolve))

test('runtime obtains a fresh activation proof before each socket, including reconnect', async t => {
  const { items, Socket } = sockets()
  const resolvers = []
  const client = connectDesktop({ url: 'wss://matter.test', token: 'test-token', runtimeId: 'rt_test', WebSocketImpl: Socket,
    reconnectDelay: 1, execute: async () => ({}), getAccessProof: (id, token) => {
      assert.equal(id, 'rt_test'); assert.equal(token, 'test-token')
      return new Promise(resolve => resolvers.push(resolve))
    } })
  t.after(() => client.stop())
  assert.equal(items.length, 0)
  resolvers[0]({ challengeId: 'proof-1' }); await tick()
  items[0].events.open()
  assert.equal(items[0].sent[0].access_proof.challengeId, 'proof-1')
  items[0].close(1006)
  await new Promise(resolve => setTimeout(resolve, 10))
  assert.equal(items.length, 1); assert.equal(resolvers.length, 2)
  resolvers[1]({ challengeId: 'proof-2' }); await tick()
  items[1].events.open()
  assert.equal(items[1].sent[0].access_proof.challengeId, 'proof-2')
})

test('stopping while proof is pending never opens a late runtime socket', async () => {
  const { items, Socket } = sockets()
  let resolve
  const client = connectDesktop({ runtimeId: 'rt_test', WebSocketImpl: Socket,
    getAccessProof: () => new Promise(done => { resolve = done }) })
  client.stop(); resolve({ challengeId: 'late' }); await tick()
  assert.equal(items.length, 0)
})
