const assert=require('node:assert/strict')
const fs=require('node:fs'),path=require('node:path')
module.exports=async function probeQuickChat(page,waitFor){
  const evaluate=code=>page.webContents.executeJavaScript(code)
  const root=`document.querySelector('.minduck-quick').shadowRoot`
  const send=(method,params)=>page.webContents.debugger.sendCommand(method,params)
  const frame=()=>evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))')
  async function click(selector,shadow=false){
    const point=await evaluate(`(()=>{const s=${shadow?root:'document'},b=s.querySelector(${JSON.stringify(selector)}),r=b.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2;
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
  async function open(){
    const hit=await evaluate('panelProbe.layout.hit[0]')
    await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:hit.x,y:hit.y,button:'none',buttons:0})
    await waitFor(()=>evaluate('!document.querySelector(".minduck-actions").hidden'),Boolean,'quick controls hover')
    await click('[data-action="new-chat"]')
    await waitFor(()=>evaluate(`${root}.querySelector('textarea')?.disabled===false`),Boolean,'quick input ready')
    await new Promise(resolve=>setTimeout(resolve,300))
  }
  const escape=async()=>{await evaluate(`${root}.querySelector('textarea').focus();void 0`);for(const type of ['keyDown','keyUp'])await send('Input.dispatchKeyEvent',{type,key:'Escape',code:'Escape',windowsVirtualKeyCode:27});await new Promise(resolve=>setTimeout(resolve,300))}
  await evaluate('panelProbe.actions=[];panelProbe.targets=[];panelProbe.reply=null;panelProbe.failure=""')
  await evaluate(`panelProbe.motion=[];const start=performance.now();function sample(){const r=document.querySelector('.minduck-actions').getBoundingClientRect();panelProbe.motion.push({width:r.width,height:r.height,center:r.x+r.width/2});if(performance.now()-start<450)requestAnimationFrame(sample)}requestAnimationFrame(sample);void 0`)
  await open()
  const motion=await evaluate('panelProbe.motion')
  assert.ok(motion.some(frame=>frame.width>80.1 && frame.width<331.9),'container visibly animates through intermediate widths')
  assert.ok(motion.every(frame=>frame.height===42),'expansion keeps its original height')
  assert.deepEqual(await evaluate('panelProbe.actions'),['chat-context'],'opening never routes to the main client')
  assert.equal(await evaluate(`${root}.querySelector('.pet-quick-send').disabled`),true)
  await input('保留这段草稿');await escape();await open()
  assert.equal(await evaluate(`${root}.querySelector('textarea').value`),'保留这段草稿')
  for(const width of [375,768,1024,1440])for(const theme of ['light','dark']){
    page.setContentSize(width,600)
    await send('Emulation.setEmulatedMedia',{features:[{name:'prefers-color-scheme',value:theme}]});await frame()
    const state=await evaluate(`(()=>{const h=document.querySelector('.minduck-quick'),s=h.shadowRoot,r=document.querySelector('.minduck-actions').getBoundingClientRect(),f=s.querySelector('textarea').getBoundingClientRect(),b=s.querySelector('.pet-quick-send').getBoundingClientRect();return {theme:h.dataset.theme,w:r.width,h:r.height,left:r.left,right:r.right,field:f.height,send:b.height,font:getComputedStyle(s.querySelector('textarea')).fontSize,overflow:document.documentElement.scrollWidth>innerWidth};})()`)
    assert.equal(state.theme,theme);assert.equal(state.w,332);assert.equal(state.h,42);assert.equal(state.field,20);assert.equal(state.send,28);assert.equal(state.font,'14px')
    assert.ok(!state.overflow && state.left>=15.95 && state.right<=width-15.95,JSON.stringify(state))
    if(width===768)fs.writeFileSync(path.resolve(__dirname,'../build/companion-quick-chat-'+theme+'.png'),(await page.webContents.capturePage()).toPNG())
  }
  await evaluate(`panelProbe.failure='测试发送失败，请重试'`);await click('.pet-quick-send',true)
  await waitFor(()=>evaluate(`${root}.querySelector('[role=alert]')?.textContent`),s=>s?.includes('测试发送失败'),'quick error')
  assert.equal(await evaluate(`${root}.querySelector('textarea').value`),'保留这段草稿')
  await evaluate(`panelProbe.failure='';panelProbe.reply={ok:true,attachments:[{id:'quick-file',name:'快速资料.txt'}]}`)
  await click('.pet-quick-attach',true)
  await waitFor(()=>evaluate(`${root}.querySelector('.pet-attachments')?.textContent`),s=>s?.includes('快速资料.txt'),'quick attachment')
  assert.equal(await evaluate('document.querySelector(".minduck-actions").offsetHeight'),42,'attachments never increase capsule height')
  await evaluate('panelProbe.actions=[];panelProbe.targets=[];panelProbe.reply={ok:true,conversationId:"quick-created"};panelProbe.pause=true')
  await evaluate(`${root}.querySelector('textarea').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,isComposing:true}));void 0`)
  assert.equal(await evaluate('panelProbe.actions.length'),0)
  await click('.pet-quick-send',true)
  assert.equal(await evaluate('panelProbe.actions.length'),1)
  assert.equal(await evaluate(`${root}.querySelector('.pet-quick-send').disabled`),true)
  assert.deepEqual(await evaluate('panelProbe.targets[0]'),{contextId:'quick-context',text:'保留这段草稿',attachmentIds:['quick-file']})
  await evaluate('panelProbe.pause=false;panelProbe.release();void 0')
  await waitFor(()=>evaluate('!document.querySelector(".minduck-actions").classList.contains("is-composing")'),Boolean,'successful quick send collapses')
  await new Promise(resolve=>setTimeout(resolve,300));await open()
  assert.equal(await evaluate(`${root}.querySelector('textarea').value`),'','success clears only the sent draft')
  await escape();await evaluate('panelProbe.actions=[];panelProbe.targets=[];panelProbe.reply=null')
  console.log('PASS: quick editor expands 80→332 at 42px height, shared input/icons, real pointer input, draft restore, scoped attachments, errors, IME, one send, success collapse; 4 widths × light/dark')
}
