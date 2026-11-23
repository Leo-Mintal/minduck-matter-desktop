const test=require('node:test')
const assert=require('node:assert/strict')
const {once}=require('node:events')
const http=require('node:http')
const {createClientRuntime}=require('../src/client-runtime.cjs')
const {connectDesktop}=require('../src/local-exec/connection.cjs')
const {WebSocketServer}=require('../vendor/coopanion/runtime/node_modules/ws')
const jwt=uid=>'h.'+Buffer.from(JSON.stringify({uid,exp:Date.now()/1000+600})).toString('base64url')+'.s'
const origin='https://matter.test'
const nativePermissions={localPermissions:{version:1,mode:'macos-native'}}

test('one login runtime serves browser and shell without pairing; bridge binds origin and account',async t=>{
 let token=jwt('u1'), connectionOptions, localCalls=0, browserCalls=0
 let localStatus={enabled:true,state:'在线',permissionRequired:false,canRequestPermission:true,canOpenFile:true}
 const requests=[]
 const controller=createClientRuntime({app:{getVersion:()=> 'test'},origin,bridgePort:19474,
  getContents:()=>contents,localExec:{snapshot:()=>localStatus,execute:async()=>{localCalls++;return{stdout:'ok',exit_code:0}}},
  toolkit:{schemas:[],release(){},execute:async()=>{browserCalls++;return{content:[]}}},
  verifyFetch:async(url,options)=>{requests.push(url);return{ok:options.headers.Authorization==='Bearer '+token}},
  connect:options=>{connectionOptions=options;options.onInitialize(nativePermissions);options.onState('在线');options.onContext('proof');return{stop(){},updateCapabilities(){}}},
 })
 const contents={isDestroyed:()=>false,getURL:()=>origin+'/c/c1',executeJavaScriptInIsolatedWorld:async()=>token}
 t.after(()=>controller.dispose())
 await controller.refresh()
 assert.ok(connectionOptions.runtimeId.startsWith('rt_'));assert.equal(connectionOptions.deviceId,undefined)
 assert.equal(connectionOptions.url,'wss://matter.test/api/client-runtime/ws')
 assert.equal(connectionOptions.capabilities.clientRuntime.fileOpen,1)
 assert.deepEqual(connectionOptions.getCapabilities(),{browser:true,shell:true,shell_permission:true})
 localStatus={enabled:false,state:'已关闭',permissionRequired:false,canRequestPermission:false}
 assert.deepEqual(connectionOptions.getCapabilities(),{browser:true,shell:false,shell_permission:false})
 assert.equal(controller.snapshot().available,true);assert.equal(controller.snapshot().shell,false)
 assert.equal(controller.snapshot().shell_permission,false)
 assert.equal(controller.snapshot().account,'u1')
 assert.equal(JSON.stringify(controller.snapshot()).includes(token),false)
 localStatus={enabled:true,state:'在线',permissionRequired:false,canRequestPermission:true}
 const headers=controller.headers({Authorization:'Bearer '+token,'X-Matter-Desktop':'old'},origin+'/api/matter/conversations')
 assert.equal(headers['X-Matter-Runtime'],'proof');assert.equal(headers['X-Matter-Desktop'],undefined)
 assert.equal(controller.headers({Authorization:'Bearer '+jwt('u2')},origin+'/api/x')['X-Matter-Runtime'],undefined)
 const contextURL='http://127.0.0.1:19474/context'
 assert.equal(controller.headers({},contextURL,origin+'/c/c1').Origin,origin)
 assert.equal(controller.headers({},contextURL).Origin,undefined)
 assert.equal(controller.headers({},contextURL,'https://evil.test/').Origin,undefined)
 assert.equal(controller.headers({},contextURL+'?x=1',origin).Origin,undefined)
 assert.equal(controller.headers({},'http://127.0.0.1:19475/context',origin).Origin,undefined)
 assert.equal(controller.headers({Origin:'https://evil.test'},contextURL,origin).Origin,'https://evil.test')
 await connectionOptions.execute({name:'local_shell'},new AbortController().signal)
 await connectionOptions.execute({name:'chrome_read_page'},new AbortController().signal)
 assert.equal(localCalls,1);assert.equal(browserCalls,1)
 const bridge=await fetch('http://127.0.0.1:19474/context',{headers:{Origin:origin,Authorization:'Bearer '+token}})
 assert.equal(bridge.status,200);assert.equal((await bridge.json()).runtime_context,'proof')
 assert.equal((await fetch('http://127.0.0.1:19474/context',{headers:{Origin:'https://evil.test',Authorization:'Bearer '+token}})).status,403)
 assert.equal((await fetch('http://127.0.0.1:19474/context',{headers:{Origin:origin,Authorization:'Bearer '+jwt('u2')}})).status,409)
 assert.deepEqual(requests,[origin+'/api/me'])
 const old=connectionOptions;token=jwt('u2');await controller.refresh()
 await assert.rejects(old.execute({name:'local_shell'},new AbortController().signal),/已变化/)
 assert.equal(connectionOptions.token,token)
})

test('web discovery verifies JWT independently of Chromium and reports the actual failure',async t=>{
 const blocker=http.createServer();blocker.listen(0,'127.0.0.1');await once(blocker,'listening')
 const port=blocker.address().port;await new Promise(resolve=>blocker.close(resolve))
 const token=jwt('u1');let options, mode='ok', cancelled=0
 const controller=createClientRuntime({app:{getVersion:()=> 'test'},origin,bridgePort:port,
  getContents:()=>({isDestroyed:()=>false,getURL:()=>origin,executeJavaScriptInIsolatedWorld:async()=>token}),
  localExec:{snapshot:()=>({enabled:true,state:'在线',canRequestPermission:true})},toolkit:{schemas:[],release(){}},
  fetchImpl:async()=>assert.fail('bridge must not use Chromium fetch'),
  verifyFetch:async(url,init)=>{
   assert.equal(url,origin+'/api/me');assert.equal(init.headers.Authorization,'Bearer '+token)
   assert.equal(init.redirect,'error');assert.ok(init.signal)
   if(mode==='timeout') throw new DOMException('timed out','TimeoutError')
   return {ok:mode==='ok',status:mode==='revoked'?401:503,body:{cancel:async()=>{cancelled++}}}
  },
  connect:value=>{options=value;value.onInitialize(nativePermissions);value.onState('在线');value.onContext('proof');return{stop(){},updateCapabilities(){}}},
 })
 t.after(()=>controller.dispose());await controller.refresh()
 const request=()=>fetch(`http://127.0.0.1:${port}/context`,{headers:{Origin:origin,Authorization:'Bearer '+token}})
 let response=await request();assert.equal(response.status,200);assert.equal((await response.json()).shell_permission,true)
 assert.equal(cancelled,1)
 mode='revoked';response=await request();assert.equal(response.status,401);assert.equal((await response.json()).runtime_context,undefined)
 mode='server';response=await request();assert.equal(response.status,503)
 mode='timeout';response=await request();assert.equal(response.status,503);assert.equal((await response.json()).reason,'verification_unavailable')
 options.onState('离线');assert.equal(controller.snapshot().browser,false);assert.equal(controller.snapshot().shell,false)
 response=await request();assert.equal(response.status,409);assert.equal((await response.json()).reason,'runtime_offline')
})

test('local discovery retries an occupied port and stops retrying after disposal',async t=>{
 const blocker=http.createServer();blocker.listen(0,'127.0.0.1');await once(blocker,'listening')
 const port=blocker.address().port
 const controller=createClientRuntime({app:{getVersion:()=> 'test'},origin,bridgePort:port,bridgeRetryMs:20,
  getContents:()=>undefined,localExec:{snapshot:()=>({enabled:false})},toolkit:{schemas:[],release(){}},
 })
 t.after(()=>controller.dispose())
 await new Promise(resolve=>setTimeout(resolve,35));await new Promise(resolve=>blocker.close(resolve))
 let response
 for(let i=0;i<50;i++) {
  try {response=await fetch(`http://127.0.0.1:${port}/context`,{headers:{Origin:origin}});break} catch {}
  await new Promise(resolve=>setTimeout(resolve,10))
 }
 assert.equal(response?.status,409)
 controller.dispose();await new Promise(resolve=>setTimeout(resolve,60))
 const replacement=http.createServer();replacement.listen(port,'127.0.0.1');await once(replacement,'listening')
 await new Promise(resolve=>replacement.close(resolve))
})

test('runtime transport authenticates login and renews ephemeral proof, without device credentials',async t=>{
 const server=new WebSocketServer({port:0});await once(server,'listening')
 let auth, online=false, proof
 server.on('connection',socket=>socket.on('message',raw=>{
  const value=JSON.parse(raw)
  if(value.type==='auth'){
   auth=value;socket.send(JSON.stringify({type:'auth_ok',runtime_id:value.runtime_id}))
   socket.send(JSON.stringify({jsonrpc:'2.0',id:'init',method:'initialize',params:{protocolVersion:'2025-06-18'}}))
  }else if(value.id==='init'){
   assert.equal(value.result.capabilities.clientRuntime.version,1)
   socket.send(JSON.stringify({type:'runtime_ready',runtime_context:'ready-proof'}))
   socket.send(JSON.stringify({jsonrpc:'2.0',method:'notifications/initialized'}))
   socket.send(JSON.stringify({type:'ping',runtime_context:'renewed-proof'}))
  }
 }))
 const client=connectDesktop({url:`ws://127.0.0.1:${server.address().port}`,token:'login-jwt',runtimeId:'rt_test',version:'1',
  getCapabilities:()=>({browser:true,shell:false}),capabilities:{clientRuntime:{version:1}},execute:async()=>({}),
  onState:state=>{online=state==='在线'},onContext:value=>{proof=value}})
 t.after(async()=>{client.stop();for(const socket of server.clients)socket.terminate();await new Promise(resolve=>server.close(resolve))})
 for(let i=0;i<100&&(!online||proof!=='renewed-proof');i++)await new Promise(resolve=>setTimeout(resolve,10))
 assert.equal(auth.token,'login-jwt');assert.equal(auth.device_id,undefined);assert.equal(auth.shell,false)
 assert.equal(online,true);assert.equal(proof,'renewed-proof')
})

test('local tools fail closed before native protocol negotiation while the browser stays available',async t=>{
 const token=jwt('u1')
 let options,localCalls=0
 const controller=createClientRuntime({app:{getVersion:()=> 'test'},origin,bridgePort:19477,
  getContents:()=>({isDestroyed:()=>false,getURL:()=>origin,executeJavaScriptInIsolatedWorld:async()=>token}),
  localExec:{snapshot:()=>({enabled:true,state:'在线',canRequestPermission:true}),execute:async()=>{localCalls++;return{exit_code:0}}},
  toolkit:{schemas:[],release(){},execute:async()=>({content:[]})},
  connect:value=>{options=value;value.onInitialize({});value.onState('在线');value.onContext('proof');return{stop(){},updateCapabilities(){}}},
 })
 t.after(()=>controller.dispose());await controller.refresh()
 assert.deepEqual(options.getCapabilities(),{browser:true,shell:false,shell_permission:false})
 let result=await options.execute({name:'local_shell'},new AbortController().signal)
 assert.equal(JSON.parse(result.content[0].text).status,'server_upgrade_required');assert.equal(localCalls,0)
 options.onInitialize(nativePermissions)
 assert.deepEqual(options.getCapabilities(),{browser:true,shell:true,shell_permission:true})
 await options.execute({name:'local_shell'},new AbortController().signal);assert.equal(localCalls,1)
 options.onState('连接中')
 assert.deepEqual(options.getCapabilities(),{browser:true,shell:false,shell_permission:false})
})
