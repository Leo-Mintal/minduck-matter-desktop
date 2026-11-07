// Executed only by the smoke test inside its disposable settings renderer.
async function probeSuitDuck(origin, pack) {
  const frame = document.createElement('iframe')
  frame.sandbox = 'allow-scripts'
  frame.src = origin + '/figure-frame' + (pack ? '?pack=' + encodeURIComponent(pack.id) : '')
  document.body.append(frame)
  let receive
  let failure
  const messages = []
  const listener = (event) => {
    if (event.source !== frame.contentWindow) return
    if (event.data?.t === 'error') failure = event.data.message
    if (receive) { const next = receive; receive = null; next(event.data) }
    else messages.push(event.data)
  }
  window.addEventListener('message', listener)
  const next = async () => {
    if (failure) throw new Error(failure)
    if (messages.length) return messages.shift()
    return new Promise((resolve) => { receive = resolve })
  }
  const send = (message) => frame.contentWindow.postMessage(message, '*')
  const tick = async (count, dt = .05) => {
    const frames = []
    for (let i = 0; i < count; i++) {
      send({ t: 'tick', dt })
      const message = await next()
      if (message.t !== 'frame') throw new Error(JSON.stringify(message))
      frames.push(message)
    }
    return frames
  }
  async function probeRecovery() {
    const recoveries = []
    for (const [word, thrown] of [['work', false], ['ask', false], ['work', true]]) {
      send({ t: 'do', word }); const before = await tick(20)
      const point = before.at(-1).layout.hit[0]
      send({ t: 'pointer', type: 'down', p: { ...point, t: 1000 } })
      send({ t: 'pointer', type: 'move', p: { x: point.x + 80, y: 180, t: 1040 } })
      await tick(3)
      if (thrown) send({ t: 'pointer', type: 'up', p: { x: point.x + 80, y: 180, t: 1050 } })
      else send({ t: 'drop', p: { x: point.x + 80, y: 280 } })
      const modes = [], frames = []
      let restored = false
      for (let i = 0; i < 220; i++) {
        const [message] = await tick(1)
        modes.push(message.layout.mode); frames.push(message)
        if (message.layout[word]) { restored = true; break }
      }
      if (!restored || !modes.includes(thrown ? 'dizzy' : 'land')
        || frames.some(message => ['air', 'land', 'dizzy'].includes(message.layout.mode) && message.layout[word])) {
        throw new Error('Incorrect flow recovery: ' + JSON.stringify({ word, thrown, restored, modes: [...new Set(modes)] }))
      }
      recoveries.push({ word, thrown, restored })
      await tick(125)
    }
    return recoveries
  }
  async function probeActivity() {
    const set = (kind, id = 'sandbox-cue') => send({ t: 'set', state: {
      matterActivity: { kind, id, expiresAt: Date.now() + 10000 } } })
    set('work')
    const loops = await tick(250)
    if (loops.filter(f => f.events.some(e => e.kind === 'done' && e.detail.word === 'work')).length < 2
      || loops.some(f => ['walk', 'run'].includes(f.layout.mode))) throw new Error('Automatic work did not loop stationary')
    set('ask')
    const change = await tick(125)
    const firstAsk = change.findIndex(f => f.layout.ask)
    if (firstAsk < 0 || !change.slice(0, firstAsk + 1).some(f =>
      f.events.some(e => e.kind === 'done' && e.detail.word === 'work'))
      || !change.slice(0, firstAsk).some(f => f.layout.work === 'stowing')) {
      throw new Error('Activity cut off the current flow before switching to ask')
    }
    const point = change.at(-1).layout.hit[0]
    send({ t: 'pointer', type: 'down', p: { ...point, t: 1000 } })
    send({ t: 'pointer', type: 'move', p: { x: point.x + 70, y: 180, t: 1040 } })
    await tick(3)
    send({ t: 'pointer', type: 'up', p: { x: point.x + 70, y: 180, t: 1050 } })
    set('work')
    const recovery = await tick(220)
    if (!recovery.some(f => f.layout.mode === 'dizzy') || !recovery.some(f => f.layout.work)
      || recovery.some(f => f.layout.ask || ['air', 'land', 'dizzy', 'wake'].includes(f.layout.mode) && f.layout.work)) {
      throw new Error('Automatic drag recovery did not wait for dizzy or restored a stale ask')
    }
    set('idle'); await tick(125)
    send({ t: 'walk', x: 750, run: false, id: 'activity-idle-walk' })
    const [walk] = await tick(1)
    if (walk.layout.mode !== 'walk') throw new Error('Idle activity did not release walking')
    send({ t: 'do', word: 'stand' }); await tick(1)
    for (const [kind, word] of [['success', 'happy'], ['error', 'sad']]) {
      set(kind, kind)
      const expression = await tick(70)
      if (!expression.some(f => f.layout.expression === word) || expression.at(-1).layout.matterActivity
        || expression.some(f => ['walk', 'run'].includes(f.layout.mode))) throw new Error('Incorrect terminal activity: ' + kind)
      set(kind, kind)
      if ((await tick(70)).some(f => f.layout.expression === word)) throw new Error('Duplicate terminal cue replayed')
    }
    set('idle')
    return true
  }
  try {
    const loaded = await next()
    if (loaded.t !== 'loaded') throw new Error('Official figure frame did not load')
    const base = pack ? origin + pack.base : origin + '/packs/minduck-duck/'
    send({ t: 'init', entry: base + (pack?.entry ?? 'figure.js'), export: pack?.export ?? 'createDuckBody',
      base, model: pack?.modelData, scheme: pack?.scheme ?? '', theme: 'dark', language: 'zh',
      bounds: { W: 960, H: 600, floorY: 600, S: .5 },
      start: { x: 400, facing: 1, enter: false } })
    const ready = await next()
    if (ready.t !== 'ready') throw new Error(JSON.stringify(ready))
    // Match pet-app.js defaults: thoughtShown is enabled even while no status is active.
    send({ t: 'set', state: { roam: 'off', thoughtShown: true, thinking: false,
      dialogOpen: false, listening: false, status: null } })
    if (pack) {
      let thinking = false
      for (let i = 0; i < 910; i++) {
        const [message] = await tick(1)
        if (message.layout.mode === 'idle' && message.layout.moving) { thinking = true; break }
      }
      if (!thinking) throw new Error('No random idle animation: ' + pack.id)
      await tick(40)
      send({ t: 'do', word: 'neutral' })
      const [stopped] = await tick(1)
      const clicks = []
      for (const mode of ['idle', 'sleep', 'walk']) {
        if (mode === 'sleep') send({ t: 'do', word: 'sleep' })
        if (mode === 'walk') send({ t: 'walk', x: 750, run: false, id: 'click-walk' })
        const [before] = await tick(2)
        const point = before.layout.hit[0]
        if (!point) throw new Error('No figure hit target: ' + pack.id)
        send({ t: 'pointer', type: 'down', p: { x: point.x, y: point.y, t: 1000 } })
        send({ t: 'pointer', type: 'up', p: { x: point.x, y: point.y, t: 1100 } })
        const reaction = await tick(70)
        clicks.push(reaction.every((item) => item.layout.mode === 'idle' && item.layout.moving)
          && reaction.every((item) => item.sounds.every((sound) => sound.name !== 'poke')))
        if (!clicks.at(-1)) throw new Error(JSON.stringify({ id: pack.id, clickMode: mode,
          before: before.layout, modes: [...new Set(reaction.map((item) => item.layout.mode))],
          moving: reaction.filter((item) => item.layout.moving).length,
          sounds: reaction.flatMap((item) => item.sounds.map((sound) => sound.name)) }))
        send({ t: 'do', word: 'neutral' })
        await tick(1)
      }
      const hasFlows = ready.words.includes('work') && ready.words.includes('ask')
      const recoveries = hasFlows ? await probeRecovery() : []
      const activity = hasFlows ? await probeActivity() : null
      return { id: pack.id, thinking, recoveries, activity, clickThinking: clicks.every(Boolean),
        interrupted: !stopped.layout.moving, words: ready.words }
    }
    await tick(30)
    const flows = {}
    for (const [word, count] of [['work', 120], ['ask', 123]]) {
      send({ t: 'do', word })
      const frames = await tick(count)
      flows[word] = { phases: [...new Set(frames.map((item) => item.layout[word]))],
        done: frames.some((item) => item.events.some((event) => event.kind === 'done' && event.detail.word === word)) }
    }
    const recoveries = await probeRecovery()
    const activity = await probeActivity()
    send({ t: 'do', word: 'work' }); await tick(7)
    send({ t: 'do', word: 'jump' })
    const cancel = await tick(40)
    send({ t: 'walk', x: 650, run: false, id: 'smoke-walk' })
    const walk = await tick(6)
    const last = walk.at(-1).layout
    send({ t: 'pointer', type: 'down', p: { x: last.x, y: 550 } })
    send({ t: 'pointer', type: 'move', p: { x: last.x + 80, y: 430 } })
    const drag = await tick(2)
    send({ t: 'drop', p: { x: last.x + 80, y: 430 } })
    const drop = await tick(45)
    return { words: ready.words, flows, recoveries, activity,
      cancelled: cancel.at(-1).layout.work === null,
      walked: last.x > 400,
      dragMode: drag.at(-1).layout.mode,
      recovered: drop.at(-1).layout.mode !== 'drag' }
  } finally {
    window.removeEventListener('message', listener)
    frame.remove()
  }
}
