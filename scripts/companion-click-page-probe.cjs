// Exercise the real pet page, its default state, mouse handlers and sandboxed rendered effect.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { BrowserWindow } = require('electron')

module.exports = async function probeClickPage(url, waitFor) {
  const page = new BrowserWindow({ show: false, width: 960, height: 600,
    webPreferences: { contextIsolation: true, sandbox: true, backgroundThrottling: false, offscreen: true } })
  try {
    await page.loadURL(url)
    await page.webContents.executeJavaScript(`
      window.clickProbe = { frames: [] };
      addEventListener('message', (event) => {
        if (event.data?.t !== 'frame') return;
        clickProbe.latest = event.data.layout;
        if (clickProbe.record) clickProbe.frames.push(event.data);
      });
    `)
    const layout = await waitFor(() => page.webContents.executeJavaScript('clickProbe.latest'),
      (value) => value?.mode === 'idle' && !value.moving && value.hit?.length, 'real pet page idle')
    // Chromium input exercises trusted pointer events/capture without changing the user's focus.
    page.webContents.debugger.attach('1.3')
    const frame = await waitFor(async () => page.webContents.mainFrame.frames.find((item) => item.url.includes('/figure-frame')),
      Boolean, 'real pet figure frame')
    await frame.executeJavaScript(`
      window.clickInputs = [];
      addEventListener('message', (event) => {
        if (event.data?.t === 'pointer') clickInputs.push({ type: event.data.type, p: event.data.p });
      });
    `)
    const point = layout.hit[0]
    const input = (type, x = point.x, y = point.y) => page.webContents.debugger.sendCommand('Input.dispatchMouseEvent', {
      type, x: Math.round(x), y: Math.round(y), button: type === 'mouseMoved' ? 'none' : 'left',
      buttons: type === 'mousePressed' ? 1 : 0, clickCount: type === 'mouseMoved' ? 0 : 1 })
    await page.webContents.executeJavaScript('clickProbe.record = true; clickProbe.frames = []')
    await input('mouseMoved')
    await input('mousePressed')
    // A poll for a rendered press can itself exceed the kit's 400ms short-click threshold.
    await new Promise((resolve) => setTimeout(resolve, 60))
    await input('mouseReleased')
    const effect = await waitFor(() => frame.executeJavaScript(`(() => {
      const layer = document.querySelector('[data-minduck-thinking]');
      if (!layer) return null;
      return { visible: getComputedStyle(layer).visibility === 'visible',
        clocks: layer.querySelector('svg').getAnimations({subtree: true}).map((item) => item.currentTime),
        width: layer.getBoundingClientRect().width };
    })()`), (value) => value?.visible && value.width > 0 && value.clocks.length === 4
      && value.clocks.every((time) => time >= 1500 && time < 4500), 'rendered click thought bubble')
    const capture = path.resolve(__dirname, '../build/companion-click-thinking.png')
    fs.writeFileSync(capture, (await page.webContents.capturePage()).toPNG())
    const frames = await page.webContents.executeJavaScript('clickProbe.frames')
    assert.ok(frames.length > 0)
    assert.ok(frames.every((item) => item.layout.mode === 'idle'), 'no click crouch/jump/shake')
    assert.ok(frames.every((item) => item.sounds.every((sound) => !['poke', 'purr'].includes(sound.name))),
      'a simple pointer entry/click never causes a poke or false pet reaction')
    assert.ok(effect.visible)
    await waitFor(() => frame.executeJavaScript(`getComputedStyle(document.querySelector('[data-minduck-thinking]')).visibility`),
      (value) => value === 'hidden', 'click effect completes')
    console.log('PASS: real pet-app defaults + real mouse click + visible SVG + no poke bounce; preview:', capture)
  } catch (error) {
    console.error('Click page failure:', error.message)
    if (!page.isDestroyed()) {
      const frame = page.webContents.mainFrame.frames.find((item) => item.url.includes('/figure-frame'))
      console.error('Click page diagnostic:', JSON.stringify({
        page: await page.webContents.executeJavaScript(`({latest: clickProbe.latest,
          modes: [...new Set(clickProbe.frames.map(item => item.layout.mode))]})`),
        frame: frame ? await frame.executeJavaScript(`({ inputs: window.clickInputs,
          effect: document.querySelector('[data-minduck-thinking]')?.getAttribute('style'),
          clocks: [...document.querySelectorAll('[data-minduck-thinking] svg')].flatMap(svg =>
            svg.getAnimations({subtree:true}).map(item => item.currentTime)) })`) : null,
      }))
    }
    throw error
  } finally {
    if (!page.isDestroyed()) page.destroy()
  }
}
