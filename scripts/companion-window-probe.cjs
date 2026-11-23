// Actual native macOS window bounds and window screenshots, using a disposable Core/host.
const assert = require('node:assert/strict')
const { execFileSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')
const { screen, nativeImage } = require('electron')
const { DevToolsClient, devToolsPort } = require('./devtools-test-client.cjs')

module.exports = async function probeWindow({ companion, data, state, waitFor, captureMode = 'native',
  getNativeWindow, nativeBoundsSource = 'CGWindowListCopyWindowInfo' }) {
  assert.equal(process.platform, 'darwin', 'native window probe requires macOS')
  assert.ok(['native', 'renderer'].includes(captureMode))
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
  const nativeWindow = getNativeWindow || (() => {
    const windows = JSON.parse(execFileSync(binary, [String(state.window.pid)], { encoding: 'utf8' }))
    assert.equal(windows.length, 1, 'the host has one native window')
    return windows[0]
  })
  const port = await devToolsPort(path.join(data, 'pet-window'))
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
  const target = targets.find(item => item.type === 'page' && item.url.split('#')[0] === state.url)
  assert.ok(target, 'pet BrowserWindow is a real DevTools target')
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
  const screenshot = async name => {
    const file = path.join(evidence, name + '.png')
    let own
    for (let attempt = 0; attempt < 3; attempt++) {
      own = await nativeWindow()
      if (captureMode === 'native') execFileSync('screencapture', ['-x', '-o', '-l' + own.id, file])
      else {
        const shot = await client.send('Page.captureScreenshot', { format: 'png', fromSurface: true })
        fs.writeFileSync(file, Buffer.from(shot.data, 'base64'))
      }
      const after = await nativeWindow()
      if (Object.keys(own.bounds).every(key => own.bounds[key] === after.bounds[key])) break
      assert.ok(attempt < 2, 'native window must settle before comparing screenshot dimensions')
    }
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
    if (captureMode === 'renderer') await client.send('Emulation.setDefaultBackgroundColorOverride', {
      color: { r: 0, g: 0, b: 0, a: 0 },
    })
    await saveConfig({ 'worlds.desktop-pet.roam': 'off' })
    await evaluate(`window.windowProbe={layout:null,resizes:0,arrivals:[],events:[]};
      addEventListener('message',event=>{if(event.data?.t==='frame') {
        windowProbe.layout=event.data.layout;
        for(const item of event.data.events||[]) {
          windowProbe.events.push(item);
          if(item.kind==='arrived') windowProbe.arrivals.push(item.detail);
        }
      }});
      addEventListener('resize',()=>windowProbe.resizes++);true`)
    await waitFor(() => evaluate('windowProbe.layout?.box && !windowProbe.layout.moving'), Boolean, 'stationary pet')
    const viewport = await evaluate('({width:innerWidth,height:innerHeight})')
    const display = screen.getPrimaryDisplay().workArea
    const workAreaBounds = { X: display.x, Y: display.y, Width: display.width, Height: display.height }
    assert.deepEqual(viewport, { width: display.width, height: display.height }, 'world keeps its original work-area viewport')
    await new Promise(resolve => setTimeout(resolve, 400))
    const idle = await screenshot('idle')
    assert.deepEqual(idle.bounds, workAreaBounds, 'idle native window covers the full work area')
    assert.equal(await evaluate('typeof petHost.fitContent'), 'undefined', 'no renderer-driven native crop API')
    const motion = []
    for (const run of [false, true]) {
      const before = await evaluate('windowProbe.layout')
      const target = viewport.width * (before.x > viewport.width / 2 ? .25 : .75)
      const mode = run ? 'run' : 'walk'
      await evaluate(`{
        const frame=document.querySelector('#figureLayer iframe').contentWindow;
        frame.postMessage({t:'set',state:{roam:'off',hold:60}},'*');
        frame.postMessage({t:'walk',x:${target},run:${run},id:'window-${mode}'},'*');
      }true`)
      await waitFor(() => evaluate('windowProbe.layout.mode'), value => value === mode, mode + ' starts')
      const samples = []
      for (let i = 0; i < 6; i++) {
        samples.push((await nativeWindow()).bounds)
        await new Promise(resolve => setTimeout(resolve, 35))
      }
      for (const sample of samples) {
        assert.deepEqual(sample, workAreaBounds, mode + ' keeps the same full work-area native surface')
      }
      const arrived = await waitFor(() => evaluate(`windowProbe.arrivals.find(item=>item.walkId==='window-${mode}')`),
        Boolean, mode + ' arrives').catch(async error => {
        console.error('Motion diagnostic:', { mode, target, before, after: await evaluate('windowProbe.layout'),
          events: await evaluate('windowProbe.events') })
        throw error
      })
      assert.ok(Math.abs(arrived.x - target) < 5, mode + ' reaches its requested stage coordinate')
      await new Promise(resolve => setTimeout(resolve, 400))
      const settled = await screenshot(mode + '-settled')
      assert.deepEqual(settled.bounds, workAreaBounds, mode + ' stays full-sized after settling')
      motion.push({ mode, target, arrived, samples, settled })
    }
    const capture = async (name, qa) => {
      companion.setTaskOutput({ active: true, status: qa ? 'waiting' : 'running', conversationId: 'window-test',
        turnId: name, text: '透明窗口覆盖整个显示器工作区', detail: '测试当前窗口布局',
        ...(qa ? { qa: { contextId: name, itemId: name, interruptId: name,
          spec: { variant: 'single', q: '你想如何处理这项任务？', options: [
            { key: 'one', label: '第一个选项' }, { key: 'two', label: '第二个选项' } ] } } } : {}) })
      await waitFor(() => evaluate(`!document.querySelector('.minduck-outputs').hidden &&
        ${qa ? "!!document.querySelector('.minduck-qa')" : "!!document.querySelector('.minduck-running')"}`), Boolean, name + ' panel')
      await new Promise(resolve => setTimeout(resolve, 500))
      const own = await screenshot(name)
      assert.deepEqual(own.bounds, workAreaBounds, name + ' leaves native window bounds unchanged')
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
    assert.deepEqual(scaled.bounds, qa.bounds, 'bubble scaling does not resize the native window')
    companion.setTaskOutput({ active: false })
    await waitFor(() => evaluate('document.querySelector(".minduck-outputs").hidden'), Boolean, 'panels close')
    await new Promise(resolve => setTimeout(resolve, 400))
    const closed = await screenshot('panels-closed')
    assert.deepEqual(closed.bounds, workAreaBounds, 'closing panels keeps the full work-area native window')
    assert.equal(await evaluate('windowProbe.resizes'), 0, 'panel changes never resize the animation viewport')
    // Real renderer input uses the same native work-area coordinates throughout a drag.
    const before = await evaluate('windowProbe.layout')
    const start = before.hit[0]
    const dragBounds = []
    await client.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: start.x, y: start.y })
    await client.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: start.x, y: start.y, button: 'left', buttons: 1, clickCount: 1 })
    for (let i = 1; i <= 12; i++) {
      await client.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: start.x - i * 8, y: start.y - 80, button: 'left', buttons: 1 })
      if (i === 1) await waitFor(() => evaluate('windowProbe.layout.mode'), value => value === 'drag', 'native drag starts')
      dragBounds.push((await nativeWindow()).bounds)
      await new Promise(resolve => setTimeout(resolve, 20))
    }
    for (const sample of dragBounds) assert.deepEqual(sample, workAreaBounds, 'drag keeps its native surface fixed')
    await client.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: start.x - 96, y: start.y - 80, button: 'left', buttons: 0, clickCount: 1 })
    await waitFor(() => evaluate('windowProbe.layout'), layout => Math.abs(layout.x - before.x) > 50 && !layout.pressing, 'drag/drop at original world coordinates')
    await waitFor(() => evaluate('windowProbe.layout'), layout => !layout.moving, 'drop finishes landing')
    const landed = await screenshot('landed')
    assert.deepEqual(landed.bounds, workAreaBounds, 'landing keeps the full work-area native window')
    assert.equal(await evaluate('windowProbe.resizes'), 0, 'motion and panels never resize the animation viewport')
    const report = { captureMode, nativeBoundsSource,
      viewport, workAreaBounds, idle, motion, dragBounds, running, qa, scaled, closed, landed,
      noViewportResize: true, rendererDragPassed: true }
    fs.writeFileSync(path.join(evidence, 'report.json'), JSON.stringify(report, null, 2))
    console.log('PASS: actual macOS full work-area window at idle, walk/run, settling, QA/150%, closing panels and drag/drop; ' + captureMode + ' transparency screenshots and unchanged viewport. Evidence: ' + evidence)
  } finally { client.close() }
}
