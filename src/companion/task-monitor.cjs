// Runs only in Matter's isolated renderer world. Business credentials never leave this world.
// Do not fetch conversation detail here: that endpoint marks the conversation as read.
function installMatterTaskMonitor(qaContract = null) {
  let identity = '', session = null, stopped = false
  const empty = () => ({ active: false, status: '', text: '', detail: '', conversationId: '',
    tasks: [], activity: { kind: 'idle' }, notificationCount: 0 })
  const plain = (value) => String(value ?? '').replace(/<[^>]*>/gu, '')
    .replace(/!\[[^\]]*\]\([^)]*\)/gu, '').replace(/\[([^\]]+)\]\([^)]*\)/gu, '$1')
    .replace(/[`#*_~]/gu, '').replace(/\s+/gu, ' ').trim().slice(0, 300)
  const statusOf = (row) => row.turn_status || ({ run: 'running', wait: 'waiting' }[row.dot] ?? '')

  function invalidate(state) { state.refreshAt = 0; state.revision++ }

  function subscribe(state, path, names, receive, projection) {
    const replay = !!projection
    let source, timer, closed = false, sequence = -1, attempt = 0
    function connect() {
      if (closed) return
      const query = new URLSearchParams({ access_token: state.token })
      if (state.org) query.set('org_id', state.org)
      if (replay) query.set('from_seq', String(Math.max(0, sequence)))
      source = new EventSource(`${path}?${query}`)
      source.onopen = () => { attempt = 0; invalidate(state) }
      for (const name of names) source.addEventListener(name, (event) => {
        if (session !== state || closed) return
        const seq = Number(event.lastEventId)
        if (seq > 0) {
          if (sequence >= 0 && seq !== sequence + 1) {
            invalidate(state)
            if (projection) { projection.items.clear(); projection.turns.clear() }
          }
          sequence = seq
        }
        try { receive(name, JSON.parse(event.data)) } catch { /* Ignore malformed frames. */ }
      })
      source.onerror = () => {
        source.close()
        invalidate(state)
        if (projection) { projection.items.clear(); projection.turns.clear() }
        if (!closed) timer = setTimeout(connect, Math.min(15000, 1000 * 2 ** attempt++))
      }
    }
    connect()
    return () => { closed = true; clearTimeout(timer); source?.close() }
  }

  function rememberItem(state, item) {
    if (!item?.id || !item.turn_id || !['capsule', 'narrative', 'qa'].includes(item.kind)) return
    if (item.conversation_id && item.conversation_id !== state.row?.id) return
    const payload = item.payload ?? {}
    let view
    if (item.kind === 'capsule') {
      const children = Array.isArray(payload.children) ? payload.children : []
      const tool = children.filter(child => child.type === 'tool' && child.state === 'run').at(-1)
      view = { summary: plain((payload.summary ?? []).filter(seg => !seg.dim).map(seg => seg.t).join('')),
        tool: plain(tool?.label), active: !!tool || payload.glyph === 'spin' && !children.some(c => c.type === 'tool') }
    } else if (item.kind === 'narrative') {
      view = { text: plain(String(payload.md ?? '').split(/\n+/u).filter(line => line.trim()).at(-1)) }
    } else {
      view = { pending: payload.state === 'pending', question: plain(payload.spec?.q),
        authorization: !!payload.spec?.await_kind, approval: !!payload.spec?.approval,
        files: Number(payload.spec?.min_attachments) > 0 || payload.spec?.input_mode === 'files',
        qa: qaContract?.project({ contextId:state.contextId, itemId:item.id, interruptId:payload.interrupt_id,
          spec:payload.spec, reviewInApp:!!payload.template_review || !!payload.question_documents?.length
            || !!payload.spec?.await_kind }) }
    }
    state.items.set(item.id, { id: item.id, turn: item.turn_id, seq: Number(item.seq) || 0, kind: item.kind, ...view })
    // Keep only a bounded public display projection, never tool arguments or configuration cards.
    if (state.items.size > 100) {
      const oldest = [...state.items.values()].sort((a, b) => a.seq - b.seq)[0]
      state.items.delete(oldest.id)
    }
  }

  function receiveTask(state, name, data) {
    if (name === 'item.appended' || name === 'item.updated') rememberItem(state, data)
    else if (name === 'turn.created' && data?.id) {
      // A replayed creation frame still says running. Preserve subsequent status frames.
      state.turns.set(data.id, { ...data, ...state.turns.get(data.id), seq: Number(data.seq) || 0 })
    } else if (name === 'turn.status' && data?.turn_id) {
      state.turns.set(data.turn_id, { ...state.turns.get(data.turn_id), ...data, id: data.turn_id })
    } else if (name === 'qa.resolved') {
      for (const item of state.items.values()) if (item.kind === 'qa'
        && (item.id === data?.item_id || item.qa?.interruptId === data?.interrupt_id)) item.pending = false
    }
  }

  function selectTasks(state, rows) {
    // Match the sidebar's durable unread/wait/risk signals, counting a conversation only once.
    state.notificationCount = new Set(rows.filter(row => row.id && !row.archived
      && (row.unread === true || Number(row.unread) > 0 || ['wait', 'risk'].includes(row.dot)
        || ['waiting', 'pending', 'failed', 'stopped'].includes(statusOf(row))))
      .map(row => row.id)).size
    const active = rows.filter(row => row.id && ['running', 'waiting', 'pending'].includes(statusOf(row))).slice(0, 200)
    // Only observed active → settled transitions are cues; historical results never animate on login.
    if (!state.tasks.size && active.length) state.result = null
    const byId = new Map(rows.map(row => [row.id, row]))
    for (const id of state.tasks.keys()) {
      const status = statusOf(byId.get(id) ?? {})
      if (status === 'failed' || status === 'stopped') state.result = 'error'
      else if (status === 'done' && !state.result) state.result = 'success'
    }
    if (active.length) state.cue = null
    else if (state.result) {
      state.cue = { kind: state.result, id: `${Date.now()}-${++state.cueSequence}`, expiresAt: Date.now() + 10000 }
      state.result = null
    }
    const ids = new Set(active.map(row => row.id))
    for (const [id, task] of state.tasks) if (!ids.has(id)) { task.close?.(); state.tasks.delete(id) }
    const pendingItems = new Set([...state.tasks.values()].flatMap(task =>
      [...task.items.values()].filter(item => item.pending).map(item => item.id)))
    for (const [id, owner] of state.uploaded) {
      const chatOwner = owner === 'chat:'+state.contextId
        || active.some(row => owner.startsWith('task:'+row.id+':'))
      if (!pendingItems.has(owner) && !chatOwner) state.uploaded.delete(id)
    }
    for (const row of active) {
      if (!state.tasks.has(row.id)) state.tasks.set(row.id, { row, items: new Map(), turns: new Map(), contextId:state.contextId })
      state.tasks.get(row.id).row = row
    }
    syncStreams(state)
  }

  // Leave HTTP/1 connection slots for Matter itself and list reconciliation. With more than two
  // active conversations, rotate replayable streams; keep every task's last public projection.
  function syncStreams(state) {
    const tasks = [...state.tasks.values()]
    if (tasks.length > 2 && Date.now() >= state.rotateAt) {
      for (const task of tasks) { task.close?.(); task.close = null }
      state.cursor = (state.cursor + 2) % tasks.length
      state.rotateAt = Date.now() + 5000
    }
    const selected = new Set(Array.from({ length: Math.min(2, tasks.length) },
      (_, i) => tasks[(state.cursor + i) % tasks.length]))
    for (const task of tasks) {
      if (!selected.has(task)) { task.close?.(); task.close = null; continue }
      if (!task.close) task.close = subscribe(state, `/api/conversations/${encodeURIComponent(task.row.id)}/events`,
        ['turn.created', 'turn.status', 'item.appended', 'item.updated', 'qa.raised', 'qa.resolved',
          'run.workspace', 'conversation.updated', 'queue.updated'],
        (name, data) => { receiveTask(task, name, data); if (!name.startsWith('item.')) invalidate(state) }, task)
    }
  }

  async function refresh(state) {
    if (state.busy || state.blocked) return
    state.busy = true
    const revision = state.revision
    state.refreshAt = Date.now() + 15000
    try {
      const headers = { Authorization: `Bearer ${state.token}` }
      if (state.org) headers['X-Org-ID'] = state.org
      const response = await fetch('/api/conversations', { headers, cache: 'no-store',
        signal: AbortSignal.any([state.abort.signal, AbortSignal.timeout(10000)]) })
      if (session !== state) return
      if (response.status === 401 || response.status === 403) {
        state.blocked = true
        state.closeGlobal(); for (const task of state.tasks.values()) task.close?.()
      }
      if (!response.ok) throw new Error('Task list unavailable')
      const body = await response.json()
      if (session !== state) return
      if (!Array.isArray(body.conversations)) throw new Error('Invalid task list')
      selectTasks(state, body.conversations)
      state.ready = true
    } catch {
      state.ready = false
      state.refreshAt = Date.now() + 3000
    } finally {
      state.busy = false
      if (state.revision !== revision) state.refreshAt = 0
    }
  }

  function display(state, includeQuestion = false) {
    const row = state.row
    if (!row) return empty()
    const status = statusOf(row)
    const activeTurns = [...state.turns.values()].filter(turn => turn.status === status)
      .sort((a, b) => (b.seq ?? 0) - (a.seq ?? 0))
    const items = [...state.items.values()].sort((a, b) => b.seq - a.seq)
    const turn = activeTurns[0]
    const turnID = turn?.id ?? items[0]?.turn
    const current = items.filter(item => item.turn === turnID)
    const result = { active: true, status, conversationId: row.id, turnId: turnID ?? '',
      contextId:state.contextId, text: '', detail: plain(row.title) }
    const question = current.find(item => item.kind === 'qa' && item.pending)
    if (includeQuestion && question?.qa) result.qa = question.qa
    if (status === 'waiting' || status === 'pending') {
      const qa = current.find(item => item.kind === 'qa' && item.pending)
      result.text = qa?.authorization ? '等你完成授权' : qa?.files || turn?.meta?.awaiting_user_input === 'true'
        ? '等你补充资料' : qa?.approval ? '等你确认操作' : qa ? '等你回答' : '等你确认或补充'
      result.detail = qa?.question || result.detail
    } else {
      const latest = current.find(item => item.kind !== 'qa')
      const narrative = current.find(item => item.kind === 'narrative' && item.text)
      if (latest?.kind === 'capsule' && latest.active) {
        result.text = latest.summary || '处理中'
        result.detail = latest.tool || narrative?.text || result.detail
      } else {
        result.text = narrative ? '正在回复' : '处理中'
        result.detail = narrative?.text || result.detail
      }
    }
    return result
  }

  function clear() {
    session?.abort.abort()
    session?.closeGlobal?.()
    if (session) for (const task of session.tasks.values()) task.close?.()
    session = null
  }

  function checkSession(target, expected = session) {
    let currentIdentity
    try { currentIdentity = JSON.stringify([localStorage.getItem('matter.token') ?? '', localStorage.getItem('matter.org') ?? '']) }
    catch { currentIdentity = '' }
    if (!session?.ready || session !== expected || session.blocked || currentIdentity !== identity
      || target.contextId !== session.contextId) {
      throw new Error('会话已切换，请等待消息刷新')
    }
  }

  function questionFor(target) {
    checkSession(target)
    const task = session.tasks.get(target.conversationId)
    const item = task?.items.get(target.itemId)
    if (!item?.pending || item.turn !== target.turnId || item.qa?.interruptId !== target.interruptId) {
      throw new Error('这条问题已处理或已更新，请等待消息刷新')
    }
    return { state:session, item }
  }

  async function qaRequest(state, path, body) {
    const headers = { Authorization:`Bearer ${state.token}` }
    if (state.org) headers['X-Org-ID'] = state.org
    const multipart = body instanceof FormData
    if (!multipart) headers['Content-Type'] = 'application/json'
    const response = await fetch(path, { method:'POST', headers, body:multipart ? body : JSON.stringify(body),
      signal:AbortSignal.any([state.abort.signal, AbortSignal.timeout(60000)]) })
    const result = await response.json().catch(() => ({}))
    if (!response.ok || result.ok === false) throw new Error(plain(result.message || result.error) || `操作未完成（${response.status}）`)
    return result
  }

  async function uploadFiles(state, files, owner, check) {
    const attachments = []
    if (files.length > 20) throw new Error('一次最多上传 20 个文件')
    for (const file of files) {
      check()
      const bytes = Uint8Array.from(atob(file.base64), char => char.charCodeAt(0))
      const form = new FormData()
      form.append('file', new Blob([bytes], { type:file.type || 'application/octet-stream' }), file.name)
      const result = await qaRequest(state, '/api/attachments', form)
      check()
      if (!result.attachment?.id) throw new Error('附件上传未完成，请重试')
      state.uploaded.set(result.attachment.id, owner)
      attachments.push({ id:result.attachment.id, name:plain(result.attachment.name || file.name) })
    }
    return { ok:true, attachments }
  }

  async function chat(command, value, files) {
    if (command === 'context') {
      checkSession({contextId:session?.contextId})
      return { ok:true, contextId:session.contextId }
    }
    const target = qaContract.chatTarget(value,command === 'check' ? 'upload' : command), state = session
    checkSession(target,state)
    const check = () => {
      checkSession(target,state)
      if (!target.conversationId) return
      const task = state.tasks.get(target.conversationId)
      if (!task || statusOf(task.row) !== 'running' || display(task).turnId !== target.turnId
        || task.turns.get(target.turnId)?.status && task.turns.get(target.turnId).status !== 'running') {
        throw new Error('任务已结束或已更新，请等待消息刷新')
      }
    }
    check()
    if (command === 'check') return {ok:true}
    const owner = target.conversationId ? `task:${target.conversationId}:${target.turnId}` : 'chat:'+state.contextId
    if (state.chatBusy.has(owner)) throw new Error('操作正在提交，请稍候')
    state.chatBusy.add(owner)
    try {
      if (command === 'upload') return await uploadFiles(state,files,owner,check)
      if (command === 'stop') {
        const result = await qaRequest(state,`/api/conversations/${encodeURIComponent(target.conversationId)}/stop`)
        checkSession(target,state)
        invalidate(state)
        if (result.stopped !== true) throw new Error('当前没有可终止的执行，请等待消息刷新')
        return {ok:true,stopped:true}
      }
      if (target.attachmentIds.some(id => state.uploaded.get(id) !== owner)) throw new Error('附件已失效，请重新上传')
      const attachments = target.attachmentIds.length ? {attachment_ids:target.attachmentIds} : {}
      const result = command === 'queue'
        ? await qaRequest(state,`/api/conversations/${encodeURIComponent(target.conversationId)}/messages`,{text:target.text,...attachments})
        : await qaRequest(state,'/api/conversations',{ scope:'platform', text:target.text,
          tz:Intl.DateTimeFormat().resolvedOptions().timeZone,...attachments })
      checkSession(target,state)
      if (command === 'queue' ? result.queued !== true && !result.turn?.id && result.resolved !== true
        : !/^[a-zA-Z0-9_-]{1,200}$/u.test(result.conversation?.id || '')) throw new Error('消息提交未确认，请检查 Matter')
      for (const id of target.attachmentIds) state.uploaded.delete(id)
      invalidate(state)
      return { ok:true, conversationId:target.conversationId || result.conversation.id,
        ...(command === 'queue' ? {queued:result.queued === true} : {}) }
    } finally { state.chatBusy.delete(owner) }
  }

  async function act(command, value, files = []) {
    if (!qaContract) throw new Error('QA 尚未就绪')
    if (command.startsWith('chat-')) return chat(command.slice(5),value,files)
    const target = qaContract.target(value, command === 'answer' ? 'answer' : 'upload')
    const { state, item } = questionFor(target)
    if (command === 'check') return { ok:true }
    if (!['answer', 'upload'].includes(command) || state.qaBusy.has(item.id)) throw new Error('操作正在提交，请稍候')
    state.qaBusy.add(item.id)
    try {
      if (command === 'upload') {
        return await uploadFiles(state,files,item.id,() => questionFor(target))
      }
      const uploaded = new Set([...state.uploaded].filter(([, owner]) => owner === item.id).map(([id]) => id))
      const body = qaContract.validateAnswer(item.qa, target, uploaded)
      const result = await qaRequest(state, `/api/interrupts/${encodeURIComponent(target.interruptId)}/resolve`, body)
      // SSE may resolve/remove this item before its HTTP response. Only reject a changed login/org,
      // not a successful submission whose pending card has already disappeared.
      checkSession(target, state)
      const resolved = result.resolved === true || ['answered', 'skipped'].includes(result.qa?.state ?? result.item?.payload?.state)
      if (resolved) {
        item.pending = false
        for (const [id, owner] of state.uploaded) if (owner === item.id) state.uploaded.delete(id)
      }
      invalidate(state)
      return { ok:true, resolved, message:resolved ? '已发送' : '已提交，等待 Matter 更新' }
    } finally { state.qaBusy.delete(item.id) }
  }

  return {
    tick() {
      if (stopped) return empty()
      let token, org
      try { token = localStorage.getItem('matter.token') ?? ''; org = localStorage.getItem('matter.org') ?? '' }
      catch { token = ''; org = '' }
      const next = JSON.stringify([token, org])
      if (identity !== next) {
        clear(); identity = next
        if (token) {
          const state = session = { token, org, abort: new AbortController(), tasks: new Map(),
            contextId:`${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`,
            uploaded:new Map(), qaBusy:new Set(), chatBusy:new Set(),
            cursor: 0, rotateAt: Date.now() + 5000, ready: false, busy: false,
            revision: 0, refreshAt: 0, blocked: false, result: null, cue: null, cueSequence: 0 }
          state.closeGlobal = subscribe(state, '/api/events', ['notice', 'sidebar.updated'], () => invalidate(state))
        }
      }
      if (!session || session.blocked) return empty()
      if (Date.now() >= session.refreshAt) void refresh(session)
      syncStreams(session)
      if (!session.ready) return empty()
      const tasks = [...session.tasks.values()].sort((a, b) =>
        Number(statusOf(b.row) === 'running') - Number(statusOf(a.row) === 'running')
        || String(b.row.last_activity_at ?? '').localeCompare(String(a.row.last_activity_at ?? '')))
        .map(task => display(task, true))
      const activity = tasks.some(task => task.status === 'running') ? { kind: 'work' }
        : tasks.length ? { kind: 'ask' }
          : session.cue?.expiresAt > Date.now() ? session.cue : { kind: 'idle' }
      return { ...(tasks[0] ?? empty()), tasks, activity, notificationCount: session.notificationCount }
    },
    act,
    stop() { stopped = true; clear() },
  }
}

module.exports = { installMatterTaskMonitor }
