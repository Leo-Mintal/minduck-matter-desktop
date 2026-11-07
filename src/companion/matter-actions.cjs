const { randomBytes } = require('node:crypto')
const { once } = require('node:events')
const { createServer } = require('node:http')
const { loopbackOrigin } = require('./runtime.cjs')
const { createQaContract } = require('./qa-contract.cjs')

const ACTIONS = new Set(['new-chat', 'open-app', 'open-conversation', 'qa-answer', 'qa-upload', 'chat-context', 'chat-send', 'chat-upload', 'chat-queue', 'chat-stop'])
const qaContract = createQaContract()
const ID = /^[a-zA-Z0-9_-]{1,200}$/u

function conversationTarget(value) {
  if (typeof value?.conversationId !== 'string' || !ID.test(value.conversationId)
    || value?.turnId != null && (typeof value.turnId !== 'string' || value.turnId && !ID.test(value.turnId))) {
    throw new Error('Invalid Matter conversation target')
  }
  return { conversationId: value.conversationId, turnId: value.turnId || '' }
}

function normalizeTask(value) {
  const status = ['running', 'waiting', 'pending'].includes(value?.status) ? value.status : ''
  const text = (key) => typeof value?.[key] === 'string' ? value[key].slice(0, 200) : ''
  return { active: !!value?.active && !!status, status, text: text('text'), detail: text('detail'),
    conversationId: text('conversationId'), turnId: text('turnId'),
    ...(ID.test(value?.contextId || '') ? {contextId:value.contextId} : {}) }
}

function normalizeMatterOutput(value) {
  const seen = new Set()
  const source = (Array.isArray(value?.tasks) ? value.tasks : [value]).slice(0, 200)
  const tasks = source
    .map(normalizeTask).filter(task => {
      if (!task.active || seen.has(task.conversationId)) return false
      seen.add(task.conversationId)
      return true
    })
  const primary = normalizeTask(value)
  // Keep queued QA actionable within the existing 1Mi-character public frame.
  // Oversized questions retain their normal summary/open-in-Matter shortcut.
  let questionBudget = 262144
  for (const task of tasks) {
    const raw = source.find(candidate => candidate?.active && candidate.status === task.status
      && candidate.conversationId === task.conversationId)
    const qa = qaContract.project(raw?.qa ?? (primary.conversationId === task.conversationId ? value?.qa : null))
    if (!qa) continue
    const size = JSON.stringify(qa).length
    if (size > questionBudget) continue
    task.qa = qa
    questionBudget -= size
  }
  let activity = { kind: tasks.some(task => task.status === 'running') ? 'work' : tasks.length ? 'ask' : 'idle' }
  const cue = value?.activity
  if (!tasks.length && ['success', 'error'].includes(cue?.kind) && typeof cue.id === 'string'
    && ID.test(cue.id) && Number.isFinite(cue.expiresAt) && cue.expiresAt > Date.now()) {
    activity = { kind: cue.kind, id: cue.id, expiresAt: Math.min(cue.expiresAt, Date.now() + 10000) }
  }
  const notificationCount = Number.isSafeInteger(value?.notificationCount)
    ? Math.min(99999, Math.max(0, value.notificationCount)) : 0
  return { ...(tasks.find(task => task.conversationId === primary.conversationId) ?? tasks[0] ?? normalizeTask(null)),
    tasks, activity, notificationCount }
}

async function qaBody(request, action) {
  let size = 0
  const chunks = []
  for await (const chunk of request) {
    size += chunk.length
    if (size > 524288) throw new Error('QA request too large')
    chunks.push(chunk)
  }
  const value = JSON.parse(Buffer.concat(chunks).toString('utf8'))
  return action.startsWith('chat-') ? qaContract.chatTarget(value,action.slice(5))
    : qaContract.target(value, action === 'qa-answer' ? 'answer' : 'upload')
}

// The pet is a separate Electron process. Keep explicit shortcuts out of the Web renderer.
function createMatterActionBridge(onAction) {
  const token = randomBytes(32).toString('hex')
  const streams = new Set()
  let output = normalizeMatterOutput(null)
  const server = createServer(async (request, response) => {
    if (request.headers.origin || request.headers.authorization !== `Bearer ${token}`) {
      response.writeHead(403).end()
      return
    }
    if (request.method === 'GET' && request.url === '/task-output') {
      response.writeHead(200, { 'content-type': 'application/x-ndjson', 'cache-control': 'no-store' })
      response.write(JSON.stringify(output) + '\n')
      streams.add(response)
      response.on('close', () => streams.delete(response))
      return
    }
    if (request.method !== 'POST') { response.writeHead(403).end(); return }
    let url
    try { url = new URL(request.url, 'http://bridge') }
    catch { response.writeHead(400).end(); return }
    const parts = url.pathname.slice(1).split('/')
    const action = parts[0]
    if (!ACTIONS.has(action)) { response.writeHead(404).end(); return }
    let target
    try {
      if (action === 'open-conversation' && parts.length === 2) {
        target = conversationTarget({ conversationId: parts[1], turnId: url.searchParams.get('turn') })
      } else if ((action.startsWith('qa-') || action.startsWith('chat-')) && parts.length === 1) {
        target = await qaBody(request, action)
      } else if (parts.length !== 1 || action === 'open-conversation') throw new Error('Invalid action')
    } catch { response.writeHead(400).end(); return }
    try {
      const result = await onAction(action, target)
      if ((action.startsWith('qa-') || action.startsWith('chat-'))) response.writeHead(200, { 'content-type':'application/json' }).end(JSON.stringify(result))
      else response.writeHead(204).end()
    } catch (error) {
      if ((action.startsWith('qa-') || action.startsWith('chat-'))) response.writeHead(409, { 'content-type':'application/json' })
        .end(JSON.stringify({ ok:false, message:String(error.message).slice(0, 300) }))
      else { console.error('Failed to activate Matter from the pet:', error); response.writeHead(500).end() }
    }
  })
  server.requestTimeout = 5000
  let ready
  return {
    setOutput(value) {
      const next = normalizeMatterOutput(value)
      if (JSON.stringify(next) === JSON.stringify(output)) return
      output = next
      for (const stream of streams) {
        // Do not accumulate an unbounded queue for a stalled child.
        if (!stream.write(JSON.stringify(output) + '\n')) stream.destroy()
      }
    },
    start() {
      if (!ready) ready = (async () => {
        server.listen(0, '127.0.0.1')
        await once(server, 'listening')
        server.unref()
        return {
          MINDUCK_COMPANION_ACTION_ORIGIN: `http://127.0.0.1:${server.address().port}`,
          MINDUCK_COMPANION_ACTION_TOKEN: token,
        }
      })()
      return ready
    },
    async stop() {
      for (const stream of streams) stream.end()
      if (!server.listening) return
      await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
    },
  }
}

function watchMatterOutput(onOutput, environment = process.env) {
  const origin = loopbackOrigin(environment.MINDUCK_COMPANION_ACTION_ORIGIN)
  const token = environment.MINDUCK_COMPANION_ACTION_TOKEN
  if (!origin || !token) return () => {}
  const controller = new AbortController()
  let timer
  async function connect() {
    try {
      const response = await fetch(`${origin}/task-output`, {
        headers: { authorization: `Bearer ${token}` }, signal: controller.signal,
      })
      if (!response.ok) throw new Error('Matter output bridge unavailable')
      const decoder = new TextDecoder()
      let pending = ''
      for await (const chunk of response.body) {
        pending += decoder.decode(chunk, { stream: true })
        let end
        while ((end = pending.indexOf('\n')) >= 0) {
          if (end > 1048576) throw new Error('Invalid Matter output frame')
          const line = pending.slice(0, end)
          pending = pending.slice(end + 1)
          onOutput(normalizeMatterOutput(JSON.parse(line)))
        }
        if (pending.length > 1048576) throw new Error('Invalid Matter output frame')
      }
    } catch { /* Parent shutdown and reconnect never expose credentials to logs. */ }
    onOutput(normalizeMatterOutput(null))
    if (!controller.signal.aborted) timer = setTimeout(connect, 1000)
  }
  void connect()
  return () => { clearTimeout(timer); controller.abort() }
}

async function sendMatterAction(action, environment = process.env, value) {
  if (!ACTIONS.has(action)) throw new Error('Unsupported Matter action')
  const qa = (action.startsWith('qa-') || action.startsWith('chat-'))
  const target = action === 'open-conversation' ? conversationTarget(value)
    : action.startsWith('chat-') ? qaContract.chatTarget(value,action.slice(5))
    : qa ? qaContract.target(value, action === 'qa-answer' ? 'answer' : 'upload') : null
  const origin = loopbackOrigin(environment.MINDUCK_COMPANION_ACTION_ORIGIN)
  const token = environment.MINDUCK_COMPANION_ACTION_TOKEN
  if (!origin || !token) throw new Error('Matter action bridge is unavailable')
  const route = action === 'open-conversation' ? `/open-conversation/${target.conversationId}?turn=${target.turnId}` : `/${action}`
  const response = await fetch(`${origin}${route}`, {
    method: 'POST', headers: { authorization: `Bearer ${token}`, ...(qa ? { 'content-type':'application/json' } : {}) },
    ...(qa ? { body:JSON.stringify(target) } : {}), signal:AbortSignal.timeout(qa ? 300000 : 15000),
  })
  if (qa) {
    const result = await response.json()
    if (!response.ok) throw new Error(result.message || 'QA 操作未完成')
    return result
  }
  if (!response.ok) throw new Error(`Matter action failed (${response.status})`)
}

// Only public DOM anchors in the bundled frontend are used; no shared Web change is required.
function focusMatterTurn(conversationId, turnId) {
  return new Promise(resolve => {
    let observer, timer
    const finish = result => { observer?.disconnect(); clearTimeout(timer); resolve(result) }
    const find = () => {
      if (location.pathname !== `/c/${conversationId}`) { finish(false); return true }
      const turn = [...document.querySelectorAll('[data-turn-id]')].find(el => el.dataset.turnId === turnId)
      if (!turn) return false
      turn.scrollIntoView({ block: 'end' })
      turn.closest('.tr')?.dispatchEvent(new Event('scroll'))
      finish(true)
      return true
    }
    if (find()) return
    observer = new MutationObserver(find)
    observer.observe(document.body, { childList: true, subtree: true })
    timer = setTimeout(() => finish(false), 10000)
  })
}

async function activateMatterWindow({ app, window, contents, origin }, action, value) {
  if (!ACTIONS.has(action) || (action.startsWith('qa-') || action.startsWith('chat-'))) throw new Error('Unsupported Matter action')
  const target = action === 'open-conversation' ? conversationTarget(value) : null
  if (window.isMinimized()) window.restore()
  window.show()
  if (process.platform === 'darwin') app.focus({ steal: true })
  window.focus()
  contents.focus()
  if (action === 'new-chat') await contents.loadURL(new URL('/new-chat', origin).href)
  if (target) {
    const destination = new URL(`/c/${target.conversationId}`, origin).href
    if (contents.getURL().split(/[?#]/u)[0] !== destination) await contents.loadURL(destination)
    if (target.turnId) await contents.executeJavaScriptInIsolatedWorld(1002, [{
      code: `(${focusMatterTurn.toString()})(${JSON.stringify(target.conversationId)},${JSON.stringify(target.turnId)})`,
    }])
  }
}

module.exports = { createMatterActionBridge, sendMatterAction, activateMatterWindow,
  normalizeMatterOutput, watchMatterOutput, conversationTarget }
