const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { createController } = require('../src/local-exec/controller.cjs')

async function fixture(t, overrides = {}) {
  const home = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'matter-open-test-')))
  t.after(() => fs.rm(home, { recursive:true, force:true }))
  let token = 'h.' + Buffer.from(JSON.stringify({ uid:'owner', exp:Date.now()/1000+600 })).toString('base64url') + '.s'
  let settings = { root:path.join(home, 'Matter'), enabled:false, grants:{}, workspaces:{} }
  const opened = [], probes = []
  const controller = createController({
    app:{ getPath:() => path.join(home, 'profile') }, origin:'https://matter.test', home,
    getContents:() => ({ isDestroyed:() => false, getURL:() => 'https://matter.test/c/conv1', executeJavaScriptInIsolatedWorld:async() => token }),
    store:{ get:() => settings, update:patch => (settings={ ...settings, ...patch }) },
    platform:'darwin', resolvePath:async() => '/usr/bin:/bin',
    probeAccess:async filename => { probes.push(filename) },
    openPath:async filename => { opened.push(filename); return '' }, ...overrides,
  })
  t.after(() => controller.dispose())
  await controller.refresh()
  return { home, controller, opened, probes, logout:() => { token='' },
    call:(filename, signal) => controller.execute({ name:'local_open_file', arguments:{path:filename},
      _matter:{conversation_id:'conv1', conversation_title:'Open document', run_id:'run1', tool_call_id:'open1'} }, signal),
  }
}

test('native open dispatches the exact authorized document path without interpreting shell syntax', async t => {
  const f=await fixture(t), desktop=path.join(f.home,'Desktop')
  await fs.mkdir(desktop)
  const file=path.join(desktop,'photo; touch never.JPG')
  await fs.writeFile(file,'test document')
  const result=await f.call(file)
  assert.equal(result.status,'open_requested')
  assert.equal(result.path,file)
  assert.deepEqual(f.opened,[file])
  assert.deepEqual(f.probes,[desktop])
  assert.equal(f.controller.snapshot().canOpenFile,true)
  await assert.rejects(fs.stat(path.join(desktop,'never')),{code:'ENOENT'})
})

test('native open delegates files and project directories to system defaults using only their paths', async t => {
  const calls=[]
  const f=await fixture(t,{openPath:async(...args)=>{calls.push(args);return ''}})
  for(const name of ['README','photo.custom-image','project.code-workspace','launch.sh','download.pkg']) {
    const file=path.join(f.home,name); await fs.writeFile(file,'test resource')
    assert.equal((await f.call(file)).status,'open_requested')
    assert.deepEqual(calls.at(-1),[file])
  }
  for(const name of ['Project Folder','Example.app']) {
    const directory=path.join(f.home,name); await fs.mkdir(directory)
    assert.equal((await f.call(directory)).status,'open_requested')
    assert.deepEqual(calls.at(-1),[directory])
  }
  assert.equal(calls.length,7)
})

test('native open preserves sensitive-path restrictions including symbolic links', async t => {
  const f=await fixture(t)
  const secret=path.join(f.home,'.ssh'); await fs.mkdir(secret)
  const file=path.join(secret,'photo.jpg'); await fs.writeFile(file,'private')
  await assert.rejects(f.call(file),/敏感/)
  const link=path.join(f.home,'photo.jpg');await fs.symlink(file,link)
  await assert.rejects(f.call(link),/敏感/)
  assert.deepEqual(f.opened,[])
})

test('native open rejects missing paths and special files before delegating to the system', async t => {
  const f=await fixture(t)
  await assert.rejects(f.call(path.join(f.home,'missing')),{code:'ENOENT'})
  await assert.rejects(f.call('/dev/null'),/文件或目录/)
  assert.deepEqual(f.opened,[])
})

test('an OS access refusal is returned as denial and never opens the document', async t => {
  const f=await fixture(t,{probeAccess:async()=>{throw Object.assign(new Error('denied'),{code:'EACCES'})}})
  const file=path.join(f.home,'photo.png'); await fs.writeFile(file,'test')
  const result=await f.call(file)
  assert.equal(result.status,'os_access_denied')
  assert.equal(result.denied,true)
  assert.equal(result.command_executed,false)
  assert.deepEqual(f.opened,[])
})

test('native launch failures are reported truthfully and are not permission refusals', async t => {
  const f=await fixture(t,{openPath:async()=> 'No default application'})
  const file=path.join(f.home,'photo.png'); await fs.writeFile(file,'test')
  const result=await f.call(file)
  assert.equal(result.status,'open_failed')
  assert.equal(result.error,'No default application')
  assert.equal(result.denied,undefined)
  assert.equal(result.retryable,false)
})

test('opening is stopped on cancellation or a login change during native access preflight', async t => {
  let enter, finish
  const pending=new Promise(resolve=>{enter=resolve}), wait=new Promise(resolve=>{finish=resolve})
  const f=await fixture(t,{probeAccess:async()=>{enter();await wait}})
  const file=path.join(f.home,'photo.png'); await fs.writeFile(file,'test')
  const call=f.call(file)
  await pending; f.logout(); finish()
  await assert.rejects(call,/账号|取消/)
  assert.deepEqual(f.opened,[])
  const cancelled=new AbortController(); cancelled.abort()
  await assert.rejects(f.call(file,cancelled.signal),/账号|取消/)
})

test('a controller without a native opener cannot advertise or execute file opening', async t => {
  const f=await fixture(t,{openPath:undefined})
  assert.equal(f.controller.snapshot().canOpenFile,false)
  const result=await f.call(path.join(f.home,'missing.png'))
  assert.equal(result.status,'client_upgrade_required')
  assert.equal(result.command_executed,false)
  assert.deepEqual(f.probes,[])
})
