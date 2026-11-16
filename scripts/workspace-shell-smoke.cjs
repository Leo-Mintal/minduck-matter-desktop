// Real Electron host + production Web bundle, with an isolated account/API fixture.
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const preview = process.argv.includes('--preview')
if (!process.versions.electron) {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'minduck-workspace-smoke-'))
  const result = require('node:child_process').spawnSync(require('electron'), [__filename, temporary, ...(preview ? ['--preview'] : [])], {
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
const companion = { start: async () => {}, stop: async () => {}, setTaskOutput() {},
  openSettings() { settingsOpened++ }, show: async () => {}, hide: async () => {} }
const user = { id: 'user_workspace_fixture', name: '导航测试用户', email: 'workspace@example.invalid', locale: 'zh-CN' }
const organization = { id: 'org_workspace_fixture', name: '导航测试用户', kind: 'personal', owner_user_id: user.id, status: 'active', role: 'owner' }
const server = http.createServer((request, response) => {
  const pathname = new URL(request.url, 'http://localhost').pathname
  const fixtures = {
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
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const origin = `http://127.0.0.1:${server.address().port}`
  process.env.MINDUCK_MATTER_ORIGIN = origin
  const originalLoad = require('node:module')._load
  const testElectron = Object.create(electron)
  function TestWindow(options) { return new BrowserWindow({ ...options, ...(preview ? {} : { x: -2000, y: 0 }) }) }
  Object.setPrototypeOf(TestWindow, BrowserWindow)
  Object.defineProperty(testElectron, 'BrowserWindow', { value: TestWindow })
  require('node:module')._load = function (request, ...args) {
    if (request.endsWith('/companion/index.cjs')) return { createCompanion: () => companion }
    return request === 'electron' ? testElectron : originalLoad.call(this, request, ...args)
  }
  try { require('../src/main.cjs') } finally { require('node:module')._load = originalLoad }
  const matter = await waitFor(() => webContents.getAllWebContents().find(item => item.getURL().startsWith(origin)), Boolean, 'Matter view')
  const execute = matter.executeJavaScript.bind(matter)
  matter.executeJavaScript = source => execute(source).catch(error => {
    throw new Error(`Renderer probe failed: ${source.slice(0, 220)}`, { cause: error })
  })
  await waitFor(() => matter.executeJavaScript('!!document.querySelector(".desktop-workspace")'), Boolean, 'shared workspace')
  const payload = Buffer.from(JSON.stringify({ uid: user.id, exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url')
  await matter.executeJavaScript(`localStorage.setItem('matter.token', 'fixture.${payload}.fixture'); localStorage.setItem('matter.coached.${user.id}', '1'); localStorage.setItem('matter.sidebars', JSON.stringify({lOpen:true}))`)
  matter.reload()
  await waitFor(() => matter.executeJavaScript('document.querySelectorAll(".desktop-workspace-navigation .fn-row").length'), value => value >= 3, 'migrated navigation')
  const window = await waitFor(() => BrowserWindow.getAllWindows().find(item => item.contentView.children.length >= 5), Boolean, 'main window')
  const frames = () => window.contentView.children
  const matterFrame = frames().find(view => view.children?.some(child => child.webContents === matter))
  assert.equal(matterFrame.getBounds().x, 0, 'native view includes the shared rail')
  const frame = () => matter.executeJavaScript('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
  await waitFor(() => matter.executeJavaScript('document.querySelector(".side-foot")?.getAttribute("aria-label")'), value => value?.includes(user.name), 'account data')
  const railIcons = await matter.executeJavaScript(`Array.from(document.querySelectorAll(
    '.desktop-workspace-navigation .row-icon, .desktop-workspace-tools .ui-icon'
  ), icon => { const rect = icon.getBoundingClientRect(); return { width: rect.width, height: rect.height }; })`)
  assert.ok(railIcons.length >= 7, 'navigation and native tool icons are present')
  for (const size of railIcons) assert.deepEqual(size, { width: 16, height: 16 }, 'rail icons match the 16px client toolbar icons')
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
        businessWidth: document.querySelector('.desktop-workspace-content').getBoundingClientRect().width };
    })()`)
    assert.equal(geometry.innerDuplicates, 0)
    assert.equal(geometry.viewport, matterFrame.getBounds().width, 'visible renderer matches native width')
    assert.equal(geometry.businessLeft, 36)
    assert.equal(geometry.businessWidth, matterFrame.getBounds().width - 36, 'business geometry excludes exactly one rail')
    assert.ok(geometry.left >= 36 && geometry.right <= geometry.viewport, JSON.stringify(geometry))
    assert.ok(geometry.top >= 0 && geometry.bottom <= geometry.height && geometry.avatarBottom > geometry.height - 12)
    assert.equal(geometry.onTop, true, 'account panel is clickable above the content')
    await frame()
    if (width === 1440) fs.writeFileSync(path.join(temporary, `workspace-${theme}.png`), (await matter.capturePage()).toPNG())
    await matter.executeJavaScript('document.body.click()')
    await waitFor(() => matter.executeJavaScript('!!document.querySelector(".acct-menu")'), value => !value, 'account menu closed')
  }
  matter.focus()
  await matter.executeJavaScript('document.activeElement?.blur(); document.querySelector(".desktop-workspace-navigation [aria-label=资产]").focus()')
  await waitFor(() => matter.executeJavaScript('document.querySelector("[role=tooltip]")?.textContent'), value => value === '资产', 'shared tooltip')
  const tooltip = await matter.executeJavaScript(`(() => { const r = document.querySelector('[role=tooltip]').getBoundingClientRect();
    return { left: r.left, right: r.right, width: innerWidth }; })()`)
  assert.ok(tooltip.left >= 36 && tooltip.right <= tooltip.width)
  await matter.executeJavaScript('minduckWorkspaceShell.command("companion-settings")')
  await waitFor(() => settingsOpened, value => value === 1, 'allow-listed native command')
  assert.equal(await matter.executeJavaScript('typeof require'), 'undefined')
  await matter.executeJavaScript('document.querySelector(".side-foot").click()')
  await waitFor(() => matter.executeJavaScript('!!document.querySelector(".acct-menu")'), Boolean, 'account menu reopened')
  await matter.executeJavaScript('document.querySelector(".acct-menu-item--settings").click()')
  await waitFor(() => matter.executeJavaScript('location.pathname'), value => value === '/settings/acct', 'account settings')
  assert.ok(await matter.executeJavaScript('!!document.querySelector(".desktop-workspace-navigation .fn-row")'), 'global navigation persists in settings')
  assert.ok(await matter.executeJavaScript(`!!document.querySelector('.side-primary .settings-nav') || getComputedStyle(document.querySelector('.side-primary')).visibility === 'visible'`), 'account settings retain their own secondary navigation')
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
