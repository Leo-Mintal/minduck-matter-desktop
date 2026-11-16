const assert = require('node:assert/strict')
const fs = require('node:fs')
const http = require('node:http')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

// Remove the test profile only after Electron has closed its disk cache.
if (!process.versions.electron) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'minduck-bundle-smoke-'))
  const result = spawnSync(require('electron'), [__filename, directory], { stdio: 'inherit' })
  fs.rmSync(directory, { recursive: true, force: true })
  if (result.error) console.error(result.error)
  process.exit(result.status ?? 1)
}

const { app, BrowserWindow, net, protocol } = require('electron')
const { createBundledFrontendHandler } = require('../src/bundledFrontend.cjs')
const { createService, signingText } = require('../src/desktop-access/service.cjs')
const crypto = require('node:crypto')

const temporary = process.argv[2]
app.setPath('userData', path.join(temporary, 'profile'))
let server
let window
let timeout
const backendRequests = []

function startBackend() {
  server = http.createServer((request, response) => {
    backendRequests.push(request.url)
    if (request.url === '/api/events') {
      response.writeHead(200, { 'Content-Type': 'text/event-stream' })
      response.write('data: first\n\n')
      const end = setTimeout(() => response.end('data: second\n\n'), 1000)
      response.on('close', () => clearTimeout(end))
      return
    }
    const chunks = []
    request.on('data', (chunk) => chunks.push(chunk))
    request.on('end', () => {
      response.writeHead(200, { 'Content-Type': 'application/json' })
      response.end(JSON.stringify({
        method: request.method, url: request.url,
        authorization: request.headers.authorization,
        contentType: request.headers['content-type'],
        body: Buffer.concat(chunks).toString(),
        desktopKey: request.headers['x-desktop-key'],
        desktopChallenge: request.headers['x-desktop-challenge'],
        desktopSignature: request.headers['x-desktop-signature'],
      }))
    })
  })
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => {
    resolve('http://127.0.0.1:' + server.address().port)
  }))
}

async function checkRendererRequests() {
  return window.webContents.executeJavaScript(`(async () => {
    const response = await fetch('/api/echo?probe=1', {
      method: 'POST', headers: { Authorization: 'Bearer smoke', 'Content-Type': 'application/json' },
      body: JSON.stringify({ local: true })
    });
    const echo = await response.json();
    const auth = await (await fetch('/api/auth/login', { method:'POST', headers:{'Content-Type':'application/json'}, body:'{ "email": "test@example.test" }' })).json();
    const form = new FormData(); form.append('file', new Blob(['upload-probe']), 'probe.txt');
    const upload = await (await fetch('/api/upload', { method: 'POST', body: form })).json();
    const stream = await fetch('/api/events');
    const reader = stream.body.getReader();
    const first = await reader.read();
    const firstText = new TextDecoder().decode(first.value);
    let rest = '';
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      rest += new TextDecoder().decode(chunk.value);
    }
    return { echo, auth, upload, firstText, rest, title: document.title, nodeAvailable: typeof require !== 'undefined' };
  })()`)
}

async function smoke() {
  const origin = await startBackend()
  const root = path.join(temporary, 'bundle')
  fs.mkdirSync(path.join(root, 'assets'), { recursive: true })
  fs.writeFileSync(path.join(root, 'index.html'), '<!doctype html><title>Bundled Matter smoke</title><h1>Local</h1>')
  const pair = crypto.generateKeyPairSync('ec',{namedCurve:'prime256v1'})
  const publicKey = pair.publicKey.export({type:'spki',format:'der'}).toString('base64url')
  const challenge = {id:'smoke-challenge',nonce:'smoke-nonce',purpose:'auth',expiresAt:new Date(Date.now()+120000).toISOString()}
  const service = createService({origin,keys:{publicKey:async()=>publicKey,sign:async text=>crypto.sign('sha256',Buffer.from(text),pair.privateKey).toString('base64url')},
    fetchImpl:async()=>new Response(JSON.stringify(challenge))})
  protocol.handle('http', createBundledFrontendHandler({ root, origin, fetchImpl: net.fetch.bind(net),backendRequest:service.prepareAuth }))
  window = new BrowserWindow({ show: false, webPreferences: { sandbox: true, nodeIntegration: false } })
  await window.loadURL(origin + '/settings/account')
  const results = await checkRendererRequests()
  assert.equal(results.title, 'Bundled Matter smoke')
  assert.equal(results.nodeAvailable, false)
  assert.equal(results.echo.method, 'POST')
  assert.equal(results.echo.url, '/api/echo?probe=1')
  assert.equal(results.echo.authorization, 'Bearer smoke')
  assert.equal(results.echo.body, '{"local":true}')
  assert.equal(results.auth.url,'/api/desktop/auth/login')
  assert.equal(results.auth.body,'{ "email": "test@example.test" }')
  assert.equal(results.auth.desktopKey,publicKey)
  assert.equal(results.auth.desktopChallenge,challenge.id)
  assert.ok(crypto.verify('sha256',Buffer.from(signingText(origin,'auth','POST','/api/desktop/auth/login',challenge,results.auth.body)),pair.publicKey,Buffer.from(results.auth.desktopSignature,'base64url')))
  assert.match(results.upload.contentType, /^multipart\/form-data; boundary=/)
  assert.match(results.upload.body, /upload-probe/)
  assert.equal(results.firstText, 'data: first\n\n')
  assert.equal(results.rest, 'data: second\n\n')
  assert.equal(backendRequests.includes('/settings/account'), false)
  for (const pathname of ['/media/probe', '/p/share']) {
    const response = await net.fetch(origin + pathname)
    assert.equal((await response.json()).url, pathname)
  }
  protocol.unhandle('http')
  const bundle = process.env.MINDUCK_FRONTEND_BUNDLE || path.join(__dirname, '..', 'web-dist')
  assert.ok(fs.existsSync(path.join(bundle, 'desktop-build.json')), 'Run pnpm run build:web first')
  const handler = createBundledFrontendHandler({ root: bundle, origin, fetchImpl: net.fetch.bind(net) })
  protocol.handle('http', handler)
  const response = await net.fetch(origin + '/')
  const html = await response.text()
  assert.equal(response.headers.get('x-minduck-frontend'), 'bundled')
  const script = html.match(/<script[^>]*src="([^"]+)"/)
  assert.ok(script, 'Vite module script must be present')
  const asset = await net.fetch(new URL(script[1], origin).href)
  assert.equal(asset.status, 200)
  assert.match(asset.headers.get('content-type'), /javascript/)
  assert.ok((await asset.text()).length > 1000)
  console.log('PASS: local routes/assets, renderer isolation, signed desktop auth POST, upload, SSE, media/share proxy.')
}

app.whenReady().then(async () => {
  let code = 0
  timeout = setTimeout(() => { console.error('Bundled frontend smoke timed out'); app.exit(1) }, 30_000)
  try {
    await smoke()
  } catch (error) {
    console.error(error)
    code = 1
  } finally {
    clearTimeout(timeout)
    window?.destroy()
    server?.closeAllConnections()
    server?.close()
    app.exit(code)
  }
})
