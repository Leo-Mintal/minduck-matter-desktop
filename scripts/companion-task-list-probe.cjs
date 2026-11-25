const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

module.exports = async function probeTaskList(page, waitFor) {
  const evaluate = code => page.webContents.executeJavaScript(code)
  const send = (method, params) => page.webContents.debugger.sendCommand(method, params)
  const frame = () => evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
  async function click(selector, child) {
    const point = await evaluate(`(() => {
      const host=document.querySelector(${JSON.stringify(selector)});
      const el=${child ? `host.shadowRoot.querySelector(${JSON.stringify(child)})` : 'host'}, r=el.getBoundingClientRect();
      return {x:r.x+r.width/2,y:r.y+r.height/2};
    })()`)
    await send('Input.dispatchMouseEvent', {type:'mouseMoved', ...point, button:'none', buttons:0})
    for (const type of ['mousePressed', 'mouseReleased']) await send('Input.dispatchMouseEvent', {
      type, ...point, button:'left', buttons:type === 'mousePressed' ? 1 : 0, clickCount:1,
    })
    await frame()
  }
  async function toggle() {
    const hit = await evaluate('panelProbe.layout.hit[0]')
    await send('Input.dispatchMouseEvent', {type:'mouseMoved',x:hit.x,y:hit.y,button:'none',buttons:0})
    await waitFor(() => evaluate('!document.querySelector(".minduck-actions").hidden'), Boolean, 'task toggle is visible')
    await click('[data-action="toggle-tasks"]')
  }
  const expanded = () => evaluate('document.querySelector(".minduck-outputs").classList.contains("is-expanded")')
  const settled = () => waitFor(() => evaluate('!document.querySelector(".minduck-outputs").classList.contains("is-transitioning")'), Boolean, 'task cards finish spreading or gathering')
  const tasks = Array.from({length:8}, (_, i) => ({active:true,status:'waiting',conversationId:'list-'+i,
    turnId:'list-turn',text:'任务会话 '+(i+1),detail:'等待确认独立的任务内容'}))
  await evaluate(`panelProbe.output({active:false,tasks:[]});panelProbe.actions=[];panelProbe.targets=[]`)
  await evaluate(`panelProbe.output(${JSON.stringify({...tasks[0],tasks})});void 0`)
  await frame()
  assert.equal(await expanded(), false, 'new task batches start folded')
  await click('.minduck-output:not([hidden]) .minduck-message')
  assert.equal(await expanded(), true, 'clicking a folded card expands the list')
  assert.deepEqual(await evaluate('panelProbe.actions'), [], 'unfolding does not navigate or resolve a task')
  await settled()
  await require('./companion-task-motion-probe.cjs')(page, waitFor)
  await require('./companion-task-wheel-probe.cjs')(page, waitFor, tasks)
  for (const width of [375,768,1024,1440]) for (const theme of ['light','dark']) {
    page.setContentSize(width,600)
    await send('Emulation.setEmulatedMedia',{features:[{name:'prefers-color-scheme',value:theme}]})
    await evaluate('document.querySelector(".minduck-output-list").scrollTop=0')
    await frame()
    const state = await evaluate(`(() => {
      const stack=document.querySelector('.minduck-outputs'),list=stack.querySelector('.minduck-output-list');
      const r=list.getBoundingClientRect(), cards=[...list.querySelectorAll('.minduck-output')];
      const fullyVisible=cards.filter(card=>{const c=card.getBoundingClientRect();return c.top>=r.top && c.bottom<=r.bottom+.1});
      const css=getComputedStyle(list),cardCss=getComputedStyle(cards[0]);
      return {count:cards.length,visible:fullyVisible.length,scrolls:list.scrollHeight>list.clientHeight,
        mask:css.maskImage,blur:cardCss.backdropFilter,surface:cardCss.backgroundColor,color:cardCss.color,
        font:cardCss.fontSize,radius:cardCss.borderRadius,width:cards[0].getBoundingClientRect().width,
        above:stack.classList.contains('has-scroll-above'),below:stack.classList.contains('has-scroll-below'),
        top:r.top,bottom:r.bottom,left:r.left,right:r.right,
        layers:stack.querySelectorAll('.minduck-stack-layer:not([hidden])').length};
    })()`)
    assert.equal(state.count,8)
    assert.equal(state.visible,3,'exactly three complete messages fit before scrolling')
    assert.ok(state.scrolls && state.layers===0,JSON.stringify(state))
    assert.equal(state.mask,'none','scroll hints shade the list instead of fading cards into the desktop')
    assert.deepEqual([state.above,state.below],[false,true],'only the remaining content below is shaded at the top')
    assert.equal(state.blur,'blur(4px)','cards retain their original material')
    assert.equal(state.surface,theme==='dark'?'rgba(0, 0, 0, 0.88)':'rgba(255, 255, 255, 0.88)')
    assert.equal(state.color,theme==='dark'?'rgb(240, 240, 240)':'rgb(13, 13, 13)')
    assert.equal(state.font,'14px');assert.equal(state.radius,'28px')
    assert.ok(Math.abs(state.width-330)<.01,'original card width is preserved')
    assert.ok(state.top>=7.9 && state.bottom<=592.1 && state.left>=7.9 && state.right<=width-7.9,JSON.stringify(state))
    if (width===768) {
      const hit=await evaluate('panelProbe.layout.hit[0]')
      await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:hit.x,y:hit.y,button:'none',buttons:0})
      await frame()
      fs.writeFileSync(path.resolve(__dirname,'../build/companion-task-list-'+theme+'.png'),
        (await page.webContents.capturePage()).toPNG())
    }
  }
  const point=await evaluate(`(() => {const r=document.querySelector('.minduck-output-list').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`)
  await send('Input.dispatchMouseEvent',{type:'mouseMoved',...point,button:'none',buttons:0})
  await evaluate(`panelProbe.cursor(${JSON.stringify(point)});void 0`)
  assert.equal(await evaluate('panelProbe.interactive'),true,'scrolling list owns native input')
  await send('Input.dispatchMouseEvent',{type:'mouseWheel',...point,deltaY:620,deltaX:0})
  await waitFor(() => evaluate('document.querySelector(".minduck-output-list").scrollTop'), value => value>200,'real wheel reaches later conversations')
  const before=await evaluate('document.querySelector(".minduck-output-list").scrollTop')
  await evaluate(`panelProbe.output(${JSON.stringify({...tasks[7],tasks:[...tasks].reverse()})});void 0`)
  await frame()
  assert.equal(await expanded(),true,'stream updates retain expanded state')
  assert.ok(Math.abs(await evaluate('document.querySelector(".minduck-output-list").scrollTop')-before)<1,'stream updates retain scroll position')
  await evaluate('document.querySelector(".minduck-output-list").scrollTop=0')
  await frame()
  await click('[data-conversation-id="list-1"] .minduck-message')
  assert.deepEqual(await evaluate('panelProbe.targets.at(-1)'),{conversationId:'list-1',turnId:'list-turn'},'each expanded row routes independently')
  await toggle()
  await settled()
  assert.equal(await expanded(),false,'bottom arrow folds the list')
  assert.equal(await evaluate('document.querySelectorAll(".minduck-output:not([hidden])").length'),1)
  await toggle()
  await settled()
  assert.equal(await expanded(),true,'the same bottom arrow unfolds the list')
  assert.equal(await evaluate('document.querySelector("[data-action=toggle-tasks]").getAttribute("aria-expanded")'),'true')
  await evaluate('document.querySelector("[data-action=toggle-tasks]").focus();void 0')
  await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',windowsVirtualKeyCode:13,text:'\r'})
  await send('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13})
  await frame()
  await settled()
  assert.equal(await expanded(),false,'keyboard activates the same fold control')
  await evaluate('document.activeElement.blur();panelProbe.output({active:false,tasks:[]})')
  const runningTasks=tasks.slice(0,2).map(task=>({...task,status:'running',contextId:'quick-context'}))
  await evaluate(`panelProbe.output(${JSON.stringify({...runningTasks[0],tasks:runningTasks})});void 0`)
  await frame()
  await click('.minduck-output:not([hidden]) .minduck-running','.pet-running-message')
  await settled()
  const second='[data-conversation-id="list-1"] .minduck-running'
  await click(second,'.pet-running-append')
  await waitFor(() => evaluate(`!document.querySelector('${second}').shadowRoot.querySelector('textarea')?.disabled`),Boolean,'second conversation composer is ready')
  await evaluate(`(() => {const input=document.querySelector('${second}').shadowRoot.querySelector('textarea');
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input,'保留第二条会话草稿');
    input.dispatchEvent(new Event('input',{bubbles:true,composed:true}));})()`)
  await toggle()
  await settled()
  await toggle()
  await settled()
  await evaluate(`panelProbe.output(${JSON.stringify({...runningTasks[1],tasks:runningTasks})});void 0`)
  await frame()
  assert.equal(await evaluate(`document.querySelector('${second}').shadowRoot.querySelector('textarea').value`),'保留第二条会话草稿','folding and stream updates preserve each row and its draft')
  await evaluate('document.activeElement.blur();panelProbe.output({active:false,tasks:[]});panelProbe.actions=[];panelProbe.targets=[]')
  assert.equal(await evaluate('document.querySelector("[data-action=toggle-tasks]").disabled'),true,'empty lists disable the fold control')
  console.log('PASS: folded click and bottom/keyboard toggle, original three-row panels, conditional themed edge hints, native wheel, stable stream/scroll, per-row drafts and independent routing; 4 widths × light/dark')
}
