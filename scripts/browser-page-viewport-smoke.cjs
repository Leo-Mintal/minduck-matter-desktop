// Use a real native child viewport: offscreen views inherit the parent viewport.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const http = require('node:http')
const os = require('node:os')
const path = require('node:path')
const { app, BrowserWindow, View } = require('electron')
const { ElectronBrowserHost } = require('../src/electronBrowserHost.cjs')
const { AgentBrowserCompatibility } = require('../src/agentBrowserCompatibility.cjs')

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'minduck-page-viewport-'))
app.setPath('userData', temporary)
const server = http.createServer((request, response) => {
  response.setHeader('Content-Type', 'text/html; charset=utf-8')
  const authorStyle = request.url === '/author-clip' ? 'html { clip-path: inset(0); }' : ''
  const width = request.url === '/responsive' ? '100%' : '1800px'
  response.end(`<style>${authorStyle}
    body { margin: 0; background: white; }
    #wide { width: ${width}; height: 10000px; background: rgb(17, 170, 119); }
    #fixed { position: fixed; bottom: 24px; right: 24px; width: 100px; height: 40px; }
  </style><div id="wide">Wide scrolling document</div><button id="fixed">Fixed action</button>`)
})

async function waitFor(read, predicate, label) {
  const deadline = Date.now() + 10_000
  let value
  while (Date.now() < deadline) {
    value = await read()
    if (predicate(value)) return value
    await new Promise(resolve => setTimeout(resolve, 40))
  }
  throw new Error(`${label}: ${JSON.stringify(value)}`)
}

async function probe() {
  await app.whenReady()
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const url = `http://127.0.0.1:${server.address().port}`
  const window = new BrowserWindow({ width: 1520, height: 700, show: true, backgroundColor: '#202222' })
  const frame = new View()
  frame.setBorderRadius(12)
  window.contentView.addChildView(frame)
  const host = new ElectronBrowserHost({ rightPanelView: frame, onStateChange() {}, onLayoutChange() {}, onTabUpdated() {} })
  const view = host.createView('viewport-smoke')
  host.addTab('browser', view, url)
  const localBounds = (bounds, parent) => ({ ...bounds, x: bounds.x - parent.x, y: bounds.y - parent.y })
  const resize = async (width, height = 552) => {
    const panel = { x: 20, y: 20, width, height: height + 48 }
    frame.setBounds(panel)
    host.layout({ panel, browser: { x: 20, y: 68, width, height } }, localBounds, (item, visible) => item.setVisible(visible))
  }
  const fitted = () => waitFor(async () => ({
    ...await view.webContents.executeJavaScript(`({ width: innerWidth, client: document.documentElement.clientWidth,
      content: document.documentElement.scrollWidth, scrollX })`),
    scale: host.viewports.get(view).scale, pending: Boolean(host.viewports.get(view).timer),
  }), value => !value.pending && value.content <= value.client + 1
    && Math.abs(value.width * value.scale - view.getBounds().width) <= 2, 'page fits the native viewport without horizontal overflow')
  await view.webContents.loadURL(url)
  for (const width of [375, 768, 1024, 1440, 380]) {
    await resize(width)
    const fit = await fitted()
    assert.ok(fit.scale < 1, 'wide desktop content is fitted, rather than hidden')
    assert.equal(fit.scrollX, 0)
    for (const y of [0, 600]) {
      await view.webContents.executeJavaScript(`scrollTo(450, ${y})`)
      const metrics = await waitFor(() => view.webContents.executeJavaScript(`(() => {
        const fixed = document.querySelector('#fixed').getBoundingClientRect();
        return { scrollX, scrollY, width: innerWidth, client: document.documentElement.clientWidth,
          wide: document.querySelector('#wide').getBoundingClientRect().toJSON(),
          visual: visualViewport.width, clip: getComputedStyle(document.documentElement).clipPath,
          rightHit: document.elementFromPoint(document.documentElement.clientWidth - 24, 100)?.id,
          fixedHit: document.elementFromPoint(fixed.x + fixed.width / 2, fixed.y + fixed.height / 2)?.id };
      })()`), value => value.scrollX === 0 && value.scrollY === y, 'only vertical scrolling is needed')
      assert.equal(metrics.rightHit, 'wide', `right side remains visible at width ${width}, scroll ${y}: ${JSON.stringify(metrics)}`)
      assert.equal(metrics.fixedHit, 'fixed', `fixed controls remain reachable at width ${width}, scroll ${y}`)
      // Verify actual pixels as well as hit testing, away from the scrollbar and text.
      await new Promise(resolve => setTimeout(resolve, 100))
      const page = await view.webContents.capturePage()
      const size = page.getSize()
      const bitmap = page.toBitmap()
      const scale = size.width / width
      const offset = (Math.round(100 * scale) * size.width + Math.round((width - 40) * scale)) * 4
      const pixel = [...bitmap.subarray(offset, offset + 3)]
      assert.ok(pixel.every((channel, index) => Math.abs(channel - [119, 170, 17][index]) <= 3),
        `right-side page pixels at width ${width}, scroll ${y}: ${pixel}`)
    }
    assert.equal(await view.webContents.executeJavaScript('getComputedStyle(document.documentElement).clipPath'), 'none', 'the host does not clip external HTML')
    assert.deepEqual(host.corner.view.getBounds(), { x: width - 12, y: 588, width: 12, height: 12 })
    assert.equal(frame.children.at(-1), host.corner.view, 'corner remains above the active native page')
    fs.writeFileSync(path.join(temporary, `viewport-${width}.png`), (await view.webContents.capturePage()).toPNG())
    console.log(`PASS native viewport ${width}px: fit without horizontal overflow, vertical scroll, right-side paint and fixed controls`)
  }
  await resize(380, 432)
  await fitted()
  await waitFor(() => view.webContents.executeJavaScript('innerHeight'),
    value => Math.abs(value * host.viewports.get(view).scale - 432) <= 2, 'height-only resize updates the fitted viewport')
  assert.equal(host.corner.view.getBounds().y, 468)
  await resize(380)
  await fitted()
  for (const [theme, color] of [['dark', '#202222'], ['light', '#e7e7e9']]) {
    host.setFrameColor(color)
    await waitFor(() => host.corner.view.webContents.executeJavaScript('getComputedStyle(document.documentElement).color'),
      value => value === (theme === 'dark' ? 'rgb(32, 34, 34)' : 'rgb(231, 231, 233)'), 'corner follows frame theme')
    const corner = await host.corner.view.webContents.capturePage()
    const size = corner.getSize()
    const pixels = corner.toBitmap()
    const at = (x, y) => [...pixels.subarray((y * size.width + x) * 4, (y * size.width + x) * 4 + 4)]
    assert.equal(at(1, 1)[3], 0, 'inside of the rounded corner stays transparent')
    assert.equal(at(size.width - 2, size.height - 2)[3], 255, 'outside of the rounded corner covers the scrollbar')
    fs.writeFileSync(path.join(temporary, `corner-${theme}.png`), corner.toPNG())
  }
  await view.webContents.executeJavaScript('window.cornerClicks = 0; document.addEventListener("mousedown", () => cornerClicks++)')
  host.corner.view.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, x: 3, y: 3 })
  host.corner.view.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, x: 3, y: 3 })
  await waitFor(() => view.webContents.executeJavaScript('cornerClicks'), value => value === 1, 'transparent corner forwards page input')
  host.corner.view.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, x: 11, y: 11 })
  host.corner.view.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, x: 11, y: 11 })
  assert.equal(await view.webContents.executeJavaScript('cornerClicks'), 1, 'outside the rounded page does not click through')
  console.log('PASS fixed 12px native corner, both themes, scrollbar coverage and transparent-area input forwarding')
  await view.webContents.executeJavaScript('window.fixedClicks = 0; document.querySelector("#fixed").addEventListener("click", () => fixedClicks++)')
  const target = await view.webContents.executeJavaScript(`(() => {
    const r = document.querySelector('#fixed').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  })()`)
  const compatibility = new AgentBrowserCompatibility({
    getBrowserTabs: () => host.browserTabs(), getMainWindow: () => window, getActiveTabId: () => host.getActiveTabId(),
    cursorOverlayFactory: () => ({ showAt: async () => {}, withHidden: run => run(), dispose() {} }),
  })
  const debugTarget = { tabId: view.webContents.id }
  compatibility.debuggerAttach({ target: debugTarget, requiredVersion: '1.3', extensionId: 'viewport-smoke' })
  for (const type of ['mousePressed', 'mouseReleased']) {
    await compatibility.debuggerSendCommand({ target: debugTarget, extensionId: 'viewport-smoke',
      method: 'Input.dispatchMouseEvent', commandParams: { type, ...target, button: 'left', clickCount: 1 },
    })
  }
  await waitFor(() => view.webContents.executeJavaScript('fixedClicks'), value => value === 1, 'browser tool coordinates click the fitted page')
  compatibility.debuggerDetach({ target: debugTarget, extensionId: 'viewport-smoke' })
  console.log('PASS browser automation coordinates remain accurate after fitting')
  await view.webContents.loadURL(url + '/responsive')
  const responsive = await fitted()
  assert.equal(responsive.scale, 1, 'responsive pages keep their original scale')
  await view.webContents.executeJavaScript('document.querySelector("#wide").style.width = "1800px"')
  assert.ok((await fitted()).scale < 1, 'late content changes refit the page')
  await view.webContents.loadURL(url + '/author-clip')
  await fitted()
  assert.equal(await view.webContents.executeJavaScript('getComputedStyle(document.documentElement).clipPath'), 'inset(0px)', 'website-authored clipping is preserved')
  assert.equal(await view.webContents.executeJavaScript('typeof require + ":" + typeof ipcRenderer'), 'undefined:undefined')
  console.log('PASS responsive scale, dynamic overflow, website-authored clipping and preload isolation; screenshots:', temporary)
  window.destroy()
}

probe().then(() => { server.close(); app.quit() }).catch(error => {
  console.error(error)
  server.close()
  app.exit(1)
})
