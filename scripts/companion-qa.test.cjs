const assert = require('node:assert/strict')
const { test } = require('node:test')
const vm = require('node:vm')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { createQaContract } = require('../src/companion/qa-contract.cjs')
const { installMatterTaskMonitor } = require('../src/companion/task-monitor.cjs')
const { handleMatterQa } = require('../src/companion/qa-actions.cjs')
const { createMatterActionBridge, sendMatterAction, normalizeMatterOutput } = require('../src/companion/matter-actions.cjs')
const contract = createQaContract()
const scope = { conversationId:'conv-one', turnId:'turn-one', contextId:'context-one', itemId:'qa-one', interruptId:'interrupt-one' }
const spec = { variant:'confirm', q:'允许吗？', options:[{key:'yes',label:'允许'},{key:'no',label:'取消'}] }
const question = definition => contract.project({ ...scope, spec:definition })
const answer = value => contract.target({ ...scope, ...value }, 'answer')
const json = value => JSON.parse(JSON.stringify(value))

test('QA projection is bounded public metadata and survives both native passes', () => {
  const qa = question({ ...spec, token:'secret', tool_args:'secret', options:[{key:'yes',label:'字'.repeat(1000), token:'secret'}] })
  assert.equal(qa.spec.options[0].label.length, 500)
  const task = { active:true, status:'waiting', ...scope, qa }
  const output = normalizeMatterOutput(task)
  assert.deepEqual(normalizeMatterOutput(output), output)
  assert.ok(!JSON.stringify(output).includes('secret'))
  assert.deepEqual(output.tasks[0].qa, output.qa, 'the queued question keeps its own actionable QA spec')
  assert.equal(contract.project({ ...qa, itemId:'../bad' }), null)
  assert.throws(() => answer({ custom:'x'.repeat(20001) }), /Invalid/)
})

test('queued QA specs stay public, independently actionable and within the native frame budget', () => {
  const tasks=Array.from({length:200},(_,i)=>({active:true,status:'waiting',conversationId:'conv-'+i,turnId:'turn-'+i,
    detail:'问题 '+i,qa:contract.project({...scope,itemId:'qa-'+i,interruptId:'interrupt-'+i,
      spec:{...spec,options:Array.from({length:40},(_,n)=>({key:'pick-'+n,label:'字'.repeat(500),token:'secret'}))}})}))
  const result=normalizeMatterOutput({...tasks[0],tasks})
  assert.equal(result.tasks.length,200)
  assert.ok(result.tasks.some(task=>task.qa) && result.tasks.some(task=>!task.qa))
  assert.ok(JSON.stringify(result).length<1048576)
  assert.ok(!JSON.stringify(result).includes('secret'))
  assert.deepEqual(normalizeMatterOutput(result),result,'both native passes retain queue targets and budget')
  assert.equal(result.tasks[1].qa.itemId,'qa-1')
  assert.equal(result.tasks.at(-1).detail,'问题 199','oversized queues retain normal message routing')
})

test('QA answers validate current options, selection count, explicit skips and attachment ownership', () => {
  const validate = (definition, value, files=new Set()) => contract.validateAnswer(question(definition), answer(value), files)
  assert.deepEqual(validate(spec,{picks:['yes']}), {item_id:'qa-one',picks:['yes'],custom:'',skipped:false})
  assert.throws(() => validate(spec,{picks:['unknown']}), /更新/)
  assert.throws(() => validate(spec,{picks:['yes','no']}), /一项/)
  assert.throws(() => validate(spec,{custom:'偷偷补充'}), /不接受/)
  assert.throws(() => validate(spec,{skipped:true}), /不能跳过/)
  assert.equal(validate({...spec,skippable:true},{skipped:true}).skipped,true)
  assert.deepEqual(validate({...spec,variant:'multi'},{picks:['yes','no']}).picks,['yes','no'])
  const input = {...spec,variant:'single',custom:true,max_attachments:1}
  assert.throws(() => validate(input,{attachmentIds:['another-qa-file']}), /附件/)
  assert.throws(() => validate(input,{attachmentIds:['one','two']},new Set(['one','two'])), /附件/)
  assert.deepEqual(validate(input,{custom:'回答',attachmentIds:['one']},new Set(['one'])).attachment_ids,['one'])
  assert.throws(() => contract.validateAnswer({...question(spec),reviewInApp:true},answer({picks:['yes']}),new Set()), /Matter/)
})

test('multi-question answers bind stable page IDs across reorder and keep attachments with their question', () => {
  const pages = [{...spec,variant:'single',page_id:'a',custom:true},{...spec,variant:'single',page_id:'b'}]
  const value = answer({pageAnswers:[{page_id:'b',picks:[],text:'',attachment_ids:[],skipped:true},
    {page_id:'a',picks:[],text:'A 的资料',attachment_ids:['file-a'],skipped:false}]})
  const validate = data => contract.validateAnswer(question({variant:'multiq',pages:[...pages].reverse()}),data,new Set(['file-a']))
  assert.equal(validate(value).page_answers[1].attachment_ids[0],'file-a')
  assert.throws(() => validate({...value,pageAnswers:[value.pageAnswers[0],value.pageAnswers[0]]}), /更新/)
  assert.throws(() => validate({...value,pageAnswers:value.pageAnswers.slice(1)}), /更新/)
  assert.throws(() => validate(answer({pageAnswers:pages.map(page => ({page_id:page.page_id,picks:[],text:'',skipped:true}))})), /至少回答/)
  assert.deepEqual(contract.validateAnswer(question({variant:'multiq',pages:pages.map(({page_id,...page})=>page)}),
    answer({answers:['原合同的答案','']}),new Set()).answers,['原合同的答案',''])
})

test('single-choice custom answers are exclusive with ordinary options, including required selections', () => {
  const validate = (definition, value) => contract.validateAnswer(question(definition), answer(value), new Set(['file-one']))
  for (const selection_required of [false,true]) {
    const definition = {...spec,variant:'single',custom:true,selection_required}
    assert.deepEqual(validate(definition,{picks:['yes']}).picks,['yes'])
    assert.equal(validate(definition,{custom:'其他方向'}).custom,'其他方向')
    assert.deepEqual(validate(definition,{attachmentIds:['file-one']}).attachment_ids,['file-one'])
    assert.throws(() => validate(definition,{picks:['yes'],custom:'其他方向'}), /只能选择一项/)
    assert.throws(() => validate(definition,{picks:['yes'],attachmentIds:['file-one']}), /只能选择一项/)
    assert.throws(() => validate(definition,{custom:'  '}), /请先/)
  }
  const supplement = {...spec,variant:'single',selection_required:true,
    options:[...spec.options,{key:'other',label:'其他',action:'await_user_input'}]}
  assert.deepEqual(validate(supplement,{picks:['other'],custom:'补充回答'}).picks,['other'])
  for (const variant of ['confirm','multi']) {
    const definition = {...spec,variant,custom:true,selection_required:true}
    assert.deepEqual(validate(definition,{picks:['yes'],custom:'保留的补充说明'}).picks,['yes'])
    assert.throws(() => validate(definition,{custom:'仍需选择'}), /请选择|请先选择/)
  }
})

test('single-choice page answers enforce the same custom/option exclusivity', () => {
  const definition = {variant:'multiq',pages:[{...spec,variant:'single',page_id:'one',custom:true,selection_required:true}]}
  const validate = draft => contract.validateAnswer(question(definition), answer({pageAnswers:[{
    page_id:'one',picks:[],text:'其他方向',...draft,
  }]}), new Set())
  assert.equal(validate({}).page_answers[0].text,'其他方向')
  assert.throws(() => validate({picks:['yes']}), /只能选择一项/)
  assert.deepEqual(validate({picks:['yes'],text:''}).page_answers[0].picks,['yes'])
})

function monitorFixture(rows=[{id:'conv-one',turn_status:'waiting'}]) {
  const storage = new Map([['matter.token','fixture-session'],['matter.org','org-one']]), sources=[], requests=[]
  let post = async () => ({ok:true,resolved:false})
  class Source {
    constructor(url) { this.url=url;this.listeners={};sources.push(this) }
    addEventListener(name,fn) { this.listeners[name]=fn }
    close() { this.closed=true }
  }
  const monitor = vm.runInNewContext(`(${installMatterTaskMonitor.toString()})((${createQaContract.toString()})())`, {
    localStorage:{getItem:key=>storage.get(key)},EventSource:Source,URLSearchParams,AbortController,AbortSignal,
    FormData,Blob,atob,Uint8Array,setTimeout,clearTimeout,
    fetch:async (url,options) => {
      requests.push({url,options})
      if (!options.method) return {ok:true,json:async()=>({conversations:rows})}
      return {ok:true,json:async()=>post(url,options)}
    },
  })
  const read = () => json(monitor.tick())
  const emit = (name,data,conversationId='conv-one') => {
    const source = sources.findLast(value => !value.closed && value.url.startsWith('/api/conversations/'+conversationId+'/'))
    assert.ok(source,'active task stream')
    source.listeners[name]({data:JSON.stringify(data)})
  }
  return {monitor,storage,requests,read,emit,setPost:fn=>{post=fn},async ready(definition=spec) {
    read();await new Promise(setImmediate)
    emit('item.appended',{id:'qa-one',turn_id:'turn-one',seq:1,kind:'qa',payload:{state:'pending',interrupt_id:'interrupt-one',spec:definition}})
    const output=read()
    return {...scope,contextId:output.qa.contextId}
  }}
}

test('every simultaneous waiting conversation projects and answers its own QA, not the primary question', async t => {
  const f=monitorFixture(['conv-one','conv-two'].map(id=>({id,turn_status:'waiting'})))
  t.after(()=>f.monitor.stop());await f.ready()
  f.emit('item.appended',{id:'qa-two',turn_id:'turn-two',seq:1,kind:'qa',payload:{state:'pending',
    interrupt_id:'interrupt-two',spec:{...spec,q:'第二个会话的问题'}}},'conv-two')
  const output=normalizeMatterOutput(f.read()),task=output.tasks.find(task=>task.conversationId==='conv-two')
  assert.equal(output.tasks.filter(task=>task.qa).length,2)
  assert.equal(task.qa.spec.q,'第二个会话的问题')
  await f.monitor.act('answer',{...task,...task.qa,picks:['yes']})
  const request=f.requests.find(value=>value.options.method==='POST')
  assert.equal(request.url,'/api/interrupts/interrupt-two/resolve')
  assert.equal(JSON.parse(request.options.body).item_id,'qa-two')
})

test('isolated QA monitor sends the original resolve contract with current credentials and waits for explicit resolution', async t => {
  const f=monitorFixture();t.after(()=>f.monitor.stop());const target=await f.ready()
  let result=await f.monitor.act('answer',{...target,picks:['yes']})
  assert.equal(result.resolved,false)
  assert.ok(f.read().qa,'acknowledgement alone keeps the question')
  const request=f.requests.find(value=>value.options.method==='POST')
  assert.equal(request.url,'/api/interrupts/interrupt-one/resolve')
  assert.deepEqual(JSON.parse(request.options.body),{item_id:'qa-one',picks:['yes'],custom:'',skipped:false})
  assert.equal(request.options.headers.Authorization,'Bearer fixture-session')
  assert.equal(request.options.headers['X-Org-ID'],'org-one')
  assert.ok(!JSON.stringify(f.read()).includes('fixture-session'))
  f.setPost(async()=>({ok:true,qa:{state:'answered'}}))
  result=await f.monitor.act('answer',{...target,picks:['yes']})
  assert.equal(result.resolved,true)
  assert.equal(f.read().qa,undefined)
  await assert.rejects(f.monitor.act('answer',{...target,picks:['yes']}),/已处理/)
})

test('QA monitor handles SSE before HTTP, rejects duplicate submits and preserves failed answers', async t => {
  const f=monitorFixture();t.after(()=>f.monitor.stop());const target=await f.ready()
  let release
  f.setPost(()=>new Promise(resolve=>{release=resolve}))
  const pending=f.monitor.act('answer',{...target,picks:['yes']})
  await new Promise(setImmediate)
  await assert.rejects(f.monitor.act('answer',{...target,picks:['yes']}),/提交/)
  f.emit('qa.resolved',{item_id:'qa-one'})
  release({ok:true,resolved:true})
  assert.equal((await pending).resolved,true,'early SSE is a success, not a stale-card error')
})

test('QA monitor refuses old organization cards before any mutation and after in-flight replies', async t => {
  const f=monitorFixture();t.after(()=>f.monitor.stop());const target=await f.ready()
  f.storage.set('matter.org','org-two')
  await assert.rejects(f.monitor.act('answer',{...target,picks:['yes']}),/切换/)
  assert.equal(f.requests.filter(value=>value.options.method==='POST').length,0)
  f.storage.set('matter.org','org-one')
  f.setPost(async()=>{f.storage.set('matter.org','org-two');return {ok:true,resolved:true}})
  await assert.rejects(f.monitor.act('answer',{...target,picks:['yes']}),/切换/)
})

test('QA upload uses authenticated multipart and only accepts attachments uploaded for this question', async t => {
  const f=monitorFixture();t.after(()=>f.monitor.stop());const target=await f.ready({...spec,custom:true,input_mode:'text_or_files'})
  f.setPost(async(url,options)=>{
    if(url==='/api/attachments') {
      const file=options.body.get('file');assert.equal(file.name,'说明.txt');assert.equal(await file.text(),'资料')
      return {attachment:{id:'file-one',filename:'说明.txt'}}
    }
    assert.deepEqual(JSON.parse(options.body).attachment_ids,['file-one']);return {ok:true,resolved:false}
  })
  assert.deepEqual(json(await f.monitor.act('upload',target,[{name:'说明.txt',base64:Buffer.from('资料').toString('base64')}])),
    {ok:true,attachments:[{id:'file-one',name:'说明.txt'}]})
  await assert.rejects(f.monitor.act('answer',{...target,picks:['yes'],attachmentIds:['foreign-file']}),/附件/)
  assert.equal((await f.monitor.act('answer',{...target,picks:['yes'],attachmentIds:['file-one']})).ok,true)
  f.setPost(async()=>({ok:false,message:'<b>请补充信息</b>'}))
  await assert.rejects(f.monitor.act('answer',{...target,picks:['yes']}),/请补充信息/)
  assert.ok(f.read().qa,'errors retain the pending question')
})

test('native QA chooser is scoped, allows cancellation and never accepts pet-supplied file paths', async t => {
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'minduck-qa-files-'));t.after(()=>fs.rm(directory,{recursive:true,force:true}))
  const filename=path.join(directory,'资料.txt');await fs.writeFile(filename,'资料')
  const calls=[];let canceled=true
  const bridge={executeQa:async(command,target,files)=>{
    calls.push({command,target,files});return command==='upload'?{ok:true,attachments:[{id:'file-one',name:files[0].name}]}:{ok:true}
  }}
  const dialog={showOpenDialog:async()=>({canceled,filePaths:canceled?[]:[filename]})}
  assert.deepEqual(await handleMatterQa({bridge,dialog},'qa-upload',{...scope,filePaths:['/private/unselected']}),{ok:true,attachments:[]})
  canceled=false
  assert.equal((await handleMatterQa({bridge,dialog},'qa-upload',scope)).attachments[0].id,'file-one')
  assert.equal(calls.at(-1).files[0].base64,Buffer.from('资料').toString('base64'))
  assert.ok(!JSON.stringify(calls).includes('/private/unselected'))
  let shown=false
  await assert.rejects(handleMatterQa({bridge:{executeQa:async()=>{throw Error('已处理')}},
    dialog:{showOpenDialog:async()=>{shown=true}}},'qa-upload',scope),/已处理/)
  assert.equal(shown,false)
})

test('QA HTTP bridge validates JSON and returns actual results/errors without forwarding arbitrary fields', async t => {
  const received=[]
  const bridge=createMatterActionBridge(async(action,target)=>{
    received.push({action,target});if(action==='qa-upload')throw Error('请等待消息刷新')
    return {ok:true,resolved:false}
  });t.after(()=>bridge.stop());const environment=await bridge.start()
  assert.deepEqual(await sendMatterAction('qa-answer',environment,{...scope,picks:['yes'],path:'/private/file',token:'secret'}),{ok:true,resolved:false})
  assert.ok(!JSON.stringify(received).includes('secret'))
  assert.equal(received[0].target.path,undefined)
  await assert.rejects(sendMatterAction('qa-upload',environment,scope),/消息刷新/)
  const headers={authorization:`Bearer ${environment.MINDUCK_COMPANION_ACTION_TOKEN}`,'content-type':'application/json'}
  const origin=environment.MINDUCK_COMPANION_ACTION_ORIGIN
  assert.equal((await fetch(origin+'/qa-answer',{method:'POST',headers,body:'not-json'})).status,400)
  assert.equal((await fetch(origin+'/qa-answer',{method:'POST',headers,body:' '.repeat(524289)})).status,400)
  assert.equal((await fetch(origin+'/qa-answer',{method:'POST',headers:{...headers,origin:'https://remote.test'},body:JSON.stringify(scope)})).status,403)
})

test('quick chat uses the original platform conversation contract and rejects stale sessions/files', async t => {
  const f=monitorFixture();t.after(()=>f.monitor.stop());await f.ready()
  const context=json(await f.monitor.act('chat-context',{}))
  assert.deepEqual(Object.keys(context).sort(),['contextId','ok'])
  const target={contextId:context.contextId,text:' 桌宠里发起的新聊天 ',attachmentIds:[]}
  f.setPost(async(url,options)=>{
    assert.equal(url,'/api/conversations')
    const body=JSON.parse(options.body)
    assert.equal(body.scope,'platform');assert.equal(body.text,'桌宠里发起的新聊天');assert.ok(body.tz)
    assert.equal(options.headers.Authorization,'Bearer fixture-session');assert.equal(options.headers['X-Org-ID'],'org-one')
    return {conversation:{id:'quick-conversation'}}
  })
  assert.deepEqual(json(await f.monitor.act('chat-send',target)),{ok:true,conversationId:'quick-conversation'})
  await assert.rejects(f.monitor.act('chat-send',{...target,attachmentIds:['foreign']}),/附件/)
  await assert.rejects(f.monitor.act('chat-send',{...target,text:' '}),/填写/)
  assert.throws(()=>contract.chatTarget({...target,text:'字'.repeat(20001)},'send'),/20000/)
  assert.deepEqual(contract.chatTarget({...target,token:'secret',url:'https://bad'},'send'),
    {contextId:target.contextId,text:target.text.trim(),attachmentIds:[]})
  f.storage.set('matter.org','different-org')
  await assert.rejects(f.monitor.act('chat-send',target),/切换/)
  assert.equal(f.requests.filter(v=>v.options.method==='POST').length,1)
})

test('quick chat owns its uploaded attachments, prevents duplicate sends and retains retry state', async t => {
  const f=monitorFixture();t.after(()=>f.monitor.stop());const qa=await f.ready({...spec,custom:true})
  const {contextId}=await f.monitor.act('chat-context',{})
  f.setPost(async()=>({attachment:{id:'chat-file'}}))
  await f.monitor.act('chat-upload',{contextId},[{name:'quick.txt',base64:Buffer.from('quick').toString('base64')}])
  await assert.rejects(f.monitor.act('answer',{...qa,picks:['yes'],attachmentIds:['chat-file']}),/附件/)
  let release
  f.setPost(()=>new Promise(resolve=>{release=resolve}))
  const answer={contextId,text:'快速消息',attachmentIds:['chat-file']}
  const sending=f.monitor.act('chat-send',answer)
  await new Promise(setImmediate)
  await assert.rejects(f.monitor.act('chat-send',answer),/提交/)
  release({ok:false,message:'稍后重试'});await assert.rejects(sending,/重试/)
  f.setPost(async()=>({conversation:{id:'created'}}))
  assert.equal((await f.monitor.act('chat-send',answer)).ok,true)
  await assert.rejects(f.monitor.act('chat-send',answer),/附件/,'successful send consumes attachment ownership')
})

test('quick chat crosses the native HTTP bridge with a bounded public payload', async t => {
  const received=[]
  const bridge=createMatterActionBridge(async(action,target)=>{received.push({action,target});return {ok:true,contextId:'ctx-one'}})
  t.after(()=>bridge.stop());const env=await bridge.start()
  assert.deepEqual(await sendMatterAction('chat-context',env,{}),{ok:true,contextId:'ctx-one'})
  await sendMatterAction('chat-send',env,{contextId:'ctx-one',text:'你好',token:'secret',filePaths:['/private/file']})
  assert.deepEqual(received[1],{action:'chat-send',target:{contextId:'ctx-one',text:'你好',attachmentIds:[]}})
  await assert.rejects(sendMatterAction('chat-send',env,{contextId:'ctx-one',text:''}),/填写/)
})

test('running task actions bind the exact conversation and turn, never create a platform chat', async t => {
  const f=monitorFixture([{id:'conv-one',turn_status:'running'}]);t.after(()=>f.monitor.stop());await f.ready()
  const task=f.read(),target={contextId:task.contextId,conversationId:task.conversationId,turnId:task.turnId}
  assert.deepEqual(normalizeMatterOutput(task).contextId,target.contextId)
  assert.throws(()=>contract.chatTarget({...target,text:'追加'},'send'),/填写/)
  assert.throws(()=>contract.chatTarget({...target,turnId:'../bad',text:'追加'},'queue'),/更新/)
  f.setPost(async(url,options)=>{
    assert.equal(url,'/api/conversations/conv-one/messages')
    assert.deepEqual(JSON.parse(options.body),{text:'追加到队尾'})
    assert.equal(options.headers.Authorization,'Bearer fixture-session')
    assert.equal(options.headers['X-Org-ID'],'org-one')
    return {queued:true,queue:[{id:'queued-one'}]}
  })
  assert.deepEqual(json(await f.monitor.act('chat-queue',{...target,text:' 追加到队尾 '})),
    {ok:true,conversationId:'conv-one',queued:true})
  f.setPost(async(url,options)=>{
    assert.equal(url,'/api/conversations/conv-one/stop');assert.equal(options.body,undefined)
    f.emit('turn.status',{turn_id:'turn-one',status:'stopped'})
    return {stopped:true}
  })
  assert.deepEqual(json(await f.monitor.act('chat-stop',target)),{ok:true,stopped:true},'successful stop survives earlier SSE')
  await assert.rejects(f.monitor.act('chat-stop',target),/结束|更新/)
  await assert.rejects(f.monitor.act('chat-queue',{...target,turnId:'another-turn',text:'陈旧追加'}),/更新/)
  f.storage.set('matter.org','org-two')
  await assert.rejects(f.monitor.act('chat-stop',target),/切换/)
  assert.equal(f.requests.filter(request=>request.options.method==='POST').length,2)
})

test('running queue retains retry attachments, isolates task owners and prevents duplicate operations', async t => {
  const f=monitorFixture(['conv-one','conv-two'].map(id=>({id,turn_status:'running'})))
  t.after(()=>f.monitor.stop());await f.ready()
  f.emit('turn.created',{id:'turn-two',status:'running',seq:2},'conv-two')
  const target={contextId:f.read().contextId,conversationId:'conv-one',turnId:'turn-one'}
  f.setPost(async()=>({attachment:{id:'task-file'}}))
  await f.monitor.act('chat-upload',target,[{name:'queue.txt',base64:Buffer.from('queue').toString('base64')}])
  // List reconciliation must not invalidate files while the task remains active.
  f.emit('queue.updated',{});f.read();await new Promise(setImmediate)
  const value={...target,text:'追加',attachmentIds:['task-file']}
  await assert.rejects(f.monitor.act('chat-send',{contextId:target.contextId,text:'新聊天',attachmentIds:['task-file']}),/附件/)
  await assert.rejects(f.monitor.act('chat-queue',{...value,conversationId:'conv-two',turnId:'turn-two'}),/附件/)
  let release
  f.setPost(()=>new Promise(resolve=>{release=resolve}))
  const sending=f.monitor.act('chat-queue',value);await new Promise(setImmediate)
  await assert.rejects(f.monitor.act('chat-queue',value),/提交/)
  await assert.rejects(f.monitor.act('chat-stop',target),/提交/)
  release({ok:false,message:'稍后重试'});await assert.rejects(sending,/重试/)
  f.setPost(async()=>({queued:true}))
  assert.equal((await f.monitor.act('chat-queue',value)).queued,true)
  await assert.rejects(f.monitor.act('chat-queue',value),/附件/)
})

test('native task actions validate bounded public targets before transport or chooser', async t => {
  const received=[]
  const bridge=createMatterActionBridge(async(action,target)=>{received.push({action,target});return {ok:true,stopped:true}})
  t.after(()=>bridge.stop());const env=await bridge.start()
  const target={contextId:'ctx',conversationId:'conv',turnId:'turn'}
  await sendMatterAction('chat-stop',env,{...target,token:'secret',text:'ignored'})
  await sendMatterAction('chat-queue',env,{...target,text:'追加'})
  assert.deepEqual(received,[{action:'chat-stop',target},{action:'chat-queue',target:{...target,text:'追加',attachmentIds:[]}}])
  let chose=false
  await assert.rejects(handleMatterQa({bridge:{executeQa:async(command)=>{
    assert.equal(command,'chat-check');throw Error('任务已更新')
  }},dialog:{showOpenDialog:()=>{chose=true}}},'chat-upload',target),/更新/)
  assert.equal(chose,false)
})
