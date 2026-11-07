const assert = require('node:assert/strict')
const path = require('node:path')
const { app, BrowserWindow } = require('electron')

async function measure(webContents, theme) {
  return webContents.executeJavaScript(`(() => {
    document.documentElement.dataset.theme = ${JSON.stringify(theme)}
    const input = document.querySelector('#origin')
    const buttons = [...document.querySelectorAll('.service-actions .b')]
    return {
      buttonRadii: buttons.map((button) => getComputedStyle(button).borderTopLeftRadius),
      inputHeight: input.getBoundingClientRect().height,
      inputRadius: getComputedStyle(input).borderTopLeftRadius,
      inputSurface: getComputedStyle(input).backgroundColor,
      theme: document.documentElement.dataset.theme,
    }
  })()`)
}

async function run() {
  await app.whenReady()
  const window = new BrowserWindow({
    show: false,
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      offscreen: true,
    },
  })
  try {
    await window.loadFile(path.join(__dirname, '..', 'src', 'matter-service-settings.html'))
    for (const theme of ['dark', 'light']) {
      const layout = await measure(window.webContents, theme)
      assert.equal(layout.theme, theme)
      assert.equal(layout.inputHeight, 36)
      assert.ok(parseFloat(layout.inputRadius) > 100, JSON.stringify(layout))
      assert.equal(layout.buttonRadii.length, 3)
      assert.ok(layout.buttonRadii.every((radius) => parseFloat(radius) > 100), JSON.stringify(layout))
      assert.notEqual(layout.inputSurface, 'rgba(0, 0, 0, 0)', JSON.stringify(layout))
    }
    const image = await window.webContents.capturePage()
    assert.equal(image.isEmpty(), false)
    console.log('PASS: Matter service settings uses shared pill inputs and buttons in light and dark themes')
  } finally {
    if (!window.isDestroyed()) window.destroy()
    app.quit()
  }
}

void run().catch((error) => {
  console.error(error)
  app.exitCode = 1
  app.quit()
})
