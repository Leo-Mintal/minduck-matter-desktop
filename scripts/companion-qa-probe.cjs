// Actual pet QA → isolated preload → native bridge → authenticated Matter API fixture.
const assert = require('node:assert/strict')
const http = require('node:http')
const fs = require('node:fs')
const path = require('node:path')
const { BrowserWindow } = require('electron')
const { DevToolsClient, devToolsPort } = require('./devtools-test-client.cjs')
const { createMatterTaskBridge } = require('../src/companion/task-bridge.cjs')
const { handleMatterQa } = require('../src/companion/qa-actions.cjs')

module.exports = async function probeQa({ companion, data, state, waitFor, setHandler }) {
  const streams=new Set(),replay=[],posts=[],quickPosts=[],queuePosts=[],stopPosts=[]
  let window,bridge,client,sequence=0,attempt=0,status='waiting',lastOutput
  const emit = (name,value) => {
    const frame=`id: ${++sequence}\nevent: ${name}\ndata: ${JSON.stringify(value)}\n\n`
    replay.push(frame)
    for(const stream of streams) if(stream.task)stream.response.write(frame)
  }
  const update = () => {
    for(const stream of streams) if(!stream.task)stream.response.write('event: sidebar.updated\ndata: {}\n\n')
  }
  const question = (id,spec) => emit('item.appended',{id,turn_id:'turn-one',conversation_id:'conv-one',seq:sequence+1,
    kind:'qa',payload:{state:'pending',interrupt_id:'interrupt-one',spec}})
  const server=http.createServer(async(request,response)=>{
    const url=new URL(request.url,'http://fixture')
    if(!url.pathname.startsWith('/api/')){
      response.writeHead(200,{'content-type':'text/html;charset=utf-8'}).end('<title>桌宠 QA 测试</title>');return
    }
    assert.equal(request.headers.authorization ?? `Bearer ${url.searchParams.get('access_token')}`,'Bearer qa-fixture-session')
    const org=request.headers['x-org-id'] ?? url.searchParams.get('org_id')
    if(url.pathname==='/api/conversations' && request.method==='GET'){
      response.writeHead(200,{'content-type':'application/json'}).end(JSON.stringify({conversations:org==='org-two'?[]:
        [{id:'conv-one',turn_status:status,title:'桌宠 QA 测试'}]}));return
    }
    if(url.pathname.endsWith('/events')){
      response.writeHead(200,{'content-type':'text/event-stream','cache-control':'no-cache'});response.flushHeaders()
      const stream={task:url.pathname!=='/api/events',response};streams.add(stream)
      response.on('close',()=>streams.delete(stream))
      if(stream.task)replay.forEach(frame=>response.write(frame));return
    }
    assert.equal(request.method,'POST','no mark-read conversation detail request')
    assert.equal(org,'org-one')
    let body='';for await(const chunk of request)body+=chunk.toString('utf8')
    response.setHeader('content-type','application/json')
    if(url.pathname==='/api/conversations'){
      quickPosts.push(JSON.parse(body));response.end(JSON.stringify({conversation:{id:'quick-created'}}));return
    }
    if(url.pathname==='/api/conversations/conv-one/messages'){
      queuePosts.push(JSON.parse(body));response.end(JSON.stringify({queued:true}));return
    }
    if(url.pathname==='/api/conversations/conv-one/stop'){
      assert.equal(body,'');stopPosts.push(url.pathname)
      status='stopped';emit('turn.status',{turn_id:'turn-one',status});update()
      response.end(JSON.stringify({stopped:true}));return
    }
    if(url.pathname==='/api/attachments'){
      assert.ok(request.headers['content-type'].startsWith('multipart/form-data; boundary='))
      assert.ok(body.includes('qa-fixture.txt') && body.includes('QA fixture content'))
      response.end(JSON.stringify({attachment:{id:'attachment-one',filename:'qa-fixture.txt'}}));return
    }
    assert.equal(url.pathname,'/api/interrupts/interrupt-one/resolve')
    posts.push(JSON.parse(body));attempt++
    if(attempt===1){response.writeHead(409).end(JSON.stringify({message:'测试接口暂不可用，请重试'}));return}
    if(attempt===2){response.end(JSON.stringify({ok:true,resolved:false}));return}
    // Intentionally deliver SSE before HTTP, as the real backend can.
    emit('qa.resolved',{item_id:posts.at(-1).item_id})
    status='running';emit('turn.status',{turn_id:'turn-one',status});update()
    response.end(JSON.stringify({ok:true,resolved:true}))
  })
  try {
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
    const origin=`http://127.0.0.1:${server.address().port}`
    const filename=path.join(data,'qa-fixture.txt');fs.writeFileSync(filename,'QA fixture content')
    window=new BrowserWindow({show:false,webPreferences:{contextIsolation:true,sandbox:true,backgroundThrottling:false}})
    const contents=window.webContents
    bridge=createMatterTaskBridge({contents,origin,onOutput:output=>{lastOutput=output;companion.setTaskOutput(output)}})
    setHandler((action,target)=>handleMatterQa({bridge,dialog:{showOpenDialog:async()=>({canceled:false,filePaths:[filename]})}},action,target))
    await contents.loadURL(origin)
    await contents.executeJavaScript(`localStorage.setItem('matter.token','qa-fixture-session');localStorage.setItem('matter.org','org-one')`)
    emit('turn.created',{id:'turn-one',status:'waiting',seq:1})
    question('qa-confirm',{variant:'confirm',q:'是否继续执行？',desc:'原生全链路确认',options:[{key:'no',label:'取消'},{key:'yes',label:'允许'}]})
    const port=await devToolsPort(path.join(data,'pet-window'))
    const targets=await(await fetch(`http://127.0.0.1:${port}/json/list`)).json()
    const target=targets.find(value=>value.type==='page' && value.url.split('#')[0]===state.url)
    assert.ok(target,'real native pet target');client=new DevToolsClient(target.webSocketDebuggerUrl)
    const evaluate=async(expression)=>{
      const result=await client.send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true})
      assert.ok(!result.exceptionDetails,result.exceptionDetails?.text);return result.result.value
    }
    const root=`document.querySelector('.minduck-qa')?.shadowRoot`
    await waitFor(()=>evaluate(`${root}?.querySelector('.pet-confirm')?.textContent`),value=>value?.includes('是否继续执行'),'native QA projection')
    assert.ok(!JSON.stringify(lastOutput).includes('qa-fixture-session'))
    assert.deepEqual(await evaluate(`({node:typeof require,token:localStorage.getItem('matter.token')})`),{node:'undefined',token:null})
    const click=async (selector,selectorRoot=root)=>{
      await evaluate(`${selectorRoot}.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'nearest'});void 0`)
      await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))')
      await waitFor(()=>evaluate(`(()=>{let opacity=1;for(let e=${selectorRoot}.querySelector(${JSON.stringify(selector)});e;e=e.parentElement || e.getRootNode().host)opacity*=Number(getComputedStyle(e).opacity);return opacity;})()`),
        value=>value>.99,'native control expansion finishes')
      const point=await evaluate(`(()=>{const s=${selectorRoot},button=s.querySelector(${JSON.stringify(selector)}),r=button.getBoundingClientRect();
        let visible=true,opacity=1;
        for(let e=button;e;e=e.parentElement || e.getRootNode().host){const c=getComputedStyle(e);
          visible=visible && c.display!=='none' && c.visibility==='visible' && c.pointerEvents!=='none';opacity*=Number(c.opacity);}
        const x=r.x+r.width/2,y=r.y+r.height/2,hit=s.elementFromPoint(x,y);
        return {x,y,visible,opacity,hit:hit===button || button.contains(hit),outer:document.elementFromPoint(x,y)===s.host};})()`)
      assert.ok(point.visible && point.opacity>.99 && point.hit && point.outer,JSON.stringify(point))
      for(const type of ['mousePressed','mouseReleased'])await client.send('Input.dispatchMouseEvent',{
        type,x:point.x,y:point.y,button:'left',buttons:type==='mousePressed'?1:0,clickCount:1,
      })
    }
    await click('.pet-confirm-actions .b:last-child')
    await waitFor(()=>evaluate(`${root}?.querySelector('[role=alert]')?.textContent`),text=>text?.includes('测试接口暂不可用'),'backend error reaches pet')
    await click('.pet-confirm-actions .b:last-child')
    await waitFor(()=>attempt,value=>value===2,'unresolved acknowledgement')
    await waitFor(()=>evaluate(`${root}?.querySelector('[role=status]')?.textContent`),text=>text?.includes('等待 Matter 更新'),'unresolved acknowledgement stays visible')
    await click('.pet-confirm-actions .b:last-child')
    await waitFor(()=>lastOutput,value=>value?.status==='running' && !value.qa,'resolved QA changes back to live progress')
    assert.deepEqual(posts[0],{item_id:'qa-confirm',picks:['yes'],custom:'',skipped:false})
    status='waiting';emit('turn.status',{turn_id:'turn-one',status})
    question('qa-input',{variant:'single',q:'补充文字与文件',options:[{key:'known',label:'使用现有方案'}],custom:true,selection_required:true,input_mode:'text_or_files',max_attachments:3})
    update()
    await waitFor(()=>evaluate(`${root}?.querySelector('textarea')!==null`),Boolean,'native input QA')
    await click('.pet-option')
    await click('.pet-attach')
    await waitFor(()=>evaluate(`${root}?.querySelector('.pet-attachments')?.textContent`),text=>text?.includes('qa-fixture.txt'),'native chooser and authenticated upload')
    await evaluate(`(()=>{const field=${root}.querySelector('textarea');
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(field,'真实链路回答');
      field.dispatchEvent(new Event('input',{bubbles:true,composed:true}));})()`)
    const stale={...lastOutput.qa,conversationId:'conv-one',turnId:'turn-one',picks:[],custom:'陈旧组织回答',attachmentIds:[]}
    await click('.pet-qa-go')
    await waitFor(()=>posts.length,value=>value===4,'native input answer resolves')
    assert.deepEqual(posts[3],{item_id:'qa-input',picks:[],custom:'真实链路回答',skipped:false,attachment_ids:['attachment-one']})
    await evaluate(`document.querySelector('[data-action="new-chat"]').click();void 0`)
    const quick=`document.querySelector('.minduck-quick').shadowRoot`
    await waitFor(()=>evaluate(`${quick}.querySelector('textarea')?.disabled===false`),Boolean,'native quick editor')
    await new Promise(resolve=>setTimeout(resolve,300))
    await evaluate(`(()=>{const field=${quick}.querySelector('textarea');
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(field,'桌宠中的新聊天');
      field.dispatchEvent(new Event('input',{bubbles:true,composed:true}));})()`)
    await click('.pet-quick-attach',quick)
    await waitFor(()=>evaluate(`${quick}.querySelector('.pet-attachments')?.textContent`),text=>text?.includes('qa-fixture.txt'),'quick native file upload')
    await click('.pet-quick-send',quick)
    await waitFor(()=>quickPosts.length,value=>value===1,'native quick conversation created')
    assert.deepEqual(quickPosts[0],{scope:'platform',text:'桌宠中的新聊天',tz:Intl.DateTimeFormat().resolvedOptions().timeZone,attachment_ids:['attachment-one']})
    await waitFor(()=>evaluate(`!document.querySelector('.minduck-actions').classList.contains('is-composing')`),Boolean,'quick send collapses')
    const running=`document.querySelector('.minduck-running').shadowRoot`
    await waitFor(()=>evaluate(`${running}?.querySelector('.pet-running-append')?.disabled===false`),Boolean,'native running actions')
    const staleTask={contextId:lastOutput.contextId,conversationId:'conv-one',turnId:'turn-one'}
    await click('.pet-running-append',running)
    await waitFor(()=>evaluate(`${running}.querySelector('textarea')?.disabled===false`),Boolean,'native queue composer')
    await evaluate(`(()=>{const field=${running}.querySelector('textarea');
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(field,'当前会话里的排队消息');
      field.dispatchEvent(new Event('input',{bubbles:true,composed:true}));})()`)
    await click('.pet-quick-attach',running)
    await waitFor(()=>evaluate(`${running}.querySelector('.pet-attachments')?.textContent`),text=>text?.includes('qa-fixture.txt'),'queue native upload')
    await click('.pet-quick-send',running)
    await waitFor(()=>queuePosts.length,count=>count===1,'native queue API accepted')
    assert.deepEqual(queuePosts[0],{text:'当前会话里的排队消息',attachment_ids:['attachment-one']})
    assert.equal(quickPosts.length,1,'top queue never creates a new conversation')
    await waitFor(()=>evaluate(`${running}.querySelector('.pet-running-stop')?.disabled===false`),Boolean,'stop enabled after queue')
    await click('.pet-running-stop',running)
    await waitFor(()=>stopPosts.length,count=>count===1,'native direct stop API')
    await waitFor(()=>lastOutput,value=>!value.active,'stopped task leaves pet')
    status='waiting';emit('turn.status',{turn_id:'turn-one',status})
    question('qa-next',{variant:'confirm',q:'切换组织后的旧卡测试',options:[{key:'yes',label:'允许'}]});update()
    await waitFor(()=>lastOutput,value=>value?.qa?.itemId==='qa-next','next native question')
    await contents.executeJavaScript(`localStorage.setItem('matter.org','org-two')`)
    const rejected=await evaluate(`petHost.matterAction('qa-answer',${JSON.stringify(stale)}).then(()=>'',error=>error.message)`)
    assert.ok(rejected.includes('切换') || rejected.includes('已处理'),rejected)
    assert.equal(posts.length,4,'stale organization card cannot send a mutation')
    const taskRejected=await evaluate(`petHost.matterAction('chat-stop',${JSON.stringify(staleTask)}).then(()=>'',error=>error.message)`)
    assert.ok(taskRejected.includes('切换') || taskRejected.includes('更新'),taskRejected)
    assert.equal(stopPosts.length,1,'stale task cannot stop a new organization task')
    await waitFor(()=>lastOutput,value=>value?.active===false,'organization switch clears native QA')
    console.log('PASS: real pet QA and new platform chat preserved; native queue/upload/direct stop use exact conversation API and payload; early SSE and stale organization rejection; no backend/shared Web changes')
  } finally {
    bridge?.dispose();client?.close();window?.destroy()
    for(const stream of streams)stream.response.end()
    const closed = new Promise(resolve=>server.close(resolve))
    server.closeAllConnections()
    await closed
  }
}
