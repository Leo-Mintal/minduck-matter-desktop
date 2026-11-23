const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const vm = require('node:vm')

function fixture() {
  const elements = new Map(), commands = []
  function element(selector) {
    if (!elements.has(selector)) elements.set(selector, { dataset: {}, attributes: {}, listeners: {},
      setAttribute(name, value) { this.attributes[name] = value },
      getAttribute(name) { return this.attributes[name] },
      addEventListener(name, listener) { this.listeners[name] = listener },
    })
    return elements.get(selector)
  }
  let render
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/desktop-frame.js'), 'utf8'), {
    document: { querySelector: element, documentElement: { dataset: {} } },
    window: { minduckDesktopFrame: { command: type => commands.push(type),
      onState: listener => { render = listener }, getState: () => Promise.resolve(null) } },
  })
  return { element, commands, render(update, workspace = false) {
    render({ update, workspace, navigation: {}, theme: 'dark', rightPanelOpen: false })
  } }
}

test('download ring exposes clamped progress and the exact live tooltip without visible text', () => {
  const f = fixture(), button = f.element('#check-update'), progress = f.element('#update-progress')
  for (const [input, percent] of [[0, 0], [37.9, 37], [62, 62], [100, 100], [-5, 0], [150, 100], [NaN, 0], [Infinity, 0]]) {
    f.render({ phase: 'downloading', percent: input })
    assert.equal(progress.hidden, false)
    assert.equal(progress.getAttribute('aria-valuenow'), String(percent))
    assert.equal(f.element('#update-progress-value').getAttribute('stroke-dashoffset'), String(100 - percent))
    assert.equal(button.title, `正在下载 ${percent}%`)
    assert.equal(button.getAttribute('aria-label'), button.title)
    assert.equal(progress.textContent, undefined, 'render must preserve the SVG instead of replacing it with percentage text')
    assert.notEqual(button.disabled, true, 'busy progress remains focusable for its tooltip')
  }
})

test('busy phases suppress repeated update actions while retaining meaningful labels', () => {
  const f = fixture(), button = f.element('#check-update')
  for (const phase of ['checking', 'downloading', 'preparing', 'installing']) {
    f.render({ phase, percent: 37 })
    assert.equal(button.getAttribute('aria-disabled'), 'true')
    assert.equal(button.getAttribute('aria-busy'), 'true')
    button.listeners.click()
    assert.equal(f.commands.length, 0)
    assert.equal(f.element('#update-progress').hidden, phase !== 'downloading')
    assert.ok(button.title)
  }
  f.render({ phase: 'downloaded', error: 'verification failed' })
  assert.equal(button.title, '安装准备失败，点击重试')
  button.listeners.click()
  assert.deepEqual(f.commands, ['check-update'])
})

test('idle restores the update action and the native rail yields to the shared workspace', () => {
  const f = fixture(), button = f.element('#check-update')
  f.render({ phase: 'downloading', percent: 37 }, true)
  assert.equal(f.element('.rail').inert, true)
  f.render({ phase: 'idle' })
  assert.equal(f.element('.rail').inert, false)
  assert.equal(button.title, '检查更新')
  assert.equal(button.getAttribute('aria-disabled'), 'false')
  assert.equal(f.element('#update-progress').hidden, true)
  button.listeners.click()
  assert.deepEqual(f.commands, ['check-update'])
})
