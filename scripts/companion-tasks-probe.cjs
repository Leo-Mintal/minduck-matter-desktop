// Real authenticated API fixture → isolated Matter monitor → native child → real pet page.
const assert = require('node:assert/strict')
const http = require('node:http')
const path = require('node:path')
const { BrowserWindow } = require('electron')
const { DevToolsClient, devToolsPort } = require('./devtools-test-client.cjs')
const { createMatterTaskBridge } = require('../src/companion/task-bridge.cjs')

module.exports = async function probeTasks({ companion, data, state, waitFor }) {
  const streams = new Set(), requests = [], replay = []
  let rows = [], itemSequence = 0, window, client, bridge, lastOutput
  const sequence = {}
  const emit = (name, value, channel = 'task', conversation = 'conv-one') => {
    const key = channel === 'task' ? conversation : 'global'
    sequence[key] = (sequence[key] ?? 0) + 1
    const frame = `id: ${sequence[key]}\nevent: ${name}\ndata: ${JSON.stringify(value)}\n\n`
    if (channel === 'task') replay.push({ frame, conversation })
    for (const stream of streams) if (stream.channel === channel
      && (channel === 'global' || stream.conversation === conversation)) stream.response.write(frame)
  }
  const row = (status, id = 'conv-one', title = '桌宠状态测试') => ({
    id, title, turn_status: status, last_activity_at: new Date().toISOString(), dot: '',
  })
  const item = (id, kind, payload, turn = 'turn-one') => ({
    id, turn_id: turn, conversation_id: 'conv-one', seq: ++itemSequence, kind, payload,
  })
  const setStatus = (status) => {
    rows = [row(status)]
    emit('turn.status', { turn_id: 'turn-one', status })
    emit('sidebar.updated', { conversation_id: 'conv-one' }, 'global')
  }
  const server = http.createServer((request, response) => {
    const url = new URL(request.url, 'http://fixture')
    if (!url.pathname.startsWith('/api/')) {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      response.end('<title>Matter task fixture</title><body>Read-only task bridge</body>')
      return
    }
    const org = request.headers['x-org-id'] ?? url.searchParams.get('org_id')
    assert.equal(request.headers.authorization ?? `Bearer ${url.searchParams.get('access_token')}`, 'Bearer fixture-session')
    requests.push({ path: url.pathname, org })
    if (url.pathname === '/api/conversations') {
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ conversations: org === 'org-two' ? [] : rows }))
    } else if (url.pathname.endsWith('/events')) {
      response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' })
      response.flushHeaders()
      const channel = url.pathname === '/api/events' ? 'global' : 'task'
      const conversation = url.pathname.split('/')[3]
      const stream = { channel, response, conversation }
      streams.add(stream)
      response.on('close', () => streams.delete(stream))
      if (channel === 'task') replay.filter(record => record.conversation === conversation)
        .forEach(record => response.write(record.frame))
    } else {
      response.writeHead(400).end('Unexpected endpoint: the monitor must not mark conversations read')
    }
  })
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
    const origin = `http://127.0.0.1:${server.address().port}`
    window = new BrowserWindow({ show: false, webPreferences: {
      contextIsolation: true, sandbox: true, backgroundThrottling: false,
    } })
    const contents = window.webContents
    bridge = createMatterTaskBridge({ contents, origin, onOutput: output => {
      lastOutput = output
      companion.setTaskOutput(output)
    } })
    await contents.loadURL(origin + '/c/conv-one')
    const port = await devToolsPort(path.join(data, 'pet-window'))
    const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
    const target = targets.find(page => page.type === 'page' && page.url.split('#')[0] === state.url)
    assert.ok(target, 'real pet target')
    client = new DevToolsClient(target.webSocketDebuggerUrl)
    const evaluate = async (expression) => {
      const result = await client.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
      assert.ok(!result.exceptionDetails, result.exceptionDetails?.text)
      return result.result.value
    }
    const panel = () => evaluate(`(() => {
      const p = document.querySelector('.minduck-output');
      return p && { hidden:p.hidden, rows:[...p.querySelectorAll('.minduck-output-line')].map(line => line.textContent) };
    })()`)
    const expectText = async (text) => waitFor(panel,
      value => value && !value.hidden && value.rows[0] === text, 'pet displays ' + text)
    const expectHidden = () => waitFor(panel, value => value?.hidden, 'idle pet output hidden')
    const expectNotifications = count => waitFor(() => evaluate(`(() => {
      const badge=document.querySelector('.minduck-notification-badge');
      return badge && { hidden:badge.hidden, text:badge.textContent };
    })()`), value => value?.hidden === !count && value.text === (count ? String(count) : ''),
    'real task notifications: ' + count)
    await evaluate(`window.taskActivityProbe = { latest: null, frames: [] };
      addEventListener('message', e => {
        if (e.data?.t === 'frame') {
          taskActivityProbe.latest = e.data.layout;
          taskActivityProbe.frames.push(e.data.layout);
          if (taskActivityProbe.frames.length > 1200) taskActivityProbe.frames.shift();
        }
      });`)
    const expectActivity = kind => waitFor(() => evaluate('taskActivityProbe.latest'),
      layout => kind === 'idle' ? layout?.matterActivity === null
        : layout?.matterActivity === kind && (kind === 'work' ? layout.work : kind === 'ask' ? layout.ask
          : layout.expression === (kind === 'success' ? 'happy' : 'sad')), 'actual sandbox activity ' + kind)

    await expectHidden()
    await expectNotifications(0)
    assert.equal(requests.length, 0, 'logged-out view does not make task requests')
    rows = [row('running')]
    emit('turn.created', { id: 'turn-one', seq: 1, status: 'running' })
    emit('item.appended', item('thinking', 'capsule', { glyph: 'spin', summary: [{ t: '思考中' }], children: [] }))
    await contents.executeJavaScript(`localStorage.setItem('matter.token', 'fixture-session'); localStorage.setItem('matter.org', 'org-one')`)
    await expectText('思考中')
    await expectActivity('work')
    assert.equal(await evaluate(`document.querySelector('.minduck-output').dataset.turnId`), 'turn-one',
      'the current turn anchor reaches its own clickable native capsule')
    assert.equal(await contents.executeJavaScript('typeof __minduckTaskMonitor'), 'undefined', 'monitor is isolated from Matter scripts')
    emit('item.appended', item('search', 'capsule', { glyph: 'spin', summary: [{ t: '联网检索' }],
      children: [{ type: 'tool', state: 'run', label: '查找桌宠交互资料' }] }))
    await expectText('联网检索')
    emit('item.updated', item('search', 'capsule', { glyph: 'spin', summary: [{ t: '联网检索' }],
      children: [{ type: 'tool', label: '查找桌宠交互资料', res: '完成' }] }))
    await expectText('处理中')
    emit('item.appended', item('reply', 'narrative', { md: '**正在核对任务输出**' }))
    await expectText('正在回复')
    assert.equal((await panel()).rows[1], '正在核对任务输出')

    emit('item.appended', item('qa', 'qa', { state: 'pending', spec: { q: '是否继续执行？', approval: true } }))
    setStatus('waiting')
    await expectText('等你确认操作')
    await expectActivity('ask')
    await expectNotifications(1)
    emit('turn.created', { id: 'turn-one', seq: 1, status: 'running' })
    await contents.executeJavaScript(`history.pushState({}, '', '/new-chat')`)
    await new Promise(resolve => setTimeout(resolve, 800))
    assert.equal((await panel()).rows[0], '等你确认操作', 'SPA navigation and replayed creation do not resume a waiting turn')
    await contents.loadURL(origin + '/new-chat')
    await expectText('等你确认操作')
    emit('item.updated', item('qa', 'qa', { state: 'pending', spec: { q: '请完成授权', await_kind: 'mcp_auth' } }))
    await expectText('等你完成授权')
    emit('item.updated', item('qa', 'qa', { state: 'pending', spec: { q: '请上传资料', min_attachments: 1 } }))
    await expectText('等你补充资料')
    setStatus('running')
    await expectText('正在回复')
    await expectNotifications(0)
    emit('turn.created', { id: 'supplement', seq: 2, status: 'done' })
    emit('item.appended', item('supplement', 'narrative', { md: '补充指令已入册' }, 'supplement'))
    await new Promise(resolve => setTimeout(resolve, 800))
    assert.equal((await panel()).rows[1], '正在核对任务输出', 'a newer settled supplement cannot replace the active turn output')
    setStatus('pending')
    await expectText('等你补充资料')
    await expectActivity('ask')
    for (const status of ['done', 'failed', 'stopped']) {
      setStatus('running')
      await waitFor(panel, value => value && !value.hidden, 'running is visible')
      await expectActivity('work')
      setStatus(status)
      await expectHidden()
      await expectNotifications(status === 'done' ? 0 : 1)
      await expectActivity(status === 'done' ? 'success' : 'error')
      await expectActivity('idle')
    }

    rows = [row('waiting')]
    emit('sidebar.updated', {}, 'global')
    await waitFor(()=>evaluate(`document.querySelector('.minduck-output:not([hidden])')?.dataset.conversationId`),
      id=>id==='conv-one','establish the current waiting message before another task arrives')
    rows = [row('waiting'), row('running', 'conv-two', '另一个执行任务')]
    emit('sidebar.updated', {}, 'global')
    await waitFor(() => lastOutput?.conversationId, id => id === 'conv-two', 'running task takes priority over waiting task')
    await waitFor(() => evaluate(`document.querySelector('.minduck-output').dataset.conversationId`),
      id => id === 'conv-one', 'a newly running task queues behind the message already being read')
    await waitFor(()=>evaluate(`document.querySelectorAll('.minduck-stack-layer:not([hidden])').length`),count=>count===1,
      'the second native task exposes a downward backing card')
    rows = [row('waiting'), row('done', 'conv-two')]
    emit('turn.status', { turn_id: 'turn-one', status: 'waiting' })
    emit('sidebar.updated', {}, 'global')
    await waitFor(() => lastOutput?.conversationId, id => id === 'conv-one', 'remaining waiting task stays visible')
    await expectText('等你补充资料')

    rows = [row('waiting'), ...['two', 'three', 'four'].map(id => row('running', 'conv-' + id))]
    for (const id of ['two', 'three', 'four']) {
      emit('turn.created', { id: 'turn-' + id, seq: 1, status: 'running' }, 'task', 'conv-' + id)
      emit('item.appended', { ...item('reply-' + id, 'narrative', { md: '独立输出-' + id }, 'turn-' + id),
        conversation_id: 'conv-' + id }, 'task', 'conv-' + id)
    }
    emit('sidebar.updated', {}, 'global')
    await waitFor(() => lastOutput?.tasks?.length, count => count === 4, 'all simultaneous conversations are retained')
    await waitFor(() => lastOutput?.tasks?.map(task => task.detail),
      details => ['two', 'three', 'four'].every(id => details?.includes('独立输出-' + id)),
      'bounded replay streams receive independent output for every conversation')
    assert.ok(streams.size <= 3, 'leave HTTP/1 connections for foreground Matter and list requests')
    assert.equal(await evaluate(`document.querySelectorAll('.minduck-output:not([hidden])').length`), 1,
      'multiple native task outputs display only one capsule')
    assert.equal(await evaluate(`document.querySelector('.minduck-output').dataset.conversationId`), 'conv-one',
      'background progress leaves the current message stable')
    assert.equal(await evaluate(`Number(document.querySelector('.minduck-outputs').dataset.messageCount)`),4)
    assert.equal(await evaluate(`document.querySelectorAll('.minduck-stack-layer:not([hidden])').length`),2)
    await evaluate(`document.querySelector('.minduck-close').click();void 0`)
    await waitFor(()=>evaluate(`document.querySelector('.minduck-output').dataset.conversationId`),
      id=>['conv-two','conv-three','conv-four'].includes(id),
      'closing the current message reveals the next native conversation')
    assert.equal(await evaluate(`Number(document.querySelector('.minduck-outputs').dataset.messageCount)`),3,
      'exactly one native hint is dismissed even when server primary order changes')
    rows = rows.filter(task => task.id !== 'conv-three')
    emit('sidebar.updated', {}, 'global')
    await waitFor(() => lastOutput?.tasks?.map(task => task.conversationId),
      ids => ids?.length === 3 && !ids.includes('conv-three'), 'only the ended conversation is removed')

    rows = [{ ...row('waiting', 'conv-wait-old'), last_activity_at: '2026-11-03T01:00:00Z' },
      { ...row('pending', 'conv-pending-new'), last_activity_at: '2026-11-04T01:00:00Z' }]
    emit('sidebar.updated', {}, 'global')
    await waitFor(() => evaluate(`document.querySelector('.minduck-output').dataset.conversationId`),
      id => id === 'conv-pending-new', 'without running tasks the newest pending/waiting conversation is shown')
    assert.equal(await evaluate(`document.querySelectorAll('.minduck-output:not([hidden])').length`), 1)
    await expectText('等你确认或补充')

    rows = [{ ...row('done'), unread:true }, { ...row('waiting', 'conv-wait'), unread:true },
      row('failed', 'conv-error'), row('running', 'conv-work')]
    emit('sidebar.updated', {}, 'global')
    await expectNotifications(3)
    rows = [row('done'), row('done', 'conv-wait'), row('done', 'conv-error')]
    emit('sidebar.updated', {}, 'global')
    await expectNotifications(0)
    await expectHidden()

    setStatus('running')
    await waitFor(panel, value => value && !value.hidden, 'active before switching organization')
    await contents.executeJavaScript(`localStorage.setItem('matter.org', 'org-two')`)
    await expectHidden()
    await expectNotifications(0)
    await waitFor(() => requests.some(req => req.org === 'org-two'), Boolean, 'new organization requested')
    assert.ok(!requests.some(req => /^\/api\/conversations\/[^/]+$/u.test(req.path)), 'no mark-read detail requests')
    await contents.executeJavaScript(`localStorage.removeItem('matter.token')`)
    await expectHidden()
    await expectNotifications(0)
    await waitFor(() => streams.size, count => count === 0, 'logout closes all task streams')

    await contents.executeJavaScript(`localStorage.setItem('matter.token', 'fixture-session'); localStorage.setItem('matter.org', 'org-one')`)
    await waitFor(panel, value => value && !value.hidden, 'login resumes monitoring')
    rows = [row('done')]
    for (const stream of streams) stream.response.end()
    await expectHidden()
    await waitFor(() => streams.size, count => count > 0, 'event streams reconnect')
    assert.equal((await panel()).hidden, true, 'reconnect reconciles durable lifecycle instead of replayed running')
    console.log('PASS: real task bridge: deduplicated notification badges and clearing; stable stacked message queue and close-to-next, all-task automatic actions, auth/org isolation, bounded replay streams, waiting reasons, route/reload/background continuity, terminal states, logout and reconnect; no read side effects')
  } finally {
    bridge?.dispose()
    client?.close()
    window?.destroy()
    for (const stream of streams) stream.response.end()
    server.closeAllConnections()
    await new Promise(resolve => server.close(resolve))
  }
}
