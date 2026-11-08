// Actual native macOS window bounds and window screenshots, using a disposable Core/host.
const assert = require('node:assert/strict')
const { execFileSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')
const { screen, nativeImage } = require('electron')
const { DevToolsClient, devToolsPort } = require('./devtools-test-client.cjs')

module.exports = async function probeWindow({ companion, data, state, waitFor }) {
  assert.equal(process.platform, 'darwin', 'native window probe requires macOS')
  const evidence = process.env.MINDUCK_COMPANION_WINDOW_EVIDENCE || path.join(data, 'window-evidence')
  fs.mkdirSync(evidence, { recursive: true })
  const source = path.join(data, 'window-info.swift'), binary = path.join(data, 'window-info')
  fs.writeFileSync(source, `import Foundation
import CoreGraphics
let pid = Int(CommandLine.arguments[1])!
let list = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] ?? []
let own = list.filter { ($0[kCGWindowOwnerPID as String] as? Int) == pid }.map { item in
  ["id": item[kCGWindowNumber as String] ?? 0, "bounds": item[kCGWindowBounds as String] ?? [:]]
}
let data = try! JSONSerialization.data(withJSONObject: own)
print(String(data: data, encoding: .utf8)!)
`)
  execFileSync('swiftc', ['-module-cache-path', path.join(data, 'swift-cache'), source, '-o', binary])
  const nativeWindow = () => {
    const windows = JSON.parse(execFileSync(binary, [String(state.window.pid)], { encoding: 'utf8' }))
    assert.equal(windows.length, 1, 'the host has one native window')
    return windows[0]
  }
  const port = await devToolsPort(path.join(data, 'pet-window'))
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
  const target = targets.find(item => item.type === 'page' && item.url.split('#')[0] === state.url)
  assert.ok(target, 'pet WebContentsView is a real DevTools target')
  const client = new DevToolsClient(target.webSocketDebuggerUrl)
  const evaluate = async expression => {
    const result = await client.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
    assert.ok(!result.exceptionDetails, JSON.stringify(result.exceptionDetails))
    return result.result.value
  }
  const saveConfig = async values => {
    const response = await fetch(`http://127.0.0.1:${companion.status().port}/api/config`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ group: 'world:desktop-pet', values }),
    })
    assert.equal(response.ok, true)
  }
  const screenshot = name => {
    const own = nativeWindow()
    const file = path.join(evidence, name + '.png')
    execFileSync('screencapture', ['-x', '-o', '-l' + own.id, file])
    const image = nativeImage.createFromPath(file), bitmap = image.toBitmap(), size = image.getSize()
    const display = screen.getDisplayMatching({ x: own.bounds.X, y: own.bounds.Y, width: own.bounds.Width, height: own.bounds.Height })
    assert.equal(size.width, own.bounds.Width * display.scaleFactor)
    assert.equal(size.height, own.bounds.Height * display.scaleFactor)
    let clear = 0, painted = 0
    for (let i = 3; i < bitmap.length; i += 4) { if (!bitmap[i]) clear++; else painted++ }
    assert.ok(clear > painted * .1 && painted > 500, 'native window contains transparent background and visible content')
    return { ...own, screenshot: file, clear, painted }
  }
  try {
    await client.ready
    await saveConfig({ 'worlds.desktop-pet.roam': 'off' })
    await evaluate(`window.windowProbe={layout:null,resizes:0};
      addEventListener('message',event=>{if(event.data?.t==='frame') windowProbe.layout=event.data.layout});
      addEventListener('resize',()=>windowProbe.resizes++);true`)
    await waitFor(() => evaluate('windowProbe.layout?.box && !windowProbe.layout.moving'), Boolean, 'stationary pet')
    const viewport = await evaluate('({width:innerWidth,height:innerHeight})')
    const display = screen.getPrimaryDisplay().workArea
    assert.deepEqual(viewport, { width: display.width, height: display.height }, 'world keeps its original work-area viewport')
    await new Promise(resolve => setTimeout(resolve, 400))
    const idle = screenshot('idle')
    assert.ok(idle.bounds.Width * idle.bounds.Height < viewport.width * viewport.height * .4, 'native window is small')
    const capture = async (name, qa) => {
      companion.setTaskOutput({ active: true, status: qa ? 'waiting' : 'running', conversationId: 'window-test',
        turnId: name, text: '只占桌宠与气泡的空间', detail: '测试当前窗口布局',
        ...(qa ? { qa: { contextId: name, itemId: name, interruptId: name,
          spec: { variant: 'single', q: '你想如何处理这项任务？', options: [
            { key: 'one', label: '第一个选项' }, { key: 'two', label: '第二个选项' } ] } } } : {}) })
      await waitFor(() => evaluate(`!document.querySelector('.minduck-outputs').hidden &&
        ${qa ? "!!document.querySelector('.minduck-qa')" : "!!document.querySelector('.minduck-running')"}`), Boolean, name + ' panel')
      await new Promise(resolve => setTimeout(resolve, 500))
      const own = screenshot(name)
      const surfaces = await evaluate(`Array.from(document.querySelectorAll('.minduck-outputs:not([hidden]),.minduck-actions:not([hidden]),.minduck-handle:not([hidden])')).map(el=>{
        const r=el.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height}})`)
      for (const rect of surfaces) {
        assert.ok(display.x + rect.x >= own.bounds.X && display.y + rect.y >= own.bounds.Y)
        assert.ok(display.x + rect.x + rect.width <= own.bounds.X + own.bounds.Width)
        assert.ok(display.y + rect.y + rect.height <= own.bounds.Y + own.bounds.Height)
      }
      assert.deepEqual(await evaluate('({width:innerWidth,height:innerHeight})'), viewport)
      return own
    }
    const running = await capture('running', false)
    const qa = await capture('qa', true)
    await saveConfig({ 'worlds.desktop-pet.window.bubbleSize': 1.5 })
    await waitFor(() => evaluate(`document.querySelector('.minduck-outputs').style.getPropertyValue('--minduck-panel-scale')`),
      value => Number(value) === 1.5, '150% panels')
    const scaled = await capture('qa-150', true)
    assert.ok(scaled.bounds.Width > qa.bounds.Width, 'native window follows bubble scaling')
    companion.setTaskOutput({ active: false })
    await waitFor(() => evaluate('document.querySelector(".minduck-outputs").hidden'), Boolean, 'panels close')
    await waitFor(nativeWindow, own => own.bounds.Width < scaled.bounds.Width - 30, 'native window shrinks after closing panels')
    assert.equal(await evaluate('windowProbe.resizes'), 0, 'panel changes never resize the animation viewport')
    // Real renderer input retains stage coordinates even though its native view has a negative offset.
    const before = await evaluate('windowProbe.layout')
    const start = before.hit[0]
    await client.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: start.x, y: start.y })
    await client.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: start.x, y: start.y, button: 'left', buttons: 1, clickCount: 1 })
    for (let i = 1; i <= 12; i++) {
      await client.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: start.x - i * 8, y: start.y - 80, button: 'left', buttons: 1 })
      await new Promise(resolve => setTimeout(resolve, 20))
    }
    await client.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: start.x - 96, y: start.y - 80, button: 'left', buttons: 0, clickCount: 1 })
    await waitFor(() => evaluate('windowProbe.layout'), layout => Math.abs(layout.x - before.x) > 50 && !layout.pressing, 'drag/drop at original world coordinates')
    const report = { viewport, idle, running, qa, scaled, noViewportResize: true, rendererDragPassed: true }
    fs.writeFileSync(path.join(evidence, 'report.json'), JSON.stringify(report, null, 2))
    console.log('PASS: actual macOS compact window bounds/screenshots, transparency, QA/150% expansion and shrink, unchanged viewport, drag/drop. Evidence: ' + evidence)
  } finally { client.close() }
}
