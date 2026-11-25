const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

// Drive the real dress controls and opaque figure sandbox using a disposable Core/profile.
module.exports = async function probePreview({ companion, waitFor }) {
  companion.openSettings('#/dress')
  const window = companion.getSettingsWindow(), contents = window.webContents
  contents.setBackgroundThrottling(false)
  const errors = []
  contents.on('console-message', (_event, details) => { if (details.level === 'error') errors.push(details.message) })
  const dress = await waitFor(() => contents.mainFrame.frames.find(frame => frame.url.includes('/dress?')),
    frame => !!frame, 'dressing frame')
  const evaluate = source => dress.executeJavaScript(source)
  const ready = () => waitFor(() => evaluate(`(()=>{const s=document.querySelector('#previewActions');
    return {ready:!!s&&s.getAttribute('aria-busy')==='false',
      choice:s?.querySelector('[aria-pressed="true"]')?.dataset.action,
      options:s?[...s.children].map(o=>o.dataset.action):[]}})()`),
  value => value.ready, 'preview action options ready')
  await ready()
  window.hide()
  await evaluate(`window.__previewPosts=[];window.__previewFrames=[];
    const originalFetch=window.fetch;window.fetch=(url,options)=>{
      if(options?.method==='POST')window.__previewPosts.push(String(url));return originalFetch(url,options)};
    addEventListener('message',event=>{if(event.source!==document.querySelector('#figureLayer iframe')?.contentWindow)return;
      if(event.data?.t==='frame'){window.__previewFrames.push(event.data);if(window.__previewFrames.length>500)window.__previewFrames.shift()}});void 0`)
  const select = async id => {
    await evaluate(`(()=>{window.__previewFrames=[];
      document.querySelector('#previewActions [data-action="${id}"]').click()})()`)
    const current = await ready()
    assert.equal(current.choice, id)
    await waitFor(() => evaluate('window.__previewFrames.length'), count => count > 1, `${id} draws`)
  }
  const frames = () => evaluate('window.__previewFrames.map(frame=>frame.layout)')
  const chooseFigure = async id => {
    await evaluate(`document.querySelector('#optFigure button[title="${id === 'minduck-suit-duck' ? '西装鸭' : '默认鸭'}"]').click();void 0`)
    return ready()
  }
  const initial = await ready()
  const common = ['auto', 'word:neutral', 'word:walk', 'task:work', 'task:ask', 'task:success', 'task:error']
  assert.deepEqual(initial.options, common)
  assert.equal(await evaluate(`document.querySelector('.preview-controls select')===null`), true)
  const failureLabel = await evaluate(`document.querySelector('#previewActions [data-action="task:error"] span').textContent`)
  assert.equal(failureLabel, '失败')
  assert.equal(await evaluate(`document.querySelector('#optFigure').compareDocumentPosition(
    document.querySelector('#previewActions')) & Node.DOCUMENT_POSITION_FOLLOWING`), 4,
  'character choices come before action choices')
  const vocabulary = await evaluate(`(async()=>{
    const {loadBody}=await import('/web/body-host.js');const packs=await(await fetch('/api/figures')).json();
    const pack=packs.find(p=>p.id==='minduck-duck');const layer=document.createElement('div');document.body.append(layer);
    const body=await loadBody({layer,pack,theme:'light',bounds:{W:600,H:300,floorY:252,S:.5},start:{x:300,enter:false}});
    const value={words:body.words,previewWords:body.previewWords,declared:pack.vocab.map(w=>w.id)};
    body.dispose();layer.remove();return value})()`)
  assert.ok(vocabulary.previewWords.includes('love'))
  assert.deepEqual(vocabulary.words, vocabulary.declared.filter(word => vocabulary.previewWords.includes(word)),
    'model-facing vocabulary remains restricted to manifest words')
  assert.ok(!vocabulary.words.includes('love'))
  await select('word:neutral')
  const before = await evaluate(`window.__previewFirst=document.querySelector('#figureLayer iframe');performance.now()`)
  await evaluate(`document.querySelector('#previewActions [data-action="word:neutral"]').click();void 0`)
  await ready()
  assert.equal(await evaluate(`window.__previewFirst!==document.querySelector('#figureLayer iframe')`), true,
    'replay creates a fresh body, clearing queued or continuous actions')
  assert.ok(Number.isFinite(before))
  assert.deepEqual(await evaluate('window.__previewPosts'), [], 'preview choices and replay never save preferences')
  const suit = await chooseFigure('minduck-suit-duck')
  assert.equal(suit.choice, 'auto')
  assert.deepEqual(suit.options, [...common.slice(0, 3), 'word:write', ...common.slice(3)])
  const checked = []
  for (const id of suit.options.filter(id => id !== 'auto')) {
    await select(id)
    const observed = await frames()
    if (id === 'word:write') assert.ok(observed.some(layout => layout.gesture === 'write'))
    if (id === 'word:walk') assert.ok(observed.some(layout => layout.mode === 'walk'))
    if (id === 'word:neutral') assert.ok(observed.some(layout => layout.mode === 'idle'))
    if (id.startsWith('task:')) {
      const kind = id.slice(5)
      const gesture = { work: 'work', ask: 'ask', success: 'happy', error: 'sad' }[kind]
      assert.ok(observed.some(layout => layout.matterActivity === kind && layout.gesture === gesture), id)
    }
    checked.push(id)
    console.log('PASS: preview', id)
  }
  await select('task:work')
  await evaluate('new Promise(resolve=>setTimeout(resolve,8500))')
  assert.equal((await frames()).at(-1).matterActivity, 'work', 'continuous work outlives the one-shot clip')
  await select('word:neutral')
  assert.ok((await frames()).every(layout => !layout.matterActivity), 'changing away from a task clears its state')
  assert.deepEqual(await evaluate('window.__previewPosts'), ['/api/skin'], 'only a real figure choice persists')
  console.log(`PASS: all ${checked.length} actions render through real dress controls; replay, task continuation and isolated preferences`)
  const output = path.resolve(__dirname, '../build/companion-preview-cards-20261125')
  fs.mkdirSync(output, { recursive: true })
  contents.debugger.attach('1.3')
  try {
    window.setIgnoreMouseEvents(true)
    window.showInactive()
    window.setMinimumSize(375, 560)
    for (const width of [375, 768, 1024, 1440]) for (const mode of ['light', 'dark']) {
      window.setContentSize(width, 760)
      await contents.debugger.sendCommand('Emulation.setEmulatedMedia',
        { features: [{ name: 'prefers-color-scheme', value: mode }] })
      await waitFor(() => evaluate('document.documentElement.dataset.uiTheme'), value => value === mode, 'preview appearance')
      await evaluate(`new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`)
      const layout = await evaluate(`(()=>{const nodes=[...document.querySelectorAll('#previewActions button')];
        const figure=document.querySelector('#optFigure .opt.figure'),reference=getComputedStyle(figure);
        return {overflow:document.documentElement.scrollWidth>innerWidth,
          sharedStyle:nodes.every(el=>{const s=getComputedStyle(el);return el.classList.contains('figure')
            &&s.width===reference.width&&s.borderRadius===reference.borderRadius}),
          thumbnails:nodes.every(el=>{const img=el.querySelector('img');return img?.complete
            &&img.naturalWidth===160&&img.naturalHeight===160}),
          controls:nodes.map(el=>{const r=el.getBoundingClientRect();return {visible:el.checkVisibility(),left:r.left,right:r.right,width:r.width}}),
          width:innerWidth,choice:document.querySelector('#previewActions [aria-pressed="true"]').dataset.action}})()`)
      fs.writeFileSync(path.join(output, `settings-${width}-${mode}.png`), (await contents.capturePage()).toPNG())
      assert.equal(layout.overflow, false, `${width}/${mode} no horizontal overflow`)
      // The embedded flex frame can have a fractional CSS width; innerWidth is integer-rounded.
      assert.ok(layout.controls.every(control => control.visible && control.left >= 0 && control.right <= layout.width + 1 && control.width > 50),
        JSON.stringify({ width, mode, ...layout }))
      assert.equal(layout.choice, 'word:neutral')
      assert.equal(layout.sharedStyle, true, 'actions reuse the character card geometry')
      assert.equal(layout.thumbnails, true, 'each action has a loaded thumbnail')
    }
  } finally { contents.debugger.detach() }
  const back = await chooseFigure('minduck-duck')
  assert.equal(back.choice, 'auto')
  assert.ok(!back.options.includes('word:carry'))
  contents.reload()
  const reloaded = await waitFor(() => contents.mainFrame.frames.find(frame => frame.url.includes('/dress?')),
    frame => !!frame, 'dressing frame after reload')
  await waitFor(() => reloaded.executeJavaScript('document.querySelector("#previewActions [aria-pressed=\\"true\\"]")?.dataset.action'),
    value => value === 'auto', 'preview choice is never persisted')
  assert.deepEqual(errors, [])
  fs.writeFileSync(path.join(output, 'validation.json'), JSON.stringify({ checked, widths: [375, 768, 1024, 1440],
    appearances: ['light', 'dark'], restrictedVocabulary: true, previewNeverSaves: true, replayResetsBody: true }, null, 2) + '\n')
  console.log(`PASS: ${checked.length} preview actions, replay, task exit, isolated preferences, factory vocabulary and four widths/two themes`)
}
