const test = require('node:test')
const assert = require('node:assert/strict')
const { AgentCursorOverlay, CURSOR_ID } = require('../src/agentCursorOverlay.cjs')

function createWebContents() {
  const scripts = []
  let present = false
  const webContents = {
    isDestroyed: () => false,
    executeJavaScript: async (script) => {
      scripts.push(script)
      if (script.startsWith('Boolean(')) return present
      if (script.includes('attachShadow')) {
        present = true
        return true
      }
      if (script.includes("cursor.style.display = 'block'")) return true
      return true
    },
  }
  return { webContents, scripts }
}

test('installs the bundled sidebar logo and moves the Agent Browser cursor', async () => {
  const { webContents, scripts } = createWebContents()
  const overlay = new AgentCursorOverlay(webContents)

  assert.equal(await overlay.showAt(120, 80), true)
  assert.equal(scripts.some((script) => script.includes('data:image/svg+xml;base64,')), true)
  assert.equal(scripts.some((script) => script.includes(CURSOR_ID)), true)
  assert.equal(scripts.some((script) => script.includes('"106px"') && script.includes('"66px"')), true)
})

test('hides the cursor while a page screenshot is captured, then restores it', async () => {
  const { webContents, scripts } = createWebContents()
  const overlay = new AgentCursorOverlay(webContents)
  await overlay.showAt(20, 30)
  const before = scripts.length

  const result = await overlay.withHidden(async () => 'screenshot')

  assert.equal(result, 'screenshot')
  assert.equal(scripts.length > before + 1, true)
  assert.equal(scripts.some((script) => script.includes("cursor.style.display = 'none'")), true)
  assert.equal(overlay.visible, true)
})
