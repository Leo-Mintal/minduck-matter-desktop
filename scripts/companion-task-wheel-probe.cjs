const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

module.exports = async function probeTaskWheel(page, waitFor, tasks) {
  const evaluate = code => page.webContents.executeJavaScript(code)
  const send = (method, params) => page.webContents.debugger.sendCommand(method, params)
  const frame = () => evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))')
  const state = () => evaluate(`(() => {
    const stack=document.querySelector('.minduck-outputs'),list=stack.querySelector('.minduck-output-list');
    return {expanded:document.querySelector('[data-action=toggle-tasks]').getAttribute('aria-expanded')==='true',
      moving:stack.classList.contains('is-transitioning'),scroll:list.scrollTop,
      aboveOpacity:Number(getComputedStyle(stack,'::before').opacity),belowOpacity:Number(getComputedStyle(stack,'::after').opacity),
      above:stack.classList.contains('has-scroll-above'),below:stack.classList.contains('has-scroll-below')};
  })()`)
  const settled = () => waitFor(state,s=>!s.moving,'wheel-triggered deck motion settles')
  async function toggle(value) {
    if ((await state()).expanded!==value) await evaluate('document.querySelector("[data-action=toggle-tasks]").click()')
    await settled()
  }
  async function wheel(deltaY, deltaX=0, selector='.minduck-output-list', backingEdge=false) {
    const point=await evaluate(`(() => {const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();
      return {x:r.x+r.width/2,y:${backingEdge?'r.bottom-2':'r.y+r.height/2'}};})()`)
    await send('Input.dispatchMouseEvent',{type:'mouseMoved',...point,button:'none',buttons:0})
    await evaluate(`panelProbe.cursor(${JSON.stringify(point)});void 0`)
    await send('Input.dispatchMouseEvent',{type:'mouseWheel',...point,deltaY,deltaX})
    await frame()
  }
  async function edges(above,below) {
    await waitFor(state,s=>s.above===above && s.below===below
      && s.aboveOpacity===Number(above) && s.belowOpacity===Number(below),'scroll edge shadows reflect remaining content')
  }
  await toggle(false)
  await wheel(4,100)
  assert.equal((await state()).expanded,false,'horizontal gestures never expand tasks')
  await evaluate(`document.querySelector('.minduck-output-list').dispatchEvent(new WheelEvent('wheel',{deltaY:40,ctrlKey:true,bubbles:true,cancelable:true}))`)
  assert.equal((await state()).expanded,false,'pinch/zoom wheel input does not expand tasks')
  await wheel(40,0,'.minduck-outputs',true)
  assert.equal((await state()).expanded,true,'scrolling down over a folded deck unfolds it')
  assert.equal((await state()).moving,true,'wheel unfold uses the existing deck animation')
  assert.deepEqual([(await state()).aboveOpacity,(await state()).belowOpacity],[0,0],'edge overlays stay hidden while the deck moves')
  await wheel(30)
  assert.deepEqual([(await state()).moving,(await state()).scroll],[true,0],'wheel continuation neither skips the animation nor jumps the list')
  await wheel(-40)
  assert.equal((await state()).expanded,false,'opposite scrolling reverses the deck animation')
  await wheel(-30)
  assert.equal((await state()).moving,true,'upward continuation preserves the gathering animation')
  await wheel(40)
  await settled()
  await edges(false,true)
  await wheel(620)
  await waitFor(state,s=>s.scroll>200,'native wheel scrolls later expanded conversations')
  await edges(true,false)
  const before=(await state()).scroll
  await wheel(-80)
  await waitFor(state,s=>s.scroll<before && s.scroll>0,'scrolling up reads earlier conversations')
  assert.equal((await state()).expanded,true,'upward scrolling within the list does not fold it early')
  await evaluate('document.querySelector(".minduck-output-list").scrollTop=200')
  await frame();await edges(true,true)
  for (const theme of ['light','dark']) {
    await send('Emulation.setEmulatedMedia',{features:[{name:'prefers-color-scheme',value:theme}]})
    await frame()
    const styles=await evaluate(`(() => {
      const stack=document.querySelector('.minduck-outputs');
      return {edges:['::before','::after'].map(p=>{const c=getComputedStyle(stack,p);
        return {gradient:c.backgroundImage,pointer:c.pointerEvents,height:c.height}}),
        cards:[...stack.querySelectorAll('.minduck-output,.minduck-stack-layer')].map(c=>getComputedStyle(c).boxShadow)};
    })()`)
    for (const edge of styles.edges) {
      const color=theme==='light'?'255, 255, 255':'0, 0, 0'
      assert.ok(edge.gradient.includes('linear-gradient') && edge.gradient.includes('rgba('+color+', 0.45)'),'edge overlays follow the current appearance')
      assert.equal(edge.pointer,'none');assert.equal(edge.height,'20px')
    }
    for (const shadow of styles.cards) assert.ok(shadow.includes('inset') && !shadow.replace(/rgba?\([^)]*\)/g,'').includes(','),'cards retain only their inset edge, without outer glow')
    fs.writeFileSync(path.resolve(__dirname,'../build/companion-scroll-edges-'+theme+'.png'),(await page.webContents.capturePage()).toPNG())
  }
  await evaluate('document.querySelector(".minduck-output-list").scrollTop=0')
  await frame();await edges(false,true)
  await wheel(-40)
  await settled();await edges(false,false)
  assert.equal((await state()).expanded,false,'scrolling up at the list top folds it')
  await evaluate(`panelProbe.output(${JSON.stringify({...tasks[0],tasks:tasks.slice(0,2)})});void 0`)
  await toggle(true);await edges(false,false)
  // Real shadow-DOM QA scrolling must take priority over folding the parent list.
  const qa={active:true,status:'waiting',conversationId:'wheel-qa',turnId:'wheel-turn',text:'等你确认',
    qa:{contextId:'wheel-context',itemId:'wheel-item',interruptId:'wheel-interrupt',reviewInApp:false,
      spec:{variant:'single',q:'请选择任务',input_mode:'choice',max_attachments:0,
        options:Array.from({length:24},(_,i)=>({key:'choice-'+i,label:'任务选项 '+(i+1)}))}}}
  await evaluate(`panelProbe.output({active:false,tasks:[]});panelProbe.output(${JSON.stringify({...qa,tasks:[qa,tasks[0]]})});void 0`)
  await waitFor(()=>evaluate('!!document.querySelector(".minduck-qa").shadowRoot?.querySelector(".pet-option")'),Boolean,'real QA choices render')
  await toggle(true)
  const content='[data-conversation-id="wheel-qa"] .minduck-content'
  await evaluate(`document.querySelector('${content}').scrollTop=180`)
  await frame()
  assert.ok(await evaluate(`document.querySelector('${content}').scrollTop>100`),'QA fixture has internally scrollable content')
  await wheel(-60,0,content)
  await waitFor(()=>evaluate(`document.querySelector('${content}').scrollTop`),value=>value<180 && value>0,'native wheel scrolls inside the shadow-DOM QA')
  assert.equal((await state()).expanded,true,'scrolling QA content upward does not collapse the list')
  await evaluate(`document.querySelector('${content}').scrollTop=0`)
  await frame();await wheel(-40,0,content);await settled()
  assert.equal((await state()).expanded,false,'folding works once both QA and the list are at their top')
  await evaluate(`panelProbe.output(${JSON.stringify(qa)});void 0`)
  await frame();await wheel(80,0,content)
  await waitFor(()=>evaluate(`document.querySelector('${content}').scrollTop`),value=>value>0,'a single long QA keeps its own scrolling')
  assert.equal((await state()).expanded,false,'a single task does not unnecessarily unfold')
  assert.deepEqual(await evaluate('panelProbe.actions'),[],'wheel gestures never navigate or submit QA')
  await evaluate(`panelProbe.output({active:false,tasks:[]});panelProbe.output(${JSON.stringify({...tasks[0],tasks})});void 0`)
  await frame();await toggle(true)
  console.log('PASS: native wheel down expands, top-edge up collapses, bursts preserve/reverse deck motion, nested QA scrolling stays usable, conditional themed edge overlays and no card halos')
}
