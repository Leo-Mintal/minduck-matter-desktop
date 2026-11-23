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
  const ready = () => waitFor(() => evaluate(`(()=>{const s=document.querySelector('#previewAction');
    return {ready:!!s&&!s.disabled,choice:s?.value,options:s?[...s.options].map(o=>o.value):[]}})()`),
  value => value.ready, 'preview action options ready')
  await ready()
  window.hide()
  await evaluate(`window.__previewPosts=[];window.__previewFrames=[];
    const originalFetch=window.fetch;window.fetch=(url,options)=>{
      if(options?.method==='POST')window.__previewPosts.push(String(url));return originalFetch(url,options)};
    addEventListener('message',event=>{if(event.source!==document.querySelector('#figureLayer iframe')?.contentWindow)return;
      if(event.data?.t==='frame'){window.__previewFrames.push(event.data);if(window.__previewFrames.length>500)window.__previewFrames.shift()}});void 0`)
  const select = async id => {
    await evaluate(`(()=>{window.__previewFrames=[];const select=document.querySelector('#previewAction');
      select.value=${JSON.stringify(id)};select.dispatchEvent(new Event('change',{bubbles:true}))})()`)
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
  assert.ok(initial.options.includes('word:love'), 'includes supported expressions absent from the manifest')
  assert.ok(!initial.options.includes('word:carry'), 'default duck does not advertise suit-only actions')
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
  await select('word:love')
  const before = await evaluate(`window.__previewFirst=document.querySelector('#figureLayer iframe');performance.now()`)
  await evaluate(`document.querySelector('#previewReplay').click();void 0`)
  await ready()
  assert.equal(await evaluate(`window.__previewFirst!==document.querySelector('#figureLayer iframe')`), true,
    'replay creates a fresh body, clearing queued or continuous actions')
  assert.ok(Number.isFinite(before))
  assert.deepEqual(await evaluate('window.__previewPosts'), [], 'preview choices and replay never save preferences')
  const suit = await chooseFigure('minduck-suit-duck')
  assert.equal(suit.choice, 'auto')
  for (const id of ['word:write', 'word:think', 'word:flag', 'word:carry']) assert.ok(suit.options.includes(id), id)
  const checked = []
  for (const id of suit.options.filter(id => id !== 'auto')) {
    await select(id)
    if (['work', 'ask', 'happy', 'sad', 'write', 'think', 'flag', 'carry'].some(word => id === `word:${word}`)) {
      assert.ok((await frames()).some(layout => layout.gesture === id.slice(5)), `${id} runs its actual source animation`)
    }
    if (id === 'interaction:grab') assert.ok((await frames()).some(layout => layout.mode === 'drag'))
    if (['interaction:drop', 'interaction:throw'].includes(id)) {
      assert.ok((await frames()).some(layout => layout.mode === 'air'), `${id} uses real physics`)
    }
    if (id.startsWith('task:')) {
      assert.ok((await frames()).some(layout => layout.matterActivity === id.slice(5)), `${id} uses task adapter`)
    }
    if (id === 'interaction:thinking') {
      const figure = dress.frames.find(frame => frame.url.includes('/figure-frame'))
      assert.ok(await figure.executeJavaScript(`(()=>{const el=document.querySelector('[data-flow="think"]');
        return !!el && getComputedStyle(el).display!=='none' && Number(el.getAttribute('opacity'))>0})()`),
      'automatic thinking renders the authored duck and bubble')
    }
    checked.push(id)
    console.log('PASS: preview', id)
  }
  await select('task:work')
  await evaluate('new Promise(resolve=>setTimeout(resolve,8500))')
  assert.equal((await frames()).at(-1).matterActivity, 'work', 'continuous work outlives the one-shot clip')
  await select('word:love')
  assert.ok((await frames()).every(layout => !layout.matterActivity), 'changing away from a task clears its state')
  assert.deepEqual(await evaluate('window.__previewPosts'), ['/api/skin'], 'only a real figure choice persists')
  console.log(`PASS: all ${checked.length} actions render through real dress controls; replay, task continuation and isolated preferences`)
  const output = path.resolve(__dirname, '../build/companion-preview-20261120')
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
      const layout = await evaluate(`(()=>{const nodes=[...document.querySelectorAll('.preview-controls select,.preview-controls button')];
        return {overflow:document.documentElement.scrollWidth>innerWidth,
          controls:nodes.map(el=>{const r=el.getBoundingClientRect();return {visible:el.checkVisibility(),left:r.left,right:r.right,width:r.width}}),
          width:innerWidth,choice:document.querySelector('#previewAction').value}})()`)
      fs.writeFileSync(path.join(output, `settings-${width}-${mode}.png`), (await contents.capturePage()).toPNG())
      assert.equal(layout.overflow, false, `${width}/${mode} no horizontal overflow`)
      // The embedded flex frame can have a fractional CSS width; innerWidth is integer-rounded.
      assert.ok(layout.controls.every(control => control.visible && control.left >= 0 && control.right <= layout.width + 1 && control.width > 50),
        JSON.stringify({ width, mode, ...layout }))
      assert.equal(layout.choice, 'word:love')
    }
  } finally { contents.debugger.detach() }
  const back = await chooseFigure('minduck-duck')
  assert.equal(back.choice, 'auto')
  assert.ok(!back.options.includes('word:carry'))
  contents.reload()
  const reloaded = await waitFor(() => contents.mainFrame.frames.find(frame => frame.url.includes('/dress?')),
    frame => !!frame, 'dressing frame after reload')
  await waitFor(() => reloaded.executeJavaScript('document.querySelector("#previewAction")?.value'),
    value => value === 'auto', 'preview choice is never persisted')
  assert.deepEqual(errors, [])
  fs.writeFileSync(path.join(output, 'validation.json'), JSON.stringify({ checked, widths: [375, 768, 1024, 1440],
    appearances: ['light', 'dark'], restrictedVocabulary: true, previewNeverSaves: true, replayResetsBody: true }, null, 2) + '\n')
  console.log(`PASS: ${checked.length} preview actions, replay, task exit, isolated preferences, factory vocabulary and four widths/two themes`)
}
