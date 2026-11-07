// Adapted from Coopanion 0.2.16 app/main.cjs (AGPL-3.0-or-later).
// Keep the settings UI and its API on one origin, outside the Matter session.
const http = require('node:http')
const { Readable } = require('node:stream')
const { readFileSync, realpathSync } = require('node:fs')
const path = require('node:path')
const { loopbackOrigin } = require('./runtime.cjs')

const PREFIX = '/coopanion/'
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.map': 'application/json' }
const CSP = "script-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'"
const refused = () => new Response(null, { status: 403 })

function windowFile(directory, url) {
  try {
    const root = realpathSync(directory)
    const file = realpathSync(path.resolve(root, decodeURIComponent(url.pathname.slice(PREFIX.length)) || 'index.html'))
    if (!file.startsWith(root + path.sep)) return refused()
    return new Response(readFileSync(file), { headers: {
      'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream',
      'cache-control': 'no-store', 'content-security-policy': CSP,
    } })
  } catch { return new Response(null, { status: 404 }) }
}

function forward(request, url, origin) {
  const headers = Object.fromEntries(request.headers)
  delete headers.cookie
  headers.host = url.host
  if (origin) headers.origin = origin
  return new Promise((done) => {
    const out = http.request({ hostname: url.hostname, port: url.port, method: request.method,
      path: url.pathname + url.search, headers }, (res) => {
      const back = new Headers()
      for (const [key, value] of Object.entries(res.headers)) {
        if (Array.isArray(value)) for (const item of value) back.append(key, item)
        else if (value !== undefined) back.set(key, value)
      }
      const empty = request.method === 'HEAD' || [204, 304].includes(res.statusCode)
      done(new Response(empty ? null : Readable.toWeb(res), {
        status: res.statusCode, statusText: res.statusMessage, headers: back,
      }))
    })
    out.on('error', () => done(new Response(null, { status: 502 })))
    if (!request.body) { out.end(); return }
    const body = Readable.fromWeb(request.body)
    body.on('error', (error) => out.destroy(error))
    body.pipe(out)
  })
}

function createSettingsProtocol({ directory, coreOrigin, petOrigin, core }) {
  return async (request) => {
    const url = new URL(request.url)
    const from = request.referrer ? new URL(request.referrer).origin : null
    if (url.origin === coreOrigin()) {
      if (url.pathname.startsWith(PREFIX)) return windowFile(directory, url)
      if (from !== coreOrigin()) return refused()
      const shutdown = request.method === 'POST' && url.pathname === '/api/run/shutdown'
      if (shutdown) core.expectStop()
      const response = await forward(request, url, from)
      if (shutdown && !response.ok) core.forgetStop()
      return response
    }
    const pet = await petOrigin()
    if (!loopbackOrigin(url.href) || url.origin !== pet) return refused()
    if (from === coreOrigin() || from === pet) return forward(request, url, from)
    const frameFile = url.pathname === '/figure-frame' || /^\/(web|packs)\//.test(url.pathname)
    return !from && frameFile && ['GET', 'HEAD'].includes(request.method)
      ? forward(request, url, 'null') : refused()
  }
}

module.exports = { createSettingsProtocol, windowFile }
