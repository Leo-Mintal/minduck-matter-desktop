const crypto = require('node:crypto')
const http = require('node:http')
const { connectDesktop } = require('./local-exec/connection.cjs')
const { tokenAccount } = require('./local-exec/contract.cjs')
const { createTools } = require('./browser-device/tools.cjs')

const BRIDGE_PORT = 19473
function createClientRuntime({ app, origin, getContents, localExec, compatibility, extensionRoot, nativeImage,
  fetchImpl, verifyFetch = globalThis.fetch, connect = connectDesktop,
  toolkit = createTools({ compatibility, extensionRoot, origin, nativeImage, fetchImpl }),
  bridgePort = BRIDGE_PORT, bridgeRetryMs = 1000 }) {
  const runtimeId = 'rt_' + crypto.randomBytes(24).toString('base64url')
  let identity = { token:'',account:'' }, lastContents, connection, state='等待登录', proof='', disposed=false, refreshing=false, generation=0, nativePermissions=false
  const capabilities = () => {
    const local = localExec.snapshot()
    return { browser:true, shell:nativePermissions && local.enabled && (local.ready ?? local.state==='在线'),
      shell_permission:nativePermissions && local.canRequestPermission === true }
  }
  async function currentIdentity(allowDialog = false) {
    const contents=getContents()
    if (!contents || contents.isDestroyed() || new URL(contents.getURL() || 'about:blank').origin!==origin) return {token:'',account:''}
    if (allowDialog && contents===lastContents && tokenAccount(identity.token)===identity.account) return identity
    const token=await contents.executeJavaScriptInIsolatedWorld(1002,[{code:"localStorage.getItem('matter.token') || ''"}])
    lastContents=contents
    return {token,account:tokenAccount(token)}
  }
  function stop(next='当前客户端不可用') {
    generation++; proof=''; nativePermissions=false; connection?.stop(); connection=undefined; toolkit.release?.(); state=next
  }
  async function refresh() {
    if (disposed || refreshing) return
    refreshing=true
    try {
      const current=await currentIdentity()
      if (disposed) return
      if (current.token!==identity.token || current.account!==identity.account) { stop();identity=current }
      if (!identity.account) {state='请先登录 Matter';return}
      if (connection) {connection.updateCapabilities();return}
      const expected=generation, expectedAccount=identity.account
      const check=async (allowDialog=false) => {
        const current=await currentIdentity(allowDialog)
        if (disposed || generation!==expected || current.account!==expectedAccount || !expectedAccount || current.token!==identity.token) throw new Error('客户端登录已变化或调用已取消')
      }
      const url=new URL('/api/client-runtime/ws',origin);url.protocol=url.protocol==='https:'?'wss:':'ws:'
      connection=connect({url:url.href,token:identity.token,runtimeId,version:app.getVersion(),getCapabilities:capabilities,
        capabilities:{tools:{},clientRuntime:{version:1,fileTransfer:1,fileOpen:localExec.snapshot().canOpenFile === true ? 1 : 0},localPermissions:{version:1,mode:'macos-native'}},mcpResults:true,tools:toolkit.schemas,
        onInitialize(capabilities){if(generation===expected)nativePermissions=capabilities?.localPermissions?.version===1 && capabilities.localPermissions.mode==='macos-native'},
        onContext(value){if(generation===expected && typeof value==='string') proof=value},
        onState(next){if(generation===expected){state=next;if(next!=='在线'){proof='';nativePermissions=false}}},
        onRevoked(){if(generation===expected)stop('登录已失效，请重新登录')},
        async execute(params,signal) {
          const allowDialog=params.name==='chrome_handle_dialog' && toolkit.isDialogOpen?.(params.arguments?.tabId)
          await check(allowDialog)
          if (params.name?.startsWith('local_')) {
            if(!nativePermissions)return{content:[{type:'text',text:JSON.stringify({status:'server_upgrade_required',command_executed:false,
              message:'服务端尚未确认按需系统授权协议，请更新服务端后重试；本次未执行命令。'})}],isError:true}
            const result=await localExec.execute(params,signal)
            return {content:[{type:'text',text:JSON.stringify(result)}],isError:result.denied===true || result.cancelled===true || result.timed_out===true || result.error!==undefined || ('exit_code' in result && result.exit_code!==0)}
          }
          return toolkit.execute(params,signal,()=>check(allowDialog))
        },
      })
    } catch { stop('当前客户端暂不可用') }
    finally {refreshing=false}
  }
  function snapshot() {
    const local=capabilities(), available=!disposed && state==='在线' && Boolean(proof)
    return {state,available,browser:available,shell:available && local.shell,shell_permission:available && local.shell_permission,account:identity.account,bridgePort}
  }
  function headers(input,url,referrer='') {
    const result=Object.fromEntries(Object.entries(input).filter(([key])=>!/^x-matter-(runtime|desktop|client)$/i.test(key)))
    const authorization=Object.entries(result).find(([key])=>key.toLowerCase()==='authorization')?.[1]
    try {
      const target=new URL(url)
      // Electron's protocol handler omits Origin but retains the trusted page referrer.
      // Restore it only for this app's exact loopback context endpoint; the bridge still verifies JWT.
      if(target.origin===`http://127.0.0.1:${bridgePort}` && target.pathname==='/context' && !target.search &&
        !Object.keys(result).some(key=>key.toLowerCase()==='origin') && referrer && new URL(referrer).origin===origin) result.Origin=origin
      if(target.origin===origin && target.pathname.startsWith('/api/') && snapshot().available && typeof authorization==='string' && tokenAccount(authorization.replace(/^Bearer\s+/i,''))===identity.account) result['X-Matter-Runtime']=proof
    } catch {}
    return result
  }
  // Only an authenticated page at our configured origin may discover this computer.
  // This bridge has no command endpoint and returns no login or device token.
  const bridge=http.createServer(async(req,res)=>{
    const reply=(status,reason,message)=>{
      res.writeHead(status,{'Content-Type':'application/json'})
      res.end(JSON.stringify({available:false,reason,state:message}))
    }
    res.setHeader('Cache-Control','no-store')
    if(req.headers.host!==`127.0.0.1:${bridgePort}` || req.headers.origin!==origin || req.url!=='/context') {res.writeHead(403).end();return}
    res.setHeader('Access-Control-Allow-Origin',origin);res.setHeader('Vary','Origin')
    res.setHeader('Access-Control-Allow-Headers','Authorization, Content-Type')
    res.setHeader('Access-Control-Allow-Methods','GET, OPTIONS')
    res.setHeader('Access-Control-Allow-Private-Network','true')
    if(req.method==='OPTIONS') {res.writeHead(204).end();return}
    if(req.method!=='GET') {res.writeHead(405).end();return}
    const raw=String(req.headers.authorization||'').replace(/^Bearer\s+/i,'')
    const expected=generation, account=identity.account
    if(!account || tokenAccount(raw)!==account) {reply(409,'account_mismatch','网页与客户端的登录账号不一致，请使用同一账号');return}
    if(!snapshot().available) {reply(409,'runtime_offline',state);return}
    try {
      // Keep login verification off Chromium's renderer/protocol request pipeline.
      const response=await verifyFetch(new URL('/api/me',origin).href,{headers:{Authorization:`Bearer ${raw}`},redirect:'error',signal:AbortSignal.timeout(2500)})
      await response.body?.cancel()
      if(!response.ok) {reply(response.status===401 || response.status===403 ? 401 : 503,'verification_failed',response.status===401 || response.status===403 ? '登录已失效，请重新登录 Matter' : '客户端登录校验暂不可用，请检查服务连接');return}
      if(disposed || generation!==expected || account!==identity.account || !snapshot().available) {reply(409,'runtime_offline','客户端连接已变化，请重试');return}
      // The API verified the signature and account status; the decoded uid was matched above.
      res.setHeader('Content-Type','application/json');res.end(JSON.stringify({...snapshot(),runtime_context:proof}))
    } catch {reply(503,'verification_unavailable','客户端登录校验暂不可用，请检查服务连接')}
  })
  let bridgeRetry
  function listen() {if(!disposed) {bridge.listen(bridgePort,'127.0.0.1');bridge.unref()}}
  bridge.on('error',error=>{
    console.error('本机能力桥接不可用:',error.code)
    if(!disposed && error.code==='EADDRINUSE') {bridgeRetry=setTimeout(listen,bridgeRetryMs);bridgeRetry.unref()}
  })
  listen()
  const timer=setInterval(()=>void refresh(),1000);timer.unref()
  return {refresh,headers,snapshot,notifyTabUpdated:(...args)=>toolkit.notifyTabUpdated?.(...args),
    suspend(){stop('窗口已关闭');identity={token:'',account:''}},
    dispose(){disposed=true;clearInterval(timer);clearTimeout(bridgeRetry);stop();bridge.close()},
  }
}
module.exports={createClientRuntime,BRIDGE_PORT}
