const { existsSync } = require('node:fs')
const { realpath, stat } = require('node:fs/promises')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const { normalizeMatterOrigin } = require('./matterService.cjs')

const BACKEND_PREFIXES = ['/api', '/media', '/p']

function isBackendPath(pathname) {
  return BACKEND_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(prefix + '/'))
}

function isInside(root, filename) {
  const relative = path.relative(root, filename)
  return relative === '' || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative))
}

async function bundledFile(root, pathname, navigation) {
  const decoded = decodeURIComponent(pathname)
  if (decoded.includes('\0') || decoded.includes('\\')) return null
  let filename = path.resolve(root, '.' + decoded)
  if (!isInside(root, filename)) return null
  try {
    if ((await stat(filename)).isDirectory()) filename = path.join(filename, 'index.html')
    await stat(filename)
  } catch (error) {
    if (error.code !== 'ENOENT' && error.code !== 'ENOTDIR') throw error
    if (!navigation || path.extname(decoded) || decoded.startsWith('/assets/')) return null
    filename = path.join(root, 'index.html')
  }
  const [realRoot, realFile] = await Promise.all([realpath(root), realpath(filename)])
  return isInside(realRoot, realFile) ? realFile : null
}

function createBundledFrontendHandler({ root, origin, fetchImpl, logger = console, backendHeaders }) {
  const bundleRoot = path.resolve(root)
  const matterOrigin = normalizeMatterOrigin(origin)
  return async (request) => {
    const url = new URL(request.url)
    if (url.origin !== matterOrigin || isBackendPath(url.pathname)) {
      // Keep POST bodies, auth headers, uploads and SSE streams unchanged.
      if (backendHeaders) {
        const headers = backendHeaders(Object.fromEntries(request.headers), request.url)
        request = new Request(request, { headers })
      }
      return fetchImpl(request, { bypassCustomProtocolHandlers: true })
    }
    if (!['GET', 'HEAD'].includes(request.method)) {
      return new Response('Method not allowed', { status: 405, headers: { Allow: 'GET, HEAD' } })
    }
    try {
      const navigation = request.mode === 'navigate' || request.headers.get('accept')?.includes('text/html')
      const filename = await bundledFile(bundleRoot, url.pathname, navigation)
      if (!filename) return new Response('Not found', { status: 404 })
      const headers = new Headers()
      if (request.headers.has('range')) headers.set('range', request.headers.get('range'))
      const response = await fetchImpl(pathToFileURL(filename).href, { headers })
      const responseHeaders = new Headers(response.headers)
      responseHeaders.set('Cache-Control', 'no-store')
      responseHeaders.set('X-Minduck-Frontend', 'bundled')
      return new Response(request.method === 'HEAD' ? null : response.body, {
        status: response.status,
        headers: responseHeaders,
      })
    } catch (error) {
      if (error instanceof URIError) return new Response('Invalid path', { status: 400 })
      logger.error('Failed to load bundled Matter frontend:', error)
      return new Response('Bundled frontend unavailable', { status: 500 })
    }
  }
}

function installBundledFrontend({ app, protocol, net, origin, backendHeaders }) {
  const root = path.join(app.getAppPath(), 'web-dist')
  if (!existsSync(path.join(root, 'index.html'))) {
    throw new Error('Matter frontend is missing. Run pnpm run build:web before starting or packaging.')
  }
  const scheme = new URL(origin).protocol.slice(0, -1)
  protocol.handle(scheme, createBundledFrontendHandler({ root, origin, fetchImpl: net.fetch.bind(net), backendHeaders }))
  console.log('Matter frontend: bundled web-dist; backend:', origin)
}

module.exports = { bundledFile, createBundledFrontendHandler, installBundledFrontend, isBackendPath }
