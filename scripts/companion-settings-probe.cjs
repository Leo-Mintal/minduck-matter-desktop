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
    (value) => value.hash === '#/pet' && value.scheme === 'coo-whale-claude', 'default habits and Claude scheme')
  const theme = await evaluate('fetch("/api/theme").then(r=>r.json())')
  assert.equal(theme.theme.selectedId, 'coo-whale-claude')
  assert.match(theme.theme.custom.find((scheme) => scheme.id === 'coo-whale-claude').name, /DeepSeek 大肥鱼.*claude/i)
  const checkHabits = async () => {
    const state = await evaluate(`({nav:[...document.querySelectorAll('#companion-navigation a')].map(a=>a.textContent.trim()),
      mode:!!document.querySelector('.companion-mode'),
      sidebarChrome:document.querySelectorAll('#rail .brand,#rail .companion-lockup,#rail .railfoot,#rail .rail-action,#rail .rail-who').length,
      titlebarRelease:document.querySelectorAll('.companion-titlebar-release,.companion-titlebar a[href*="github.com"]').length,
      sections:[...document.querySelectorAll('.featureslot-pet > .sheet > h3')].map(h=>h.textContent.trim()),
      labels:[...document.querySelectorAll('.featureslot-pet .companion-label')].map(el=>el.textContent.trim()),
      visibleLabels:[...document.querySelectorAll('.featureslot-pet .companion-label')].filter(el=>el.checkVisibility()).map(el=>el.textContent.trim()),
      scheme:document.documentElement.dataset.themeScheme,
      overflow:document.documentElement.scrollWidth>innerWidth})`)
    assert.deepEqual(state.nav, ['习惯', '装扮'])
    assert.equal(state.mode, false)
    assert.equal(state.sidebarChrome, 0, 'branding, footer actions and profile are omitted from the sidebar')
    assert.equal(state.titlebarRelease, 0, 'version, GitHub release links and separator are omitted from the titlebar')
    assert.deepEqual(state.sections, ['通用', '显示', '音效'])
    for (const label of ['使用统计', '声道', '气泡尺寸', '气泡速度', 'Coo 的名字', '称呼']) {
      assert.ok(!state.labels.includes(label), `${label} is omitted from settings`)
    }
    for (const label of ['语言', '大小', '字体尺寸', '外发光', '帧率', '位置', '音效', '分类', '呼噜时长']) {
      assert.ok(state.visibleLabels.includes(label), `${label} remains visible`)
    }
    assert.equal(state.scheme, 'coo-whale-claude')
    assert.equal(state.overflow, false)
  }
  await waitFor(() => evaluate('document.querySelectorAll(".featureslot-pet > .sheet").length'),
    (count) => count === 3, 'habits sections ready')
  await checkHabits()
  await evaluate('localStorage.setItem("companion.mode","advanced");void 0')
  contents.reload()
  await waitFor(() => evaluate('document.querySelectorAll(".featureslot-pet > .sheet").length'),
    (count) => count === 3, 'old advanced preference returns to compact settings')
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
    window.setMinimumSize(375, 560)
    for (const width of [375, 768, 1024, 1440]) for (const appearance of ['light', 'dark']) {
      window.setContentSize(width, 760)
      await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: appearance }] })
      await waitFor(() => evaluate('document.documentElement.dataset.colorMode'), (value) => value === appearance, 'theme follows system')
      await checkHabits()
      if (width === 1024) fs.writeFileSync(path.join(directory, `companion-settings-${appearance}.png`), (await contents.capturePage()).toPNG())
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
    await evaluate('fetch("/api/theme",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({selectedId:"navigator",mode:"light",custom:[]})}).then(r=>{if(!r.ok)throw Error("theme save failed")})')
    await waitFor(() => evaluate('document.documentElement.dataset.themeScheme'), (value) => value === 'navigator', 'explicit palette remains selectable')
  } finally {
    contents.debugger.detach()
  }
  // Restart the actual Core to check that the default does not replace an explicit palette.
  const port = companion.status().port
  await evaluate('fetch("/api/run/restart",{method:"POST"}).then(r=>{if(!r.ok)throw Error("restart failed")})')
  await waitFor(() => companion.status(), (value) => value.state !== 'running' || value.port !== port, 'Core begins restarting')
  await waitFor(() => companion.status(), (value) => value.state === 'running', 'Core restarted')
  await waitFor(() => evaluate('document.documentElement.dataset.themeScheme'), (value) => value === 'navigator', 'explicit palette survives Core restart')
  const persisted = JSON.parse(fs.readFileSync(path.join(data, 'home/companion/theme.json'), 'utf8'))
  assert.equal(persisted.selectedId, 'navigator')
  await waitFor(() => companion.panel('state'), (value) => value?.connected && value.skin.figure === 'minduck-duck', 'default duck reconnects')
  console.log('PASS: compact settings and field visibility, stale advanced/routes, 4 widths/light-dark, native navigation, filtered dress picker, explicit theme survives restart')
}
