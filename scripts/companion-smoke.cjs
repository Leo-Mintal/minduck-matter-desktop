// Real Core + official pet host + sandboxed default duck + settings, using a disposable profile.
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const assert = require('node:assert/strict')

if (!process.versions.electron) {
  const { spawnSync } = require('node:child_process')
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'minduck-companion-smoke-'))
  const result = spawnSync(require('electron'), [__filename, directory], { stdio: 'inherit', timeout: 120000 })
  if (result.status !== 0) console.error('Companion diagnostic profile:', directory)
  else fs.rmSync(directory, { recursive: true, force: true })
  process.exit(result.status ?? 1)
}

const { app, BrowserWindow } = require('electron')
const { createCompanion } = require('../src/companion/index.cjs')
const temporary = process.argv[2]
app.setPath('userData', path.join(temporary, 'profile'))
let companion
let timeout
const waitFor = async (read, predicate, label) => {
  const end = Date.now() + 35000
  while (Date.now() < end) {
    const value = await read()
    if (predicate(value)) return value
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error(`Timed out: ${label}`)
}

app.whenReady().then(async () => {
  timeout = setTimeout(() => { console.error('Companion smoke deadline'); app.exit(1) }, 100000)
  try {
    const project = path.resolve(__dirname, '..')
    const runtime = path.join(project, 'vendor/coopanion/runtime')
    const data = path.join(temporary, 'companion')
    // Optional read-only fixtures are copied into this disposable profile, never edited in place.
    const fixtures = process.env.MINDUCK_COMPANION_TEST_PACKS
    if (fixtures) fs.cpSync(fixtures, path.join(data, 'home/companion/data/figures'), { recursive: true })
    let onMatterAction = () => {}
    const actionsOnly = process.env.MINDUCK_COMPANION_ACTIONS_ONLY === '1'
    const tasksOnly = process.env.MINDUCK_COMPANION_TASKS_ONLY === '1'
    const qaOnly = process.env.MINDUCK_COMPANION_QA_ONLY === '1'
    const companionOptions = { dataDir: data, onMatterAction: (action, target) => onMatterAction(action, target),
      hostCommand: [process.execPath, project, '--minduck-companion-host',
        `--companion-runtime=${runtime}`, `--companion-data=${data}`,
        ...actionsOnly || tasksOnly || qaOnly ? ['--remote-debugging-port=0'] : []] }
    companion = createCompanion(companionOptions)
    await companion.start()
    await waitFor(() => companion.status(), (state) => state.state === 'running', 'core ready')
    assert.equal(BrowserWindow.getAllWindows().length, 0, 'settings must not open automatically')
    const state = await waitFor(() => companion.panel('state'), (value) => value?.connected, 'official pet host connects')
    assert.equal(state.skin.figure, 'minduck-duck')
    assert.equal(state.window.source, 'CORTICO_DESKTOP_PET_HOST')
    if (process.env.MINDUCK_COMPANION_STARTUP_ONLY === '1') {
      const shown = value => value?.connected && value.inWindow && value.onDesktop && value.skin.figure === 'minduck-duck'
      await waitFor(() => companion.panel('state'), shown, 'fresh profile automatically shows the default duck')
      const config = JSON.parse(fs.readFileSync(path.join(data, 'home/companion/config.json'), 'utf8'))
      assert.equal(config.worlds['desktop-pet'].enabled, true)
      assert.equal(config.worlds['desktop-pet'].window.enabled, true)
      await companion.stop()
      companion = createCompanion(companionOptions)
      await companion.start()
      await waitFor(() => companion.status(), value => value.state === 'running', 'restarted core ready')
      await waitFor(() => companion.panel('state'), shown, 'default duck automatically reappears after restart')
      assert.equal(BrowserWindow.getAllWindows().length, 0, 'startup does not open settings')
      console.log('PASS: fresh profile and restart automatically show the bundled default duck without manual show or settings')
      return
    }
    if (process.env.MINDUCK_COMPANION_SUIT_POSE_ONLY === '1') {
      await require('./companion-suit-pose-probe.cjs')(state.url)
      return
    }
    if (tasksOnly) {
      await require('./companion-tasks-probe.cjs')({ companion, data, state, waitFor })
      return
    }
    if (qaOnly) {
      await require('./companion-qa-probe.cjs')({ companion, data, state, waitFor,
        setHandler: handler => { onMatterAction=handler } })
      return
    }
    if (actionsOnly) {
      await require('./companion-actions-probe.cjs')({ data, state, waitFor,
        setHandler: (handler) => { onMatterAction = handler } })
      return
    }
    if (process.env.MINDUCK_COMPANION_PANELS_ONLY === '1') {
      const figure = process.env.MINDUCK_COMPANION_PANEL_FIGURE
      if (figure) {
        const response = await fetch(new URL('/api/skin', state.url), {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ skin: { ...state.skin, figure } }),
        })
        assert.ok(response.ok, 'select panel fixture figure in the disposable profile')
        await waitFor(() => companion.panel('state'), (value) => value?.skin.figure === figure, 'panel fixture figure selected')
      }
      await require('./companion-panels-probe.cjs')(state.url, waitFor)
      return
    }
    const config = JSON.parse(fs.readFileSync(path.join(data, 'home/companion/config.json'), 'utf8'))
    assert.equal(config.worlds['desktop-pet'].skin.figure, 'minduck-duck')
    assert.equal(config.companion.telemetry, false)
    if (process.env.MINDUCK_COMPANION_SETTINGS_ONLY === '1') {
      await require('./companion-settings-probe.cjs')({ companion, data, waitFor })
      return
    }
    companion.openSettings('#/dress')
    const settings = companion.getSettingsWindow()
    companion.openSettings()
    assert.equal(companion.getSettingsWindow().id, settings.id, 'reuses the open settings window')
    const consoleErrors = []
    settings.webContents.on('console-message', (_event, details) => {
      if (details.level === 'error') consoleErrors.push(details.message)
    })
    const result = await waitFor(() => settings.webContents.executeJavaScript(
      '({text:document.body.innerText,frames:document.querySelectorAll("iframe").length})'),
    (value) => value.text.includes('装扮') && value.frames > 0, 'dress page and preview').catch(async error => {
      console.error('Settings diagnostic:', await settings.webContents.executeJavaScript('({url:location.href,text:document.body.innerText,frames:[...document.querySelectorAll("iframe")].map(f=>f.src)})'));
      throw error
    })
    await waitFor(async () => {
      const frame = settings.webContents.mainFrame.frames.find(value => value.url.includes('/dress?'))
      return frame ? frame.executeJavaScript('document.body.innerText').catch(() => '') : ''
    }, text => text.includes('默认鸭'), 'actual dressing iframe loads the default duck')
    assert.ok(result.text.includes('装扮'))
    assert.equal(await settings.webContents.executeJavaScript('typeof require'), 'undefined')
    assert.equal(await settings.webContents.executeJavaScript('typeof process'), 'undefined')
    const probeSource = fs.readFileSync(path.join(__dirname, 'companion-figure-probe.js'), 'utf8')
    const probe = await settings.webContents.executeJavaScript(
      probeSource + '\nprobeSuitDuck(' + JSON.stringify(new URL(state.url).origin) + ')')
    assert.ok(probe.words.includes('work') && probe.words.includes('ask'))
    for (const word of ['work', 'ask']) {
      assert.ok(probe.flows[word].done, `${word} must complete`)
      assert.ok(probe.flows[word].phases.includes('stowing'))
    }
    assert.ok(probe.flows.work.phases.includes('typing'))
    assert.ok(probe.flows.ask.phases.includes('waiting'))
    assert.ok(probe.cancelled && probe.walked && probe.recovered, JSON.stringify(probe))
    assert.equal(probe.dragMode, 'drag')
    assert.equal(probe.recoveries.length, 3)
    assert.ok(probe.activity, 'real sandbox automatic activity transitions and recovery')
    assert.ok(probe.recoveries.every(recovery => recovery.restored))
    const petOrigin = new URL(state.url).origin
    const packs = await (await fetch(petOrigin + '/api/figures')).json()
    for (const pack of packs) {
      const modelData = pack.model ? await (await fetch(petOrigin + pack.base + pack.model)).json() : null
      const descriptor = { id: pack.id, base: pack.base, entry: pack.entry, export: pack.export,
        modelData, scheme: pack.presets[0]?.id ?? '' }
      const compatible = await settings.webContents.executeJavaScript(
        probeSource + '\nprobeSuitDuck(' + JSON.stringify(petOrigin) + ',' + JSON.stringify(descriptor) + ')')
      assert.ok(compatible.thinking && compatible.interrupted, pack.id + ': idle thinking and interruption')
      assert.ok(compatible.clickThinking, pack.id + ': click thinking')
      if (compatible.activity !== null) assert.ok(compatible.activity, pack.id + ': automatic Matter activity')
      console.log('PASS: official sandbox idle/click thinking + cancellation:', pack.id)
    }
    const saved = await settings.webContents.executeJavaScript(`fetch('/api/config', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ group: 'world:desktop-pet', values: { 'worlds.desktop-pet.roam': 'off' } })
    }).then(async response => ({ status: response.status, data: await response.json() }))`)
    assert.equal(saved.status, 200)
    assert.equal(saved.data.ok, true)
    const persisted = JSON.parse(fs.readFileSync(path.join(data, 'home/companion/config.json'), 'utf8'))
    assert.equal(persisted.worlds['desktop-pet'].roam, 'off')
    assert.equal(persisted.worlds['desktop-pet'].skin.figure, 'minduck-duck')
    await require('./companion-click-page-probe.cjs')(state.url, waitFor)
    await require('./companion-suit-pose-probe.cjs')(state.url)
    await require('./companion-panels-probe.cjs')(state.url, waitFor)
    // Pet fixture interactions may close settings; check reuse of the current window.
    companion.openSettings()
    const reopened = companion.getSettingsWindow()
    companion.openSettings()
    assert.equal(companion.getSettingsWindow().id, reopened.id, 'reuses settings after pet interactions')
    await waitFor(() => reopened.webContents.isLoading(), value => !value, 'settings finishes loading')
    await companion.hide()
    await waitFor(() => companion.panel('state'), (value) => !value?.connected, 'pet stops')
    await companion.show()
    await waitFor(() => companion.panel('state'), (value) => value?.connected, 'pet reopens')
    assert.deepEqual(consoleErrors, [])
    console.log('PASS: Core, pet host, settings persistence, sandbox, work/ask timing, cancel, walk, drag/drop, hide/reopen')
  } catch (error) {
    console.error(error)
    process.exitCode = 1
  } finally {
    await companion?.stop()
    clearTimeout(timeout)
    app.exit(process.exitCode ?? 0)
  }
})
app.on('window-all-closed', () => {})
