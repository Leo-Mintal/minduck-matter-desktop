const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

module.exports = async function probeScale(page, waitFor, checkPanels, setTask, coreOrigin) {
  const evaluate = code => page.webContents.executeJavaScript(code)
  const send = (method, params) => page.webContents.debugger.sendCommand(method, params)
  const scaleTo = async scale => {
    const response = await fetch(coreOrigin + '/api/config', { method:'POST', headers:{'content-type':'application/json'},
      body:JSON.stringify({group:'world:desktop-pet',values:{'worlds.desktop-pet.window.bubbleSize':scale}}) })
    assert.equal(response.ok, true, 'scale saves through the Core API')
    await waitFor(() => evaluate('document.querySelector(".minduck-outputs").style.getPropertyValue("--minduck-panel-scale")'),
      value => Number(value) === scale, 'saved scale reaches desktop panels')
  }
  const click = async selector => {
    const point = await evaluate(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`)
    await send('Input.dispatchMouseEvent', { type:'mouseMoved', ...point, button:'none', buttons:0 })
    for (const type of ['mousePressed','mouseReleased']) await send('Input.dispatchMouseEvent', { type, ...point, button:'left', clickCount:1 })
  }
  const visible = (rect, width) => assert.ok(rect.x >= 15.9 && rect.y >= 15.9
    && rect.x + rect.w <= width - 15.9 && rect.y + rect.h <= 584.1, JSON.stringify(rect))
  try {
    for (const scale of [1,1.25,1.5]) {
      await scaleTo(scale)
      for (const width of [375,768,1024,1440]) for (const theme of ['light','dark']) {
        await setTask(page, true)
        const state = await checkPanels(page, width, theme)
        visible(state.output, width); visible(state.actions, width)
        assert.ok(Math.abs(state.actions.h - 42 * scale) < .1)
        assert.ok(Math.abs(state.actions.w - 80 * scale) < .1)
        assert.ok(Math.abs(state.buttons[0].icon.w - 18 * scale) < .1)
        if (width >= 768) assert.ok(Math.abs(state.output.w - 330 * scale) < .1)
        await click('[data-action="new-chat"]')
        await waitFor(() => evaluate('document.querySelector(".minduck-actions").classList.contains("is-composing")'), Boolean, 'scaled button opens input')
        await new Promise(resolve => setTimeout(resolve, 250))
        const composer = await evaluate(`(()=>{const el=document.querySelector('.minduck-actions'),r=el.getBoundingClientRect(),field=el.querySelector('.minduck-quick').shadowRoot.querySelector('textarea').getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height,field:field.height}})()`)
        visible(composer, width)
        assert.ok(Math.abs(composer.h - 42 * scale) < .1)
        assert.ok(Math.abs(composer.field - 20 * scale) < .1)
        await evaluate('document.querySelector(".minduck-quick").shadowRoot.querySelector("textarea").focus()')
        for (const type of ['keyDown','keyUp']) await send('Input.dispatchKeyEvent', { type,key:'Escape',code:'Escape',windowsVirtualKeyCode:27 })
        await new Promise(resolve => setTimeout(resolve, 250))
        const idle = await checkPanels(page, width, theme, false)
        assert.ok(Math.abs(idle.handle.w - 27 * scale) < .1)
        assert.ok(Math.abs(idle.handle.h - 6 * scale) < .1)
        if (scale === 1.5 && width === 768) fs.writeFileSync(path.resolve(__dirname, '../build/companion-panels-scale-150-' + theme + '.png'), (await page.webContents.capturePage()).toPNG())
      }
    }
    await scaleTo(1.5)
    await evaluate(`panelProbe.output({active:true,status:'waiting',conversationId:'scale-qa',turnId:'turn',
      qa:{contextId:'scale',itemId:'scale',interruptId:'scale',spec:{variant:'single',q:'放大后的长问题'.repeat(30),
      options:Array.from({length:12},(_,i)=>({key:String(i),label:'选项 '+i+'：较长的回答内容'.repeat(4)}))}}})`)
    for (const width of [375,768]) {
      const state = await checkPanels(page, width, 'dark', false)
      visible(state.output, width)
      const qa = await evaluate(`(()=>{const el=document.querySelector('.minduck-content');return {client:el.clientHeight,scroll:el.scrollHeight}})()`)
      assert.ok(qa.client > 0 && qa.scroll >= qa.client)
    }
    console.log('PASS: 100/125/150% live panel scale, real button clicks, composer and handle, long QA, 4 widths × light/dark and screen bounds')
  } finally {
    await scaleTo(1)
    await evaluate('panelProbe.actions=[];panelProbe.targets=[]')
    await setTask(page, true)
  }
}
