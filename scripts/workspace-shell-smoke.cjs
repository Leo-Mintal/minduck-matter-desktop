// Real Electron host + production Web bundle, with an isolated account/API fixture.
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const preview = process.argv.includes('--preview')
const visible = preview || process.argv.includes('--visible')
if (!process.versions.electron) {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'minduck-workspace-smoke-'))
  const result = require('node:child_process').spawnSync(require('electron'), [__filename, temporary, ...(preview ? ['--preview'] : []), ...(visible ? ['--visible'] : [])], {
    stdio: 'inherit', timeout: preview ? undefined : 120_000,
  })
  fs.rmSync(path.join(temporary, 'profile'), { recursive: true, force: true })
  if (result.error) console.error(result.error)
  process.exit(result.status ?? 1)
}
const assert = require('node:assert/strict')
const http = require('node:http')
const electron = require('electron')
const { app, BrowserWindow, webContents } = electron
const temporary = process.argv[2]
const root = path.resolve(__dirname, '..')
process.env.MINDUCK_USER_DATA_DIR = path.join(temporary, 'profile')
app.setAppPath(root)
let settingsOpened = 0
let access, finishActivation, accessFailure, gateShows = 0, petStarts = 0, petStops = 0
const companion = { start: async () => {
  assert.equal(access.snapshot().status, 'active', 'the pet starts only after activation is confirmed')
  petStarts++
}, stop: async () => { petStops++ }, setTaskOutput() {},
  openSettings() { settingsOpened++ }, show: async () => {}, hide: async () => {} }
const user = { id: 'user_workspace_fixture', name: '导航测试用户', email: 'workspace@example.invalid', locale: 'zh-CN' }
const organization = { id: 'org_workspace_fixture', name: '导航测试用户', kind: 'personal', owner_user_id: user.id, status: 'active', role: 'owner' }
const server = http.createServer((request, response) => {
  const pathname = new URL(request.url, 'http://localhost').pathname
  const fixtures = {
    '/api/desktop-access/policy': { protocol: 1, required: false },
    '/api/me': user, '/api/teams': { teams: [] }, '/api/conversations': { conversations: [] },
    '/api/me/changelog': { unread: false }, '/api/models': { models: [] },
    '/api/billing/overview': { balance: { available: 1000000, held: 0 }, pools: [], channels: [],
      agreement: null, current_subscription: null, scheduled_subscriptions: [], unread_notifications: 0 },
    '/api/me/orgs': { orgs: [organization], current_org_id: organization.id },
    '/api/orgs/org_workspace_fixture/spaces': { spaces: [{id:'space_fixture',org_id:organization.id,name:'默认空间',is_default:true}] },
    '/api/knowledge/binding': { connected:false,can_manage:true,knowledge_org_id:'',revision:0 },
  }
  response.writeHead(pathname in fixtures ? 200 : 404, { 'Content-Type': 'application/json' })
  response.end(JSON.stringify(fixtures[pathname] || { error: 'fixture_not_configured' }))
})
async function waitFor(read, predicate, label) {
  const deadline = Date.now() + 15000
  let value
  while (Date.now() < deadline) {
    value = await read()
    if (predicate(value)) return value
    await new Promise(resolve => setTimeout(resolve, 40))
  }
  throw new Error(`Timed out: ${label}; last: ${JSON.stringify(value)}`)
}
async function run() {
  if (!preview) setTimeout(() => { console.error('Workspace smoke exceeded its 60-second deadline'); app.exit(1) }, 60_000).unref()
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const origin = `http://127.0.0.1:${server.address().port}`
  process.env.MINDUCK_MATTER_ORIGIN = origin
  const originalLoad = require('node:module')._load
  const testElectron = Object.create(electron)
  function TestWindow(options) { return new BrowserWindow({ ...options, ...(visible ? { x: 0, y: 0 } : { x: -2000, y: 0 }) }) }
  Object.setPrototypeOf(TestWindow, BrowserWindow)
  Object.defineProperty(testElectron, 'BrowserWindow', { value: TestWindow })
  require('node:module')._load = function (request, ...args) {
    if (request.endsWith('/companion/index.cjs')) return { createCompanion: () => companion }
    if (request === './desktop-access/service.cjs') return { createService: () => ({
      policy: async () => true,
      restore: async () => { throw Object.assign(new Error('Fixture unactivated'), { code: 'device_unactivated' }) },
      activate: () => new Promise(resolve => { finishActivation = resolve }),
      renew: async () => { if (accessFailure) throw accessFailure },
      prepareAuth: request => request, runtimeProof: async () => undefined,
    }) }
    if (request === './desktop-access/gate.cjs') return { createGate: options => {
      access = options.controller
      return { show() { gateShows++ }, dispose() {} }
    } }
    if (request === './client-runtime.cjs') {
      const runtime = originalLoad.call(this, request, ...args)
      return { ...runtime, createClientRuntime: options => runtime.createClientRuntime({ ...options, bridgePort: 0 }) }
    }
    return request === 'electron' ? testElectron : originalLoad.call(this, request, ...args)
  }
  try { require('../src/main.cjs') } finally { require('node:module')._load = originalLoad }
  await waitFor(() => access?.snapshot().status, value => value === 'unactivated', 'unactivated startup')
  const appMenu = electron.Menu.getApplicationMenu().items[0].submenu.items
  const settingsMenu = appMenu.find(item => item.label === '设置…')
  assert.ok(settingsMenu && settingsMenu.accelerator === 'CmdOrCtrl+,')
  assert.ok(appMenu.findIndex(item => item.label === '设置…') < appMenu.findIndex(item => item.label === '检查更新…'))
  assert.ok(appMenu.some(item => item.role === 'about' && item.label === '关于 Minduck Matter'))
  for (const label of ['桌宠设置…', '显示桌宠', '隐藏桌宠', '完全磁盘访问授权...']) {
    assert.ok(!appMenu.some(item => item.label === label), `${label} removed`)
  }
  settingsMenu.click()
  app.emit('activate')
  assert.ok(gateShows >= 2, 'settings and Dock activation return to the gate')
  assert.equal(BrowserWindow.getAllWindows().length, 0)
  assert.equal(petStarts, 0, 'an unactivated client creates no pet')
  const activation = access.activate('ABC234')
  await waitFor(() => finishActivation, Boolean, 'fixture activation pending')
  assert.equal(access.snapshot().status, 'checking')
  assert.equal(petStarts, 0, 'the pet stays absent while activation is pending')
  finishActivation()
  await activation
  await waitFor(() => petStarts, value => value === 1, 'pet starts after confirmed activation')
  console.log('PASS: no pet or business window before activation; pending activation stays hidden; confirmed activation starts the pet exactly once')
  const matter = await waitFor(() => webContents.getAllWebContents().find(item => item.getURL().startsWith(origin)), Boolean, 'Matter view')
  const execute = matter.executeJavaScript.bind(matter)
  matter.executeJavaScript = async (source, userGesture = false) => {
    let timeout
    try {
      return await Promise.race([execute(source, userGesture), new Promise((_, reject) => {
        timeout = setTimeout(() => reject(new Error('Renderer probe timed out')), 5000)
      })])
    } catch (error) {
      throw new Error(`Renderer probe failed: ${source.slice(0, 220)}`, { cause: error })
    } finally { clearTimeout(timeout) }
  }
  await waitFor(() => matter.executeJavaScript('!!document.querySelector(".desktop-workspace")'), Boolean, 'shared workspace')
  const payload = Buffer.from(JSON.stringify({ uid: user.id, exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url')
  await matter.executeJavaScript(`localStorage.setItem('matter.token', 'fixture.${payload}.fixture'); localStorage.setItem('matter.coached.${user.id}', '1'); localStorage.setItem('matter.sidebars', JSON.stringify({lOpen:true}))`)
  matter.reload()
  await waitFor(() => matter.executeJavaScript('document.querySelectorAll(".desktop-workspace-navigation .fn-row").length'), value => value >= 3, 'migrated navigation')
  const window = await waitFor(() => BrowserWindow.getAllWindows().find(item => item.contentView.children.length >= 5), Boolean, 'main window')
  if (visible) window.show()
  const frames = () => window.contentView.children
  const matterFrame = frames().find(view => view.children?.some(child => child.webContents === matter))
  assert.equal(matterFrame.getBounds().x, 0, 'native view includes the shared rail')
  // Native occlusion can suspend renderer rAF even when the DOM is queryable.
  const frame = async () => {
    await new Promise(resolve => setTimeout(resolve, 32))
    await matter.executeJavaScript('document.documentElement.getBoundingClientRect().width')
  }
  const settle = async () => {
    // Reapply after native view visibility changes so occlusion cannot freeze CSS transitions.
    matter.setBackgroundThrottling(false)
    await waitFor(() => matter.executeJavaScript(`document.getAnimations().filter(item =>
      item.playState === 'running' && item.effect?.getTiming().iterations !== Infinity).length`),
    count => count === 0, 'workspace animation settled')
    await frame()
  }
  await waitFor(() => matter.executeJavaScript('document.querySelector(".side-foot")?.getAttribute("aria-label")'), value => value?.includes(user.name), 'account data')
  const railIcons = await matter.executeJavaScript(`Array.from(document.querySelectorAll(
    '.desktop-workspace-navigation .row-icon, .desktop-workspace-tools .ui-icon'
  ), icon => { const rect = icon.getBoundingClientRect(); return { width: rect.width, height: rect.height }; })`)
  assert.ok(railIcons.length >= 7, 'navigation and native tool icons are present')
  for (const size of railIcons) assert.deepEqual(size, { width: 20, height: 20 }, 'rail icons match the supplied 20px artwork')
  const railGeometry = await matter.executeJavaScript(`(() => {
    const rail = document.querySelector('.desktop-workspace-rail').getBoundingClientRect();
    return { width: rail.width, border: getComputedStyle(document.querySelector('.desktop-workspace-rail')).borderInlineEndWidth,
      rows: [...document.querySelectorAll('.desktop-workspace-navigation .fn-row')].map(row => {
      const r = row.getBoundingClientRect();
      return { x: r.left - rail.left, y: r.top - rail.top, width: r.width, height: r.height,
        radius: getComputedStyle(row).borderRadius };
    }), home: document.querySelector('.desktop-workspace-navigation .row-icon').src };
  })()`)
  assert.equal(railGeometry.width, 49)
  assert.equal(railGeometry.border, '0px', 'no divider between the navigation rail and chat list')
  railGeometry.rows.forEach((row, index) => assert.deepEqual(row,
    { x: 4, y: 8 + index * 38, width: 40, height: 36, radius: '10px' }, 'navigation keeps a 2px gap'))
  assert.match(await matter.executeJavaScript(`fetch(${JSON.stringify(railGeometry.home)}).then(r => r.text())`),
    /M10 17\.5C14\.1421 17\.5/, 'home uses the supplied circular message icon')
  console.log('PASS: shared rail geometry, 2px gaps and no divider')
  if (preview) {
    window.setTitle('Minduck 导航测试预览')
    window.setContentSize(1280, 820)
    window.center()
    window.show()
    window.focus()
    matter.focus()
    const capturePreview = async name => {
      await waitFor(() => matter.executeJavaScript(`document.getAnimations().filter(item =>
        item.playState === 'running' && item.effect?.getTiming().iterations !== Infinity).length`),
      count => count === 0, 'preview animation settled')
      await frame()
      const errors = await matter.executeJavaScript(`JSON.parse(localStorage.getItem('matter.render-errors.v1') || '[]').map(({message, componentStack}) => ({message,componentStack}))`)
      assert.deepEqual(errors, [], 'preview pages must render successfully')
      fs.writeFileSync(path.join(temporary, `${name}.png`), (await matter.capturePage()).toPNG())
    }
    await capturePreview('preview-home')
    await matter.executeJavaScript('document.querySelector(".side-foot").click()')
    await waitFor(() => matter.executeJavaScript('!!document.querySelector(".acct-menu")'), Boolean, 'preview account panel')
    await capturePreview('preview-account')
    await matter.executeJavaScript('document.body.click()')
    await waitFor(() => matter.executeJavaScript('!!document.querySelector(".acct-menu")'), value => !value, 'preview account closed')
    await matter.executeJavaScript(`document.querySelector('.desktop-workspace-navigation [aria-label="组织与成员"]').click()`)
    await waitFor(() => matter.executeJavaScript('location.pathname'), value => value === '/settings/org', 'preview organization route')
    await capturePreview('preview-feature')
    await matter.executeJavaScript(`document.querySelector('.desktop-workspace-navigation [aria-label="首页"]').click()`)
    await waitFor(() => matter.executeJavaScript('location.pathname'), value => value === '/', 'preview restored home')
    await frame()
    console.log('Preview screenshots:', temporary)
    console.log('PREVIEW: isolated navigation fixture is ready; no live account or task data.')
    return
  }
  const before = await matter.executeJavaScript('performance.timeOrigin')
  const routes = [['资产', '/library'], ['扩展', '/settings/ext'], ['组织与成员', '/settings/org'], ['智能体', '/settings/apis']]
  const knowledgeLabel = await matter.executeJavaScript(`document.querySelector('.desktop-workspace-navigation [aria-label="知识库"]')?.getAttribute('aria-label')`)
  if (knowledgeLabel) routes.push([knowledgeLabel, '/knowledge-results'])
  for (const [label, route] of routes) {
    await matter.executeJavaScript(`document.querySelector('.desktop-workspace-navigation [aria-label="${label}"]').click()`)
    await waitFor(() => matter.executeJavaScript('location.pathname'), value => value === route, label)
    assert.ok(await matter.executeJavaScript('document.querySelectorAll(".desktop-workspace-navigation .fn-row").length >= 3'))
    await waitFor(() => matter.executeJavaScript(`getComputedStyle(document.querySelector('.side-primary')).visibility`), value => value === 'hidden', 'home sidebar hidden on feature routes')
    assert.equal(await matter.executeJavaScript(`document.querySelector('.desktop-workspace-navigation [aria-label="${label}"]').getAttribute('aria-current')`), 'page')
    assert.equal(await matter.executeJavaScript('performance.timeOrigin'), before, 'navigation must not reload the document')
    assert.deepEqual(await matter.executeJavaScript(`JSON.parse(localStorage.getItem('matter.render-errors.v1') || '[]').map(({message}) => message)`), [], 'feature routes render successfully')
  }
  await matter.executeJavaScript(`document.querySelector('.desktop-workspace-navigation [aria-label="首页"]').click()`)
  await waitFor(() => matter.executeJavaScript('location.pathname'), value => value === '/', 'home route')
  assert.equal(await matter.executeJavaScript(`getComputedStyle(document.querySelector('.side-primary')).visibility`), 'visible')
  assert.equal(await matter.executeJavaScript(`document.querySelector('.side-primary [aria-label="智能体"]')`), null)
  await matter.executeJavaScript(`document.querySelector('.newbtn[aria-label="和 Matter 聊天"]').click()`)
  await frame()
  console.log('PASS: feature routes and new-chat navigation')
  const chrome = await waitFor(() => webContents.getAllWebContents().find(item => item.getURL().includes('surface=chrome')), Boolean, 'browser chrome')
  const browserState = () => chrome.executeJavaScript('minduckBrowserShell.getState()')
  const panelSettled = open => waitFor(browserState, state => state.rightPanelOpen === open && !state.panelMotion, `browser ${open ? 'restored' : 'hidden'}`)
  const navigate = async (label, pathname) => {
    await matter.executeJavaScript(`document.querySelector('.desktop-workspace-navigation [aria-label="${label}"]').click()`, true)
    await waitFor(() => matter.executeJavaScript('location.pathname'), value => value === pathname, `context route ${pathname}`)
  }
  const sidebarGeometry = () => matter.executeJavaScript(`(() => {
    const side = document.querySelector('.side-primary');
    const mark = side.querySelector('.scope-mark').getBoundingClientRect();
    const logo = side.querySelector('.scope-logo-image').getBoundingClientRect();
    const action = side.querySelector('.newbtn').getBoundingClientRect();
    return { collapsed: side.classList.contains('is-collapsed'),
      markCenter: mark.left + mark.width / 2, logoCenter: logo.left + logo.width / 2,
      actionCenter: action.left + action.width / 2,
      logoMiddle: logo.top + logo.height / 2, markMiddle: mark.top + mark.height / 2,
      preferredOpen: JSON.parse(localStorage.getItem('matter.sidebars')).lOpen };
  })()`)
  window.setContentSize(2200, 900)
  await settle()
  assert.equal((await sidebarGeometry()).collapsed, false, 'wide conversation starts with the saved expanded sidebar')
  await window.webContents.executeJavaScript('document.querySelector("#browser-toggle").click()')
  const opened = await panelSettled(true)
  console.log('PASS: browser opens and native panel motion settles')
  await waitFor(sidebarGeometry, value => value.collapsed, 'browser forces the sidebar to collapse even in a wide viewport')
  console.log('PASS: wide conversation sidebar collapses')
  const retainedBrowser = await waitFor(() => webContents.getAllWebContents().find(item => item.getURL().includes('surface=newtab')), Boolean, 'retained browser page')
  const browserTimeOrigin = await retainedBrowser.executeJavaScript('performance.timeOrigin')
  const assertLogoCentered = async () => {
    await settle()
    const geometry = await sidebarGeometry()
    assert.ok(Math.abs(geometry.markCenter - geometry.logoCenter) < 0.5, `logo is centered inside its action: ${JSON.stringify(geometry)}`)
    assert.ok(Math.abs(geometry.markMiddle - geometry.logoMiddle) < 0.5, `logo is vertically centered: ${JSON.stringify(geometry)}`)
    // The chat sidebar's 1px border gives its full-width action an odd pixel width.
    assert.ok(Math.abs(geometry.actionCenter - geometry.logoCenter) <= 0.5, `logo aligns with the collapsed action icons: ${JSON.stringify(geometry)}`)
    assert.equal(geometry.preferredOpen, true, 'temporary collapse does not overwrite the saved sidebar preference')
  }
  await assertLogoCentered()
  console.log('PASS: wide logo aligns without overwriting the sidebar preference')
  for (const [label, pathname] of routes) {
    console.log('Checking browser context:', pathname)
    await navigate(label, pathname)
    const hidden = await panelSettled(false)
    assert.equal(hidden.activeTabId, opened.activeTabId)
    assert.deepEqual(hidden.tabs.map(tab => tab.id), opened.tabs.map(tab => tab.id), 'feature navigation retains browser tabs')
    await navigate('首页', '/')
    const restored = await panelSettled(true)
    assert.equal(restored.activeTabId, opened.activeTabId)
  }
  assert.equal(retainedBrowser.isDestroyed(), false, 'the browser page survives route changes')
  assert.equal(await retainedBrowser.executeJavaScript('performance.timeOrigin'), browserTimeOrigin, 'route restoration does not reload the browser page')
  await navigate('资产', '/library')
  await panelSettled(false)
  await window.webContents.executeJavaScript('minduckDesktopFrame.command("matter-go-back")')
  await waitFor(() => matter.executeJavaScript('location.pathname'), value => value === '/', 'back returns to conversation')
  await panelSettled(true)
  await window.webContents.executeJavaScript('minduckDesktopFrame.command("matter-go-forward")')
  await waitFor(() => matter.executeJavaScript('location.pathname'), value => value === '/library', 'forward returns to feature page')
  await panelSettled(false)
  await navigate('首页', '/')
  await panelSettled(true)
  window.setContentSize(1280, 800)
  await panelSettled(true)
  await assertLogoCentered()
  for (const theme of ['light', 'dark']) {
    await matter.executeJavaScript(`document.documentElement.dataset.theme = '${theme}'`)
    await matter.executeJavaScript(`document.activeElement?.blur();
      document.querySelector('.desktop-workspace-rail').dispatchEvent(new Event('pointerleave'))`)
    await settle()
    await waitFor(() => chrome.executeJavaScript('document.documentElement.dataset.theme'), value => value === theme, 'browser theme')
    const newTab = webContents.getAllWebContents().find(item => item.getURL().includes('surface=newtab'))
    assert.ok(newTab, 'browser start page is present')
    await waitFor(() => newTab.executeJavaScript('document.documentElement.dataset.theme'), value => value === theme, 'start page theme')
    const conversationColor = await matter.executeJavaScript(`getComputedStyle(document.querySelector('.app')).backgroundColor`)
    assert.equal(await newTab.executeJavaScript(`getComputedStyle(document.querySelector('.browser-new-tab')).backgroundColor`),
      conversationColor, 'browser start page matches the actual conversation background')
    fs.writeFileSync(path.join(temporary, `browser-open-${theme}.png`), (await matter.capturePage()).toPNG())
  }
  await chrome.executeJavaScript('minduckBrowserShell.command({type:"close-panel"})')
  await panelSettled(false)
  await settle()
  assert.equal((await sidebarGeometry()).collapsed, false, 'closing the browser restores the saved expanded sidebar')
  await navigate('资产', '/library')
  await panelSettled(false)
  await navigate('首页', '/')
  await panelSettled(false)
  assert.equal((await browserState()).activeTabId, opened.activeTabId, 'manual collapse retains the tab without reopening it')
  window.setMinimumSize(0, 0)
  for (const width of [375, 768, 1024, 1440]) for (const theme of ['light', 'dark']) {
    window.setContentSize(width, 800)
    await matter.executeJavaScript(`document.documentElement.dataset.theme = '${theme}'`)
    await frame()
    await matter.executeJavaScript('document.querySelector(".side-foot").click()')
    await waitFor(() => matter.executeJavaScript('!!document.querySelector(".acct-menu")'), Boolean, 'account menu')
    const geometry = await matter.executeJavaScript(`(() => {
      const menu = document.querySelector('.acct-menu'), avatar = document.querySelector('.side-foot');
      const rect = menu.getBoundingClientRect(), button = avatar.getBoundingClientRect();
      return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom,
        avatarBottom: button.bottom, viewport: innerWidth, height: innerHeight,
        onTop: menu.contains(document.elementFromPoint(rect.left + 20, rect.top + 20)),
        innerDuplicates: document.querySelectorAll('.side-primary .side-foot, .side-primary .fn-row[aria-label="资产"]').length,
        businessLeft: document.querySelector('.desktop-workspace-content').getBoundingClientRect().left,
        businessWidth: document.querySelector('.desktop-workspace-content').getBoundingClientRect().width,
        railColor: getComputedStyle(document.querySelector('.desktop-workspace-rail')).backgroundColor,
        selectedColor: getComputedStyle(document.querySelector('.desktop-workspace-navigation .fn-row.on')).backgroundColor,
        avatarWidth: document.querySelector('.side-foot .avatar-initials').getBoundingClientRect().width,
        selectedIconFilter: getComputedStyle(document.querySelector('.desktop-workspace-navigation .fn-row.on .row-icon')).filter };
    })()`)
    assert.equal(geometry.innerDuplicates, 0)
    assert.equal(geometry.viewport, matterFrame.getBounds().width, 'visible renderer matches native width')
    assert.equal(geometry.businessLeft, 49)
    assert.equal(geometry.businessWidth, matterFrame.getBounds().width - 49, 'business geometry excludes exactly one rail')
    assert.ok(geometry.left >= 49 && geometry.right <= geometry.viewport, JSON.stringify(geometry))
    assert.equal(geometry.railColor, theme === 'light' ? 'rgb(247, 247, 247)' : 'rgb(32, 34, 34)')
    assert.equal(geometry.selectedColor, theme === 'light' ? 'rgb(231, 231, 231)' : 'rgb(54, 56, 56)')
    assert.equal(geometry.avatarWidth, 24)
    assert.equal(geometry.selectedIconFilter, theme === 'light' ? 'brightness(0) invert(0.431373)' : 'brightness(0) invert(1)')
    assert.ok(geometry.top >= 0 && geometry.bottom <= geometry.height && geometry.avatarBottom > geometry.height - 12)
    assert.equal(geometry.onTop, true, 'account panel is clickable above the content')
    await frame()
    if (width === 1440) {
      await settle()
      fs.writeFileSync(path.join(temporary, `workspace-${theme}.png`), (await matter.capturePage()).toPNG())
    }
    await matter.executeJavaScript('document.body.click()')
    await waitFor(() => matter.executeJavaScript('!!document.querySelector(".acct-menu")'), value => !value, 'account menu closed')
  }
  const tooltipAnchor = await matter.executeJavaScript(`(() => {
    document.activeElement?.blur();
    const r=document.querySelector('.desktop-workspace-navigation [aria-label=资产]').getBoundingClientRect();
    return {x:r.x+r.width/2,y:r.y+r.height/2};
  })()`)
  matter.sendInputEvent({type:'mouseMove',x:2,y:2})
  matter.sendInputEvent({type:'mouseMove',x:Math.round(tooltipAnchor.x),y:Math.round(tooltipAnchor.y)})
  await waitFor(() => matter.executeJavaScript('document.querySelector("[role=tooltip]")?.textContent'), value => value === '资产', 'shared tooltip')
  const tooltip = await matter.executeJavaScript(`(() => { const r = document.querySelector('[role=tooltip]').getBoundingClientRect();
    return { left: r.left, right: r.right, width: innerWidth }; })()`)
  assert.ok(tooltip.left >= 49 && tooltip.right <= tooltip.width)
  await matter.executeJavaScript('minduckWorkspaceShell.command("companion-settings")')
  await waitFor(() => settingsOpened, value => value === 1, 'allow-listed native command')
  assert.equal(await matter.executeJavaScript('typeof require'), 'undefined')
  await matter.executeJavaScript('document.querySelector(".side-foot").click()')
  await waitFor(() => matter.executeJavaScript('!!document.querySelector(".acct-menu")'), Boolean, 'account menu reopened')
  await matter.executeJavaScript('document.querySelector(".acct-menu-item--settings").click()')
  await waitFor(() => matter.executeJavaScript('location.pathname'), value => value === '/settings/acct', 'account settings')
  assert.ok(await matter.executeJavaScript('!!document.querySelector(".desktop-workspace-navigation .fn-row")'), 'global navigation persists in settings')
  assert.ok(await matter.executeJavaScript(`!!document.querySelector('.side-primary .settings-nav') || getComputedStyle(document.querySelector('.side-primary')).visibility === 'visible'`), 'account settings retain their own secondary navigation')
  await matter.executeJavaScript("history.pushState(null,'','/new-chat');dispatchEvent(new PopStateEvent('popstate'))")
  settingsMenu.click()
  await waitFor(() => matter.executeJavaScript('location.pathname'), value => value === '/settings/acct', 'native menu opens real Web account settings')
  await waitFor(() => matter.executeJavaScript('document.querySelector(".account-page .account-name-input")?.value'),
    value => value === user.name, 'real Web account settings loads the signed-in user')
  fs.writeFileSync(path.join(temporary, 'native-web-settings.png'), (await matter.capturePage()).toPNG())
  fs.writeFileSync(path.join(temporary, 'application-menu.json'), JSON.stringify(appMenu.map(item => ({
    label: item.label, role: item.role, accelerator: item.accelerator,
  })), null, 2) + '\n')
  assert.equal(settingsOpened, 1, 'native settings menu does not open pet settings')
  accessFailure = Object.assign(new Error('Fixture network outage'), { code: 'desktop_access_unavailable' })
  await access.check()
  assert.equal(petStarts, 1, 'a transient check does not start a duplicate pet')
  assert.equal(petStops, 0, 'an already activated session survives a transient outage')
  accessFailure = Object.assign(new Error('Fixture revoked'), { code: 'device_revoked' })
  await access.check()
  assert.equal(access.snapshot().status, 'revoked')
  assert.equal(petStops, 1, 'revocation stops the pet')
  app.emit('activate'); settingsMenu.click()
  assert.equal(petStarts, 1, 'blocked menu/Dock actions cannot restart the pet')
  assert.equal(BrowserWindow.getAllWindows().length, 0)
  console.log('PASS: Chinese About and Web settings menu, Cmd+, real settings route, removed pet/FDA entries, outage retention and revoked pet shutdown')
  console.log('PASS: real workspace/SPA routes/account panel/shared Tooltip/native UI bridge; 4 widths × 2 themes. Evidence:', temporary)
}
function finish(code) {
  server.closeAllConnections()
  server.close()
  app.once('will-quit', () => app.exit(code))
  app.quit()
  // Electron can retain child WebContentsViews after their parent window closes.
  setTimeout(() => app.exit(code), 8_000).unref()
}
app.on('will-quit', () => { server.closeAllConnections(); server.close() })
process.on('SIGTERM', () => finish(0))
run().then(() => { if (!preview) finish(0) }).catch(error => { console.error(error); finish(1) })
