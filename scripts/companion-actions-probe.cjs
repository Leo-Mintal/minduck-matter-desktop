// Actual pet page → isolated preload → native host → desktop bridge → native Matter window.
const assert = require('node:assert/strict')
const http = require('node:http')
const path = require('node:path')
const { app, BrowserWindow } = require('electron')
const { DevToolsClient, devToolsPort } = require('./devtools-test-client.cjs')
const { activateMatterWindow } = require('../src/companion/matter-actions.cjs')

module.exports = async function probeActions({ data, state, waitFor, setHandler }) {
  const server = http.createServer((request, response) => {
    response.setHeader('Content-Type', 'text/html; charset=utf-8')
    const id = request.url === '/c/conv-one' ? 'turn-one' : 'turn-two'
    response.end(`<title>Matter action fixture</title><body><div class="tr" style="height:180px;overflow:auto">
      <div style="height:700px"></div></div><script>setTimeout(() => {
        const turn=document.createElement('div');turn.dataset.turnId=${JSON.stringify(id)};
        turn.textContent='Current message';document.querySelector('.tr').append(turn);
      },100)</script></body>`)
  })
  let window, client
  try {
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
    const origin = `http://127.0.0.1:${server.address().port}`
    window = new BrowserWindow({ show: false, width: 500, height: 300,
      webPreferences: { contextIsolation: true, sandbox: true } })
    const contents = window.webContents
    await contents.loadURL(origin + '/c/existing')
    await contents.executeJavaScript('window.retainedState = "keep-current-page"')
    const actions = []
    setHandler(async (action, target) => {
      if(action==='chat-context')return {ok:true,contextId:'action-context'}
      await activateMatterWindow({ app, window, contents, origin }, action, target)
      actions.push(action)
    })
    const port = await devToolsPort(path.join(data, 'pet-window'))
    const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
    // The public state URL omits the native window's private authentication fragment.
    const target = targets.find((item) => item.type === 'page' && item.url.split('#')[0] === state.url)
    assert.ok(target, 'real desktop pet DevTools target')
    client = new DevToolsClient(target.webSocketDebuggerUrl)
    const evaluate = async (expression) => {
      const result = await client.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
      assert.ok(!result.exceptionDetails, result.exceptionDetails?.text)
      return result.result.value
    }
    await waitFor(() => evaluate('!!document.querySelector(".minduck-action:not([disabled])")'), Boolean, 'enabled native pet actions')
    const click = (action) => evaluate(`document.querySelector('[data-action="${action}"]').click(); true`)

    await evaluate(`import('/web/pet-app.js').then(({panels}) => panels.setNotificationCount(2))`)
    await click('open-app')
    await waitFor(() => actions.length, (count) => count === 1, 'hidden Matter window activation')
    await waitFor(() => window.isFocused(), Boolean, 'Matter is the foreground window')
    assert.ok(window.isVisible())
    assert.equal(contents.getURL(), origin + '/c/existing')
    assert.equal(await contents.executeJavaScript('window.retainedState'), 'keep-current-page')

    window.minimize()
    await waitFor(() => window.isMinimized(), Boolean, 'Matter minimized')
    await click('open-app')
    await waitFor(() => actions.length, (count) => count === 2, 'minimized Matter window activation')
    await waitFor(() => !window.isMinimized() && window.isFocused(), Boolean, 'Matter restored and focused')
    assert.equal(await contents.executeJavaScript('window.retainedState'), 'keep-current-page')

    window.hide()
    await click('new-chat')
    await waitFor(()=>evaluate(`document.querySelector('.minduck-quick').shadowRoot.querySelector('textarea')?.disabled===false`),Boolean,'inline editor ready')
    assert.equal(window.isVisible(),false,'edit opens the local composer without activating Matter')
    assert.equal(contents.getURL(),origin+'/c/existing')
    await evaluate(`document.querySelector('.minduck-quick').shadowRoot.querySelector('textarea').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));void 0`)
    await evaluate('petHost.matterAction("new-chat")')
    await waitFor(() => actions.length, (count) => count === 3, 'new chat action')
    await waitFor(() => window.isVisible() && window.isFocused(), Boolean, 'new chat brought forward')
    assert.equal(contents.getURL(), origin + '/new-chat')
    assert.equal(await evaluate('petHost.matterAction("quit")'), false, 'native host rejects unsupported commands')
    assert.deepEqual(actions, ['open-app', 'open-app', 'new-chat'])
    for (const [index, id] of ['one', 'two'].entries()) {
      await evaluate(`import('/web/pet-app.js').then(({panels}) => panels.setOutputs([
        {active:true,conversationId:'conv-${id}',turnId:'turn-${id}',text:'当前会话',detail:'当前输出'}]))`)
      window.hide()
      await evaluate(`document.querySelector('[data-conversation-id="conv-${id}"] .minduck-message').click()`)
      await waitFor(() => actions.length, count => count === 4 + index, 'conversation shortcut ' + id)
      assert.equal(contents.getURL(), origin + '/c/conv-' + id)
      assert.ok(window.isVisible() && window.isFocused(), 'conversation click brings Matter forward')
      assert.ok(await contents.executeJavaScript('document.querySelector(".tr").scrollTop > 500'),
        'current message is scrolled into view after asynchronous rendering')
    }
    await contents.executeJavaScript('window.retainedState="keep-current-turn"')
    await evaluate(`document.querySelector('[data-conversation-id="conv-two"] .minduck-message').click()`)
    await waitFor(() => actions.length, count => count === 6, 'same conversation shortcut')
    assert.equal(await contents.executeJavaScript('window.retainedState'), 'keep-current-turn')
    assert.equal(await evaluate(`petHost.matterAction('open-conversation',{conversationId:'../bad'})`), false)
    console.log('PASS: real native shortcuts activate hidden/minimized Matter, preserve pages, open new chat and route each capsule to its own conversation/message without reloading the current conversation')
  } finally {
    client?.close()
    window?.destroy()
    await new Promise((resolve) => server.close(resolve))
  }
}
