const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

// Exercise the actual bundled settings and cross-origin dress frame in a disposable profile.
module.exports = async function probeSettings({ companion, data, waitFor }) {
  companion.openSettings('#/home')
  const window = companion.getSettingsWindow()
  const contents = window.webContents
  const evaluate = (source) => contents.executeJavaScript(source)
  const route = async (value) => {
    await evaluate(`location.hash=${JSON.stringify(value)};void 0`)
    await waitFor(() => evaluate('location.hash'), (hash) => hash === '#/pet', 'hidden route returns to habits')
  }
  await waitFor(() => evaluate('({hash:location.hash,scheme:document.documentElement.dataset.themeScheme})'),
    (value) => value.hash === '#/pet' && value.scheme === 'minduck-matter', 'default habits and Matter scheme')
  const theme = await evaluate('fetch("/api/theme").then(r=>r.json())')
  assert.equal(theme.theme.selectedId, 'minduck-matter')
  assert.equal(theme.theme.custom.find((scheme) => scheme.id === 'minduck-matter').name, 'Matter')
  let expectedRoam = '多待机'
  const checkHabits = async () => {
    const state = await evaluate(`({nav:[...document.querySelectorAll('#companion-navigation a')].map(a=>a.textContent.trim()),
      mode:!!document.querySelector('.companion-mode'),
      sidebarChrome:document.querySelectorAll('#rail .brand,#rail .companion-lockup,#rail .railfoot,#rail .rail-action,#rail .rail-who').length,
      titlebarRelease:document.querySelectorAll('.companion-titlebar-release,.companion-titlebar a[href*="github.com"]').length,
      sections:[...document.querySelectorAll('.featureslot-pet > .sheet > h3')].map(h=>h.textContent.trim()),
      labels:[...document.querySelectorAll('.featureslot-pet .companion-label')].map(el=>el.textContent.trim()),
      visibleLabels:[...document.querySelectorAll('.featureslot-pet .companion-label')].filter(el=>el.checkVisibility()).map(el=>el.textContent.trim()),
      soundKinds:[...document.querySelector('.featureslot-pet .companion-checks').children].map(el=>el.textContent.trim()),
      roamOptions:[...document.querySelector('.featureslot-pet .segwrap').querySelectorAll('button')].map(el=>el.textContent.trim()),
      roam:document.querySelector('.featureslot-pet .segwrap .active')?.textContent.trim(),
      lockedSliders:['大小','外发光'].map(label=>!!document.querySelector('[role="slider"][aria-label="'+label+'"]')),
      scheme:document.documentElement.dataset.themeScheme,
      overflow:document.documentElement.scrollWidth>innerWidth})`)
    assert.deepEqual(state.nav, ['习惯', '装扮'])
    assert.equal(state.mode, false)
    assert.equal(state.sidebarChrome, 0, 'branding, footer actions and profile are omitted from the sidebar')
    assert.equal(state.titlebarRelease, 0, 'version, GitHub release links and separator are omitted from the titlebar')
    assert.deepEqual(state.sections, ['行为与互动', '显示', '音效'])
    assert.deepEqual(state.roamOptions, ['多走动', '多待机', '不乱动'])
    assert.equal(state.roam, expectedRoam)
    for (const label of ['使用统计', '声道', '语言', '字体尺寸', '气泡速度', 'Coo 的名字', '称呼', '呼噜时长']) {
      assert.ok(!state.labels.includes(label), `${label} is omitted from settings`)
    }
    for (const label of ['走动', '气泡尺寸', '帧率', '位置', '音效', '分类']) {
      assert.ok(state.visibleLabels.includes(label), `${label} remains visible`)
    }
    assert.deepEqual(state.lockedSliders, [false, false], 'pet size and outer glow are fixed')
    assert.deepEqual(state.soundKinds, ['动作', '互动', '表情', '打呼噜'])
    assert.equal(state.scheme, 'minduck-matter')
    assert.equal(state.overflow, false)
  }
  await waitFor(() => evaluate('document.querySelectorAll(".featureslot-pet > .sheet").length'),
    (count) => count === 3, 'habits sections ready')
  const waitForRoam = () => waitFor(() => evaluate('document.querySelector(".featureslot-pet .segwrap .active")?.textContent.trim()'),
    value => value === expectedRoam, 'walking preference has loaded')
  await waitForRoam()
  await checkHabits()
  await evaluate('localStorage.setItem("companion.mode","advanced");void 0')
  contents.reload()
  await waitFor(() => evaluate('document.querySelectorAll(".featureslot-pet > .sheet").length'),
    (count) => count === 3, 'old advanced preference returns to compact settings')
  await waitForRoam()
  await checkHabits()
  for (const hidden of ['home', 'voice', 'prompts', 'usage', 'chat', 'world', 'extensions', 'providers', 'settings', 'page/world:desktop-pet']) {
    await route('#/' + hidden)
  }
  const directory = path.resolve(__dirname, '../build')
  contents.debugger.attach('1.3')
  const send = (method, params) => contents.debugger.sendCommand(method, params)
  const click = async (selector) => {
    const point = await evaluate(`(()=>{const el=document.querySelector(${JSON.stringify(selector)}),r=el.getBoundingClientRect();
      if(!el.checkVisibility())throw Error('Control is hidden');return {x:r.x+r.width/2,y:r.y+r.height/2}})()`)
    for (const type of ['mousePressed', 'mouseReleased']) {
      await send('Input.dispatchMouseEvent', { type, ...point, button: 'left', clickCount: 1 })
    }
  }
  try {
    window.setContentSize(1040, 760)
    fs.writeFileSync(path.join(directory, 'companion-settings-roaming-default.png'), (await contents.capturePage()).toPNG())
    const configFile = path.join(data, 'home/companion/config.json')
    const readPrefs = () => {
      try { return JSON.parse(fs.readFileSync(configFile, 'utf8')).worlds['desktop-pet'] }
      catch (error) { if (error.code === 'ENOENT') return {}; throw error }
    }
    assert.equal(readPrefs().roam, 'calm', 'fresh profiles default to more idle time')
    await click('.featureslot-pet .segwrap button:nth-child(1)')
    await waitFor(readPrefs, value => value.roam === 'free', 'walking choice saves through the real control')
    expectedRoam = '多走动'
    contents.reload()
    await waitFor(() => evaluate('document.querySelector(".featureslot-pet .segwrap .active")?.textContent'),
      value => value === expectedRoam, 'walking choice survives settings reload')
    await waitForRoam()
    await checkHabits()
    await click('.featureslot-pet .segwrap button:nth-child(2)')
    await waitFor(readPrefs, value => value.roam === 'calm', 'more idle time can be selected and saved')
    await click('.featureslot-pet .segwrap button:nth-child(1)')
    await waitFor(readPrefs, value => value.roam === 'free', 'explicit walking choice is retained for restart')
    window.setMinimumSize(375, 560)
    for (const width of [375, 768, 1024, 1440]) for (const appearance of ['light', 'dark']) {
      window.setContentSize(width, 760)
      await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: appearance }] })
      await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))')
      await waitFor(() => evaluate('document.documentElement.dataset.colorMode'), (value) => value === appearance, 'theme follows system').catch(async error => {
        console.error('Settings appearance diagnostic:', { width, expected: appearance,
          actual: await evaluate('({mode:document.documentElement.dataset.colorMode,dark:matchMedia("(prefers-color-scheme: dark)").matches})') })
        throw error
      })
      await checkHabits()
      await waitFor(() => evaluate(`[...document.querySelectorAll('.companion-control>.check>input,.companion-switchbox>.check>input')]
        .every(el=>el.getAnimations().every(animation=>animation.playState!=='running'))`),
        value => value, 'switch color transitions settle after appearance change')
      const colors = await evaluate(`(()=>{
        const background=selector=>getComputedStyle(document.querySelector(selector)).backgroundColor;
        const accent=getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
        return {accent,body:background('body'),rail:background('#rail'),titlebar:background('.companion-titlebar'),
          selected:getComputedStyle(document.querySelector('#rail .navitem.active .navicon')).color,
          switches:[...document.querySelectorAll('.companion-control>.check>input:checked,.companion-switchbox>.check>input:checked')].map(el=>getComputedStyle(el).backgroundColor),
          sliders:[...document.querySelectorAll('[role="slider"]')].map(el=>[el,...el.querySelectorAll('*')].map(node=>getComputedStyle(node).backgroundColor))};
      })()`)
      const accent = appearance === 'dark' ? '#ff9500' : '#ff9a2e'
      const accentRGB = appearance === 'dark' ? 'rgb(255, 149, 0)' : 'rgb(255, 154, 46)'
      const canvas = appearance === 'dark' ? 'rgb(0, 0, 0)' : 'rgb(247, 247, 248)'
      assert.equal(colors.accent, accent)
      for (const area of ['body', 'rail', 'titlebar']) assert.equal(colors[area], canvas, `${area} ${appearance} background`)
      assert.equal(colors.selected, accentRGB, 'selected navigation uses Matter accent')
      assert.ok(colors.switches.length > 0)
      assert.ok(colors.switches.every(color => color === accentRGB), 'checked switches use Matter accent')
      assert.ok(colors.sliders.length >= 1)
      assert.ok(colors.sliders.every(colors => colors.includes(accentRGB)), 'slider thumbs use Matter accent')
      assert.equal(window.getBackgroundColor().slice(0, 7).toLowerCase(), appearance === 'dark' ? '#000000' : '#f7f7f8')
      if (width === 1024) {
        await evaluate('for(let el=document.querySelector(".featureslot-pet");el;el=el.parentElement)el.scrollTop=0;window.scrollTo(0,0);new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))')
        fs.writeFileSync(path.join(directory, `companion-settings-${appearance}.png`), (await contents.capturePage()).toPNG())
        await evaluate('document.querySelector(".companion-checks").scrollIntoView({block:"center"})')
        await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))')
        fs.writeFileSync(path.join(directory, `companion-settings-sound-${appearance}.png`), (await contents.capturePage()).toPNG())
        await evaluate('document.querySelector(".featureslot-pet").scrollIntoView({block:"start"})')
      }
      const collapsed = await evaluate('document.querySelector("#rail").classList.contains("is-collapsed")')
      await click('.companion-sidebar-toggle')
      await waitFor(() => evaluate('document.querySelector("#rail").classList.contains("is-collapsed")'),
        (value) => value !== collapsed, 'sidebar toggle still works')
      await waitFor(() => evaluate('document.querySelector("#rail").getAnimations({subtree:true}).every(a=>a.playState!=="running")'),
        (value) => value, 'sidebar layout settles')
      await checkHabits()
      if (width === 1024) fs.writeFileSync(path.join(directory, `companion-settings-toggle-${appearance}.png`), (await contents.capturePage()).toPNG())
      await click('.companion-sidebar-toggle')
      await waitFor(() => evaluate('document.querySelector("#rail").classList.contains("is-collapsed")'),
        (value) => value === collapsed, 'sidebar returns to its prior state')
    }
    const bubbleSelector = '[role="slider"][aria-label="气泡尺寸"]'
    await waitFor(() => evaluate(`document.querySelector('${bubbleSelector}')?.getAttribute('aria-valuenow')`),
      value => value === '1', 'bubble size defaults to 100%')
    assert.equal(await evaluate(`document.querySelector('${bubbleSelector}').getAttribute('aria-valuemax')`), '1.5')
    await evaluate(`document.querySelector('${bubbleSelector}').scrollIntoView({block:'center'});document.querySelector('${bubbleSelector}').focus()`)
    for (let step = 0; step < 12; step++) for (const type of ['keyDown', 'keyUp']) {
      await send('Input.dispatchKeyEvent', { type, key:'ArrowRight', code:'ArrowRight', windowsVirtualKeyCode:39 })
    }
    const readBubble = () => readPrefs().window?.bubbleSize
    await waitFor(readBubble, value => value === 1.5, 'real slider saves and caps bubble size at 150%')
    const invalid = await evaluate(`fetch('/api/config',{method:'POST',headers:{'content-type':'application/json'},
      body:JSON.stringify({group:'world:desktop-pet',values:{'worlds.desktop-pet.window.bubbleSize':1.55}})}).then(r=>r.ok)`)
    assert.equal(invalid, false, 'API rejects bubble sizes above 150%')
    // Explicit settings survive removing their controls and changing a retained category.
    await evaluate(`(async()=>{
      for(const [group,values] of [
        ['world:desktop-pet',{'worlds.desktop-pet.window.glow':5,'worlds.desktop-pet.window.fontSize':1.25}],
        ['world:desktop-pet:sound',{'worlds.desktop-pet.sounds.talk':false,
          'worlds.desktop-pet.sounds.ui':true,'worlds.desktop-pet.sounds.snoreSeconds':17}]
      ]) {
        const response=await fetch('/api/config',{method:'POST',headers:{'content-type':'application/json'},
          body:JSON.stringify({group,values})})
        if(!response.ok)throw Error(group+' save failed: '+await response.text())
      }
    })()`)
    contents.reload()
    await waitForRoam()
    await checkHabits()
    const previousMove = readPrefs().sounds.move ?? true
    await evaluate('document.querySelector(".companion-checks").scrollIntoView({block:"center"})')
    await click('.companion-checks input')
    await waitFor(readPrefs, value => value.sounds.move === !previousMove, 'retained sound category can be saved')
    const saved = readPrefs()
    assert.equal(saved.window.glow, 5, 'hidden legacy glow preference remains stored but is ignored by the pet')
    assert.equal(saved.window.fontSize, 1.25)
    assert.equal(saved.sounds.talk, false)
    assert.equal(saved.sounds.ui, true)
    assert.equal(saved.sounds.snoreSeconds, 17)
    window.setContentSize(1040, 760)
    await click('a[href="#/dress"]')
    await waitFor(() => evaluate('location.hash'), (value) => value === '#/dress', 'real dress navigation')
    const dress = await waitFor(() => contents.mainFrame.frames.find((frame) => /\/dress(?:\?|$)/.test(frame.url)),
      (value) => !!value, 'dress frame')
    const readFigures = () => dress.executeJavaScript(`({titles:[...document.querySelectorAll('#optFigure .opt.figure')].map(el=>el.title),
      selected:document.querySelector('#optFigure [aria-pressed="true"]')?.title,theme:document.documentElement.dataset.uiTheme})`)
    const figures = await waitFor(readFigures, (value) => value.selected === '默认鸭', 'selected default duck')
    assert.ok(figures.titles.includes('西装鸭'))
    assert.ok(!figures.titles.some((title) => title === 'Coo' || title.includes('大肥鱼')))
    assert.equal(figures.theme, 'dark')
    fs.writeFileSync(path.join(directory, 'companion-settings-dress.png'), (await contents.capturePage()).toPNG())
    await evaluate('fetch("/api/theme",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({selectedId:"coo-whale-claude",mode:"dark",custom:[]})}).then(r=>{if(!r.ok)throw Error("legacy theme save failed")})')
  } finally {
    contents.debugger.detach()
  }
  const reloadSettings = async () => {
    await waitFor(() => contents.isLoadingMainFrame(), loading => !loading, 'prior settings navigation finishes')
    const loaded = new Promise(resolve => contents.once('did-finish-load', resolve))
    contents.reload()
    await loaded
  }
  const restartCore = async (scheme) => {
    const port = companion.status().port
    await evaluate('fetch("/api/run/restart",{method:"POST"}).then(r=>{if(!r.ok)throw Error("restart failed")})')
    await waitFor(() => companion.status(), (value) => value.state !== 'running' || value.port !== port, 'Core begins restarting')
    await waitFor(() => companion.status(), (value) => value.state === 'running', 'Core restarted')
    await reloadSettings()
    await waitFor(() => evaluate('document.documentElement.dataset.themeScheme'), (value) => value === scheme, 'palette after Core restart')
  }
  await restartCore('minduck-matter')
  assert.equal((await evaluate('fetch("/api/theme").then(r=>r.json())')).theme.mode, 'dark', 'legacy migration retains appearance')
  // Explicit independent palettes still survive, while the old automatic Claude scheme migrates.
  await evaluate('fetch("/api/theme",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({selectedId:"navigator",mode:"light",custom:[]})}).then(r=>{if(!r.ok)throw Error("theme save failed")})')
  await reloadSettings()
  await waitFor(() => evaluate('document.documentElement.dataset.themeScheme'), (value) => value === 'navigator', 'explicit palette remains selectable')
  await restartCore('navigator')
  const persisted = JSON.parse(fs.readFileSync(path.join(data, 'home/companion/theme.json'), 'utf8'))
  assert.equal(persisted.selectedId, 'navigator')
  assert.equal(JSON.parse(fs.readFileSync(path.join(data, 'home/companion/config.json'), 'utf8')).worlds['desktop-pet'].window.bubbleSize, 1.5)
  assert.equal(JSON.parse(fs.readFileSync(path.join(data, 'home/companion/config.json'), 'utf8')).worlds['desktop-pet'].roam, 'free')
  await waitFor(() => companion.panel('state'), (value) => value?.connected && value.skin.figure === 'minduck-duck', 'default duck reconnects')
  console.log('PASS: Matter accent on navigation/sliders/switches and black dark canvas/native chrome, legacy theme migration; walking choices/default calm/save/reload/restart; bubble slider 100–150% and persistence; compact settings, hidden fixed pet-size/glow controls, retained sound changes preserve hidden values, 4 widths/light-dark, navigation and explicit theme restart')
}
