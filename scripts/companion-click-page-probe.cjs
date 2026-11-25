// Exercise the real pet page, its default state, mouse handlers and sandboxed rendered effect.
const assert = require('node:assert/strict')
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
    const frames = await waitFor(() => page.webContents.executeJavaScript('clickProbe.frames'), items =>
      items.some(item => item.events.some(e => e.kind === 'touch' && e.detail.kind === 'poke')), 'native poke event')
    assert.ok(frames.some(item => item.sounds.some(sound => sound.name === 'poke')), 'Coopanion plays its poke sound')
    assert.ok(frames.some(item => ['happy', 'wink', 'surprised', 'love', 'angry'].includes(item.layout.expression)),
      'the native click chooses a face')
    assert.equal(await frame.executeJavaScript("document.querySelector('[data-minduck-thinking]') !== null"), false)
    console.log('PASS: real pet window pointer delivered the native Coopanion poke, face and sound')
  } finally {
    if (!page.isDestroyed()) page.destroy()
  }
}
