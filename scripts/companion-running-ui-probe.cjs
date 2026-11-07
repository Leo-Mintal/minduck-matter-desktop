const assert=require('node:assert/strict')
const fs=require('node:fs'),path=require('node:path')

module.exports=async function probeRunning(page,waitFor){
  const evaluate=code=>page.webContents.executeJavaScript(code)
  const root=`document.querySelector('.minduck-running').shadowRoot`
  const send=(method,params)=>page.webContents.debugger.sendCommand(method,params)
  const frame=()=>evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))')
  const task={active:true,status:'running',contextId:'quick-context',conversationId:'queue-source',turnId:'queue-turn',
    text:'正在整理你需要的资料和信息',detail:'这是当前会话的执行内容'}
  const update=async(value=task)=>{await evaluate(`panelProbe.output(${JSON.stringify(value)});void 0`);await frame()}
  async function click(selector){
    await waitFor(()=>evaluate(`(()=>{let opacity=1;for(let e=${root}.querySelector(${JSON.stringify(selector)});e;e=e.parentElement || e.getRootNode().host)opacity*=Number(getComputedStyle(e).opacity);return opacity;})()`),
      value=>value>.99,'running control expansion finishes')
    await frame()
    const point=await evaluate(`(()=>{const s=${root},b=s.querySelector(${JSON.stringify(selector)}),r=b.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2;
      let opacity=1,visible=true;for(let e=b;e;e=e.parentElement || e.getRootNode().host){const c=getComputedStyle(e);opacity*=Number(c.opacity);visible=visible && c.visibility==='visible' && c.display!=='none' && c.pointerEvents!=='none';}
      const hit=s.elementFromPoint(x,y);return {x,y,opacity,visible,disabled:b.disabled,hit:hit===b || b.contains(hit)};})()`)
    assert.ok(point.opacity>.99 && point.visible && !point.disabled && point.hit,JSON.stringify(point))
    await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:point.x,y:point.y,button:'none',buttons:0})
    for(const type of ['mousePressed','mouseReleased'])await send('Input.dispatchMouseEvent',{
      type,x:point.x,y:point.y,button:'left',buttons:type==='mousePressed'?1:0,clickCount:1,
    })
    await frame()
  }
  const input=text=>evaluate(`(()=>{const f=${root}.querySelector('textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(f,${JSON.stringify(text)});f.dispatchEvent(new Event('input',{bubbles:true,composed:true}));})()`)
  await evaluate(`panelProbe.actions=[];panelProbe.targets=[];panelProbe.reply=null;panelProbe.failure='';panelProbe.pause=false`)
  await update()
  for(const width of [375,768,1024,1440])for(const theme of ['light','dark']){
    page.setContentSize(width,600)
    await send('Emulation.setEmulatedMedia',{features:[{name:'prefers-color-scheme',value:theme}]});await frame()
    const state=await evaluate(`(()=>{const s=${root},r=document.querySelector('.minduck-output').getBoundingClientRect(),a=s.querySelector('.pet-running-append').getBoundingClientRect(),b=s.querySelector('.pet-running-stop').getBoundingClientRect(),lines=[...s.querySelectorAll('.pet-running-message span')].map(e=>e.getBoundingClientRect());return {w:r.width,h:r.height,buttons:[a.width,a.height,b.width,b.height],gap:b.left-a.right,right:r.right-b.right,top:a.top-r.top,textGap:lines[1].top-lines[0].bottom,font:getComputedStyle(s.querySelector('.pet-running-message')).fontSize,theme:s.host.dataset.theme,overflow:document.documentElement.scrollWidth>innerWidth};})()`)
    state.right=Math.round(state.right*1000)/1000
    assert.deepEqual(state,{w:330,h:12+20+8+20+12,buttons:[32,32,32,32],gap:8,right:16,top:20,textGap:8,font:'14px',theme,overflow:false})
    if(width===768)fs.writeFileSync(path.resolve(__dirname,'../build/companion-running-'+theme+'.png'),(await page.webContents.capturePage()).toPNG())
  }
  await update({...task,detail:''})
  assert.equal(await evaluate(`document.querySelector('.minduck-output').getBoundingClientRect().height`),12+32+12,'single-line running card fits its action buttons without a reserved subtitle')
  await update()
  await click('.pet-running-append')
  await waitFor(()=>evaluate(`${root}.querySelector('textarea')?.disabled===false`),Boolean,'queue editor ready')
  await waitFor(()=>evaluate(`${root}.querySelector('.pet-running-composer').getAnimations().every(animation=>animation.playState==='finished')`),Boolean,'queue input expansion settles')
  await input('继续补充这一条')
  await update({...task,detail:'更新进度不清空输入'})
  assert.equal(await evaluate(`${root}.querySelector('textarea').value`),'继续补充这一条')
  for(const width of [375,768,1024,1440])for(const theme of ['light','dark']){
    page.setContentSize(width,600)
    await send('Emulation.setEmulatedMedia',{features:[{name:'prefers-color-scheme',value:theme}]});await frame()
    const state=await evaluate(`(()=>{const s=${root},r=document.querySelector('.minduck-output').getBoundingClientRect(),h=s.querySelector('.pet-running-heading').getBoundingClientRect(),f=s.querySelector('.pet-quick').getBoundingClientRect();return {height:f.height,below:f.top>=h.bottom,right:r.right,left:r.left,bottom:r.bottom,overflow:document.documentElement.scrollWidth>innerWidth};})()`)
    assert.equal(state.height,42);assert.ok(state.below && state.left>=15.95 && state.right<=width-15.95 && state.bottom<=600 && !state.overflow,JSON.stringify(state))
    if(width===768)fs.writeFileSync(path.resolve(__dirname,'../build/companion-running-input-'+theme+'.png'),(await page.webContents.capturePage()).toPNG())
  }
  await evaluate(`panelProbe.failure='追加测试失败，请重试'`);await click('.pet-quick-send')
  await waitFor(()=>evaluate(`${root}.querySelector('[role=alert]')?.textContent`),text=>text?.includes('追加测试失败'),'queue error retains draft')
  assert.equal(await evaluate(`${root}.querySelector('textarea').value`),'继续补充这一条')
  await evaluate(`panelProbe.failure='';panelProbe.actions=[];panelProbe.targets=[];panelProbe.reply={ok:true,queued:true};panelProbe.pause=true`)
  await click('.pet-quick-send')
  assert.deepEqual(await evaluate('panelProbe.actions'),['chat-queue'])
  assert.deepEqual(await evaluate('panelProbe.targets[0]'),{contextId:'quick-context',conversationId:'queue-source',turnId:'queue-turn',text:'继续补充这一条',attachmentIds:[]})
  assert.equal(await evaluate(`${root}.querySelector('.pet-running-stop').disabled`),true)
  await evaluate('panelProbe.pause=false;panelProbe.release();void 0')
  await waitFor(()=>evaluate(`${root}.querySelector('.pet-running-composer').hidden`),Boolean,'queued send collapses input')
  assert.equal(await evaluate('document.querySelector(".minduck-actions").classList.contains("is-composing")'),false)
  await evaluate(`panelProbe.reply={ok:true,stopped:true};panelProbe.actions=[];panelProbe.targets=[];panelProbe.failure='终止测试失败'`)
  await click('.pet-running-stop')
  assert.deepEqual(await evaluate('panelProbe.actions'),['chat-stop'],'retry test actually clicks stop after the card contracts')
  await waitFor(()=>evaluate(`${root}.querySelector('[role=alert]')?.textContent`),text=>text?.includes('终止测试失败'),'stop error is retryable')
  await evaluate(`panelProbe.failure='';panelProbe.actions=[];panelProbe.targets=[];panelProbe.pause=true`)
  await click('.pet-running-stop')
  assert.deepEqual(await evaluate('panelProbe.actions'),['chat-stop'],'one immediate operation, no navigation or confirmation')
  assert.deepEqual(await evaluate('panelProbe.targets[0]'),{contextId:'quick-context',conversationId:'queue-source',turnId:'queue-turn'})
  assert.equal(await evaluate(`${root}.querySelector('.pet-running-stop').disabled`),true)
  await evaluate('panelProbe.pause=false;panelProbe.release();void 0')
  await waitFor(()=>evaluate(`${root}.querySelector('[role=status]')?.textContent`),text=>text?.includes('已终止'),'stop acknowledgement')
  await update({...task,status:'waiting'})
  assert.equal(await evaluate('document.querySelector(".minduck-running").hidden'),true)
  await update({...task,turnId:'next-turn'})
  assert.equal(await evaluate(`${root}.querySelector('.pet-running-stop').disabled`),false,'resuming/new turn remounts the same shadow safely')
  await update({...task,turnId:'next-turn',contextId:'old-context'})
  await evaluate('panelProbe.reply=null');await click('.pet-running-append')
  await waitFor(()=>evaluate(`${root}.querySelector('[role=alert]')?.textContent`),text=>text?.includes('切换'),'stale organization cannot send')
  assert.equal(await evaluate(`${root}.querySelector('.pet-quick-send').disabled`),true)
  await update({active:false,tasks:[]});await evaluate(`panelProbe.actions=[];panelProbe.targets=[];panelProbe.reply=null;panelProbe.failure=''`)
  console.log('PASS: running SVG geometry, light/dark × 4 widths, shared 42px inline input, exact queue/stop targets, live draft, retry, no duplicate submit/confirmation, resumed turn and stale organization')
}
