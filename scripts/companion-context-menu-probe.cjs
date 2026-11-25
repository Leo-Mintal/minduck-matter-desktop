const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

module.exports = async function probeContextMenu(page, waitFor) {
  const evaluate = code => page.webContents.executeJavaScript(code)
  const send = (method, params) => page.webContents.debugger.sendCommand(method, params)
  await evaluate(`window.contextMenuFrames=0;addEventListener('message',event=>{if(event.data?.t==='frame')contextMenuFrames++});
    window.contextMenuEvents=[];for(const type of ['pointerdown','contextmenu','blur'])
    addEventListener(type,event=>contextMenuEvents.push({type,x:event.clientX,y:event.clientY,target:event.target?.className,hidden:document.getElementById('menu').hidden}),true);void 0`)
  async function rightClick() {
    await waitFor(() => evaluate(`!panelProbe.layout.pressing && !['drag','air','land'].includes(panelProbe.layout.mode)`),Boolean,'figure finishes resize/landing before menu interaction')
    const point = await evaluate('panelProbe.layout.hit[0]')
    await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:point.x,y:point.y,button:'none',buttons:0})
    for (const type of ['mousePressed','mouseReleased']) await send('Input.dispatchMouseEvent',{
      type,x:point.x,y:point.y,button:'right',buttons:type==='mousePressed'?2:0,clickCount:1,
    })
    assert.equal(await evaluate('document.getElementById("menu").hidden'),false,
      'right-clicking the figure opens its menu: '+JSON.stringify(await evaluate('({events:contextMenuEvents,errors:panelProbe.errors,hit:panelProbe.layout.hit[0]})')))
    await waitFor(() => evaluate('document.getElementById("menu").getAnimations().every(a=>a.playState==="finished")'),Boolean,'context menu opening settles')
  }
  for (const width of [375,768,1024,1440]) for (const theme of ['light','dark']) {
    const before=await evaluate('contextMenuFrames')
    page.setContentSize(width,600)
    await send('Emulation.setEmulatedMedia',{features:[{name:'prefers-color-scheme',value:theme}]})
    await waitFor(()=>evaluate(`contextMenuFrames>=${before+4} && !panelProbe.layout.moving`),Boolean,'resized sandbox hit geometry settles')
    await rightClick()
    const state = await evaluate(`(() => {
      const menu=document.getElementById('menu'),r=menu.getBoundingClientRect(),items=[...menu.querySelectorAll('[role=menuitem]')];
      panelProbe.cursor({x:r.x+r.width/2,y:r.y+r.height/2});
      return {labels:items.map(item=>item.textContent.trim()),icons:items.map(item=>!!item.querySelector('svg')),
        actions:[...document.querySelectorAll('.minduck-action')].map(button=>button.dataset.action),
        actionsHidden:document.querySelector('.minduck-actions').hidden,
        interactive:panelProbe.interactive,left:r.left,right:r.right,top:r.top,bottom:r.bottom,
        blur:getComputedStyle(menu).backdropFilter,oldControls:!!menu.querySelector('.m-head,.m-grid')};
    })()`)
    assert.deepEqual(state.labels,['桌宠设置','隐藏桌宠'])
    assert.deepEqual(state.actions,['new-chat','toggle-tasks'],'the bottom capsule contains only chat and fold controls')
    assert.equal(state.actionsHidden,false,'the two bottom controls stay visible while using the menu: '+JSON.stringify(await evaluate('({mode:panelProbe.layout.mode,pressing:panelProbe.layout.pressing})')))
    assert.ok(state.icons.every(Boolean) && state.interactive && !state.oldControls)
    assert.ok(state.blur.includes('blur('))
    assert.ok(state.left>=15.9 && state.right<=width-15.9 && state.top>=15.9 && state.bottom<=584.1,JSON.stringify(state))
    if(width===768)fs.writeFileSync(path.resolve(__dirname,'../build/companion-context-menu-'+theme+'.png'),
      (await page.webContents.capturePage()).toPNG())
    await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27})
    await send('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27})
    assert.equal(await evaluate('document.getElementById("menu").hidden'),true,'Escape closes the menu')
  }
  await rightClick()
  for(const expected of ['settings','hide']) {
    for(const type of ['keyDown','keyUp'])await send('Input.dispatchKeyEvent',{
      type,key:'ArrowDown',code:'ArrowDown',windowsVirtualKeyCode:40,
    })
    assert.equal(await evaluate('document.activeElement.dataset.petAction'),expected,'arrow keys move menu focus')
  }
  for(const type of ['keyDown','keyUp'])await send('Input.dispatchKeyEvent',{
    type,key:'Tab',code:'Tab',windowsVirtualKeyCode:9,
  })
  assert.equal(await evaluate('document.getElementById("menu").hidden'),true,'Tab closes the menu')
  await rightClick()
  for (const type of ['mousePressed','mouseReleased']) await send('Input.dispatchMouseEvent',{
    type,x:4,y:4,button:'left',buttons:type==='mousePressed'?1:0,clickCount:1,
  })
  assert.equal(await evaluate('document.getElementById("menu").hidden'),true,'outside click closes the menu')
  await rightClick()
  await evaluate('dispatchEvent(new Event("blur"))')
  assert.equal(await evaluate('document.getElementById("menu").hidden'),true,'losing focus closes the menu')
  await rightClick()
  const point=await evaluate(`(() => {const r=document.querySelector('[data-pet-action="hide"]').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`)
  await send('Input.dispatchMouseEvent',{type:'mouseMoved',...point,button:'none',buttons:0})
  for(const type of ['mousePressed','mouseReleased'])await send('Input.dispatchMouseEvent',{
    type,...point,button:'left',buttons:type==='mousePressed'?1:0,clickCount:1,
  })
  assert.equal(await evaluate('panelProbe.hideCalls'),1,'real mouse click invokes hide exactly once')
  console.log('PASS: real right-click opens the two-item glass menu, screen bounds/native hit, Escape/outside/blur dismissal; 4 widths × light/dark')
}
