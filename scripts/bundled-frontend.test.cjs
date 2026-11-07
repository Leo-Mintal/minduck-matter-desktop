const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')
const { fileURLToPath } = require('node:url')
const { bundledFile, createBundledFrontendHandler, isBackendPath } = require('../src/bundledFrontend.cjs')

async function fixture(t) {
  const directory = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'minduck-frontend-test-')))
  const root = path.join(directory, 'bundle')
  await fs.mkdir(path.join(root, 'assets'), { recursive: true })
  await fs.writeFile(path.join(root, 'index.html'), '<h1>Local Matter</h1>')
  await fs.writeFile(path.join(root, 'assets', 'app.js'), 'window.bundled = true')
  await fs.writeFile(path.join(directory, 'private.txt'), 'must not be served')
  t.after(() => fs.rm(directory, { recursive: true, force: true }))
  return { root, directory }
}

test('keeps API, media and public-share prefixes on the backend, including their roots', () => {
  for (const pathname of ['/api', '/api/me', '/media/file.png', '/p/share']) {
    assert.equal(isBackendPath(pathname), true)
  }
  for (const pathname of ['/', '/apis', '/profile', '/assets/api.svg']) {
    assert.equal(isBackendPath(pathname), false)
  }
})

test('serves the bundle and history routes, but never replaces missing assets with HTML', async (t) => {
  const { root } = await fixture(t)
  assert.equal(await bundledFile(root, '/', true), path.join(root, 'index.html'))
  assert.equal(await bundledFile(root, '/settings/account', true), path.join(root, 'index.html'))
  assert.equal(await bundledFile(root, '/assets/app.js', false), path.join(root, 'assets', 'app.js'))
  assert.equal(await bundledFile(root, '/assets/missing.js', true), null)
  assert.equal(await bundledFile(root, '/unknown', false), null)
})

test('rejects encoded traversal, backslashes, NUL and symlinks outside the bundle', async (t) => {
  const { root, directory } = await fixture(t)
  await fs.symlink(path.join(directory, 'private.txt'), path.join(root, 'leak.txt'))
  for (const pathname of ['/..%2fprivate.txt', '/%2e%2e%2fprivate.txt', '/%00', '/..%5cprivate.txt', '/leak.txt']) {
    assert.equal(await bundledFile(root, pathname, true), null, pathname)
  }
})

test('forwards backend and other-origin requests without changing body, headers or query', async (t) => {
  const { root } = await fixture(t)
  const forwarded = []
  const handler = createBundledFrontendHandler({
    root,
    origin: 'https://matter.example',
    fetchImpl: async (...args) => { forwarded.push(args); return new Response('backend') },
  })
  for (const url of ['https://matter.example/api/upload?x=1', 'https://other.example/assets/page.js']) {
    const request = new Request(url, { method: 'POST', headers: { Authorization: 'Bearer test' }, body: 'payload' })
    assert.equal(await (await handler(request)).text(), 'backend')
    const [input, options] = forwarded.at(-1)
    assert.equal(input, request)
    assert.deepEqual(options, { bypassCustomProtocolHandlers: true })
    assert.equal(await input.text(), 'payload')
  }
})

test('marks local responses, supports HEAD, and does not cache obsolete bundle files', async (t) => {
  const { root } = await fixture(t)
  const handler = createBundledFrontendHandler({
    root,
    origin: 'https://matter.example',
    fetchImpl: async (url) => new Response(await fs.readFile(fileURLToPath(url))),
  })
  const response = await handler(new Request('https://matter.example/'))
  assert.equal(await response.text(), '<h1>Local Matter</h1>')
  assert.equal(response.headers.get('x-minduck-frontend'), 'bundled')
  assert.equal(response.headers.get('cache-control'), 'no-store')
  const head = await handler(new Request('https://matter.example/', { method: 'HEAD' }))
  assert.equal(await head.text(), '')
  assert.equal((await handler(new Request('https://matter.example/', { method: 'POST' }))).status, 405)
  assert.equal((await handler(new Request('https://matter.example/%GG'))).status, 400)
  assert.equal((await handler(new Request('https://matter.example/assets/gone.js'))).status, 404)
})
