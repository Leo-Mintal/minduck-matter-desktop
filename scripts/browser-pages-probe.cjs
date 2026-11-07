const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { webContents, nativeImage } = require('electron')

async function assertViewport(contents, width) {
  await contents.debugger.sendCommand('Emulation.setDeviceMetricsOverride', {
    width, height: 650, deviceScaleFactor: 1, mobile: false,
  })
  const dimensions = await contents.executeJavaScript(`({ width: innerWidth, scroll: document.body.scrollWidth,
    clipped: [...document.querySelectorAll('button,input,[role=combobox]')].some((element) => {
      const bounds=element.getBoundingClientRect(); return bounds.left < 0 || bounds.right > innerWidth;
    }) })`)
  assert.ok(dimensions.scroll <= dimensions.width && !dimensions.clipped, JSON.stringify(dimensions))
  const labelsFit = await contents.executeJavaScript('[...document.querySelectorAll(".browser-settings section > div:first-child")].every((item) => item.getBoundingClientRect().width >= 120)')
  assert.ok(labelsFit, `Settings labels must remain readable at ${width}px`)
  const contrast = await contents.executeJavaScript(`(() => {
    const heading=document.querySelector('.browser-settings h1');
    if(!heading)return true;
    const average=(value)=>value.match(/\\d+/g).slice(0,3).reduce((sum,part)=>sum+Number(part),0)/3;
    return Math.abs(average(getComputedStyle(document.body).backgroundColor)-average(getComputedStyle(heading).color))>120;
  })()`)
  assert.ok(contrast, 'Settings background and heading have readable contrast')
}

async function capture(contents, file) {
  await contents.executeJavaScript('Promise.all(document.getAnimations().filter((item) => item.effect?.getComputedTiming().iterations !== Infinity).map((item) => item.finished.catch(() => {})))')
  await contents.executeJavaScript('new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true))))')
  try { fs.writeFileSync(file, (await contents.capturePage()).toPNG()) }
  catch (error) { throw new Error(`Capture ${path.basename(file)}: ${error.message || error}`) }
}

function joinViews(toolbarFile, pageFile, output) {
  const toolbar = nativeImage.createFromBuffer(fs.readFileSync(toolbarFile))
  const page = nativeImage.createFromBuffer(fs.readFileSync(pageFile))
  assert.equal(toolbar.getSize().width, page.getSize().width)
  const size = { width: page.getSize().width, height: toolbar.getSize().height + page.getSize().height }
  fs.writeFileSync(output, nativeImage.createFromBitmap(Buffer.concat([toolbar.toBitmap(), page.toBitmap()]), size).toPNG())
}

async function verifyNewTab({ chrome, state, waitFor, temporary }) {
  const page = await waitFor(() => webContents.getAllWebContents().find((item) => item.getURL().includes('surface=newtab')),
    Boolean, 'local new-tab contents')
  await waitFor(() => page.executeJavaScript('Boolean(document.querySelector("#new-tab-search"))'), Boolean, 'local search renders')
  assert.deepEqual(await page.executeJavaScript(`({ node: typeof require, shell: typeof minduckBrowserShell,
    settings: typeof minduckBrowserSettings, title: document.title })`),
  { node: 'undefined', shell: 'undefined', settings: 'undefined', title: '新标签页' })
  assert.equal(await chrome.executeJavaScript('document.body.innerText.includes("DuckAI") || [...document.querySelectorAll("button")].some((item) => item.title.includes("助手"))'), false)
  page.debugger.attach('1.3')
  chrome.debugger.attach('1.3')
  const toolbarHeight = await chrome.executeJavaScript('Math.ceil(document.querySelector(".desktop-chrome").getBoundingClientRect().height)')
  await chrome.debugger.sendCommand('Emulation.setDeviceMetricsOverride', {
    width: 530, height: toolbarHeight, deviceScaleFactor: 1, mobile: false,
  })
  const matter = webContents.getAllWebContents().find((item) => item.getURL().startsWith(process.env.MINDUCK_MATTER_ORIGIN))
  for (const theme of ['light', 'dark']) {
    await matter.executeJavaScript(`document.documentElement.dataset.theme='${theme}'`)
    await waitFor(state, (value) => value.theme === theme, 'new-tab theme follows Matter')
    await waitFor(() => chrome.executeJavaScript('document.documentElement.dataset.theme'), (value) => value === theme, 'chrome theme')
    await waitFor(() => page.executeJavaScript('document.documentElement.dataset.theme'), (value) => value === theme, 'new-tab theme')
    for (const width of [375, 768, 1024, 1440]) await assertViewport(page, width)
    await assertViewport(page, 530)
    await capture(page, path.join(temporary, `newtab-${theme}.png`))
    await capture(chrome, path.join(temporary, `newtab-chrome-${theme}.png`))
    joinViews(path.join(temporary, `newtab-chrome-${theme}.png`), path.join(temporary, `newtab-${theme}.png`),
      path.join(temporary, `browser-${theme}.png`))
  }
  let navigation
  const intercept = (event, url) => { navigation = event.url || url; event.preventDefault() }
  page.on('will-navigate', intercept)
  await page.executeJavaScript('document.querySelector("#new-tab-search").focus()')
  await page.debugger.sendCommand('Input.insertText', { text: '测试 & search' })
  await page.executeJavaScript('document.querySelector(".browser-search").requestSubmit()')
  await waitFor(() => navigation, Boolean, 'new-tab search submit')
  assert.equal(new URL(navigation).origin, 'https://www.bing.com')
  assert.equal(new URL(navigation).searchParams.get('q'), '测试 & search')
  page.removeListener('will-navigate', intercept)
  page.debugger.detach()
  chrome.debugger.detach()
  await waitFor(state, (value) => value.tabs.length === 1, 'new-tab remains a browser-owned tab')
  console.log('PASS local search: sandbox isolation, real search submission, four viewport widths, light/dark')
}

async function verifySettings({ command, waitFor, temporary }) {
  await command('open-browser-settings')
  const page = await waitFor(() => webContents.getAllWebContents().find((item) => item.getURL().includes('surface=settings')),
    Boolean, 'browser settings contents')
  await waitFor(() => page.executeJavaScript('Boolean(document.querySelector("[aria-label=默认搜索引擎]:not([disabled])"))'),
    Boolean, 'preferences loaded')
  page.debugger.attach('1.3')
  for (const theme of ['light', 'dark']) {
    await page.executeJavaScript(`document.documentElement.dataset.theme='${theme}'`)
    for (const width of [375, 768, 1024, 1440]) await assertViewport(page, width)
    await assertViewport(page, 560)
    await capture(page, path.join(temporary, `settings-${theme}.png`))
  }
  await page.executeJavaScript('document.querySelector("[aria-label=默认搜索引擎]").click()')
  await waitFor(() => page.executeJavaScript('document.querySelectorAll("[role=option]").length'), (count) => count === 2, 'search engine options')
  await page.executeJavaScript('[...document.querySelectorAll("[role=option]")].find((item)=>item.textContent.trim()==="Google").click()')
  await page.executeJavaScript('[...document.querySelectorAll("button")].find((item)=>item.textContent.trim()==="保存设置").click()')
  await waitFor(() => page.executeJavaScript('document.querySelector(".browser-settings-status").textContent'),
    (text) => text.includes('已保存'), 'settings saved through UI')
  assert.equal(JSON.parse(fs.readFileSync(path.join(temporary, 'browser-preferences.json'), 'utf8')).browserSearchEngine, 'google')
  const browser = webContents.getAllWebContents().find((item) => item.getURL().includes('surface=newtab'))
  assert.ok(browser, 'local new tab remains open')
  await waitFor(() => new URL(browser.getURL()).searchParams.get('engine'), (engine) => engine === 'google', 'new tab receives saved engine')
  if (browser) {
    await browser.session.cookies.set({ url: 'https://browser.smoke.invalid', name: 'saved-login', value: 'kept' })
    await page.executeJavaScript('[...document.querySelectorAll("button")].find((item)=>item.textContent.trim()==="清除缓存").click()')
    await waitFor(() => page.executeJavaScript('document.querySelector(".browser-settings-status").textContent'),
      (text) => text.includes('已清除'), 'clear cache through UI')
    assert.equal((await browser.session.cookies.get({ name: 'saved-login' }))[0]?.value, 'kept')
  }
  page.debugger.detach()
  await page.executeJavaScript('minduckBrowserSettings.close()')
  await waitFor(() => page.isDestroyed(), Boolean, 'settings close')
  await command('open-browser-settings')
  const reopened = await waitFor(() => webContents.getAllWebContents().find((item) => item.getURL().includes('surface=settings')),
    Boolean, 'reopen settings')
  await waitFor(() => reopened.executeJavaScript('minduckBrowserSettings.get()'), (value) => value?.browserSearchEngine === 'google', 'persisted search engine')
  await reopened.executeJavaScript('minduckBrowserSettings.close()')
  console.log('PASS settings: UI save, persistent reopen, clear-cache preserves login, four viewport widths, light/dark')
}

module.exports = { verifyNewTab, verifySettings }
