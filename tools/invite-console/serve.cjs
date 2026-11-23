'use strict';

// Standalone assets with an optional fixed loopback invitation API proxy.
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');

const files = new Set([
  'index.html', 'styles.css', 'web-primitives.css', 'config.js', 'theme.js', 'core.js', 'app.js',
  'assets/logo.svg', 'assets/copy.svg', 'assets/refresh.svg',
  'assets/inter-latin.woff2', 'assets/jbmono-latin.woff2',
]);
const contentTypes = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };
const consolePrefix = '/internal/invites/';
const apiPrefix = '/api/desktop-access/invites';

function loopbackOrigin(value) {
  const url = new URL(value);
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
    || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('本地代理仅支持 HTTP 回环服务根地址。');
  }
  return url.origin;
}

function proxy(req, res, origin) {
  const upstream = http.request(new URL(req.url, origin), {
    method: req.method,
    headers: { ...req.headers },
    timeout: 15000,
  }, (response) => {
    res.writeHead(response.statusCode, response.headers);
    response.pipe(res);
  });
  upstream.on('timeout', () => upstream.destroy(new Error('timeout')));
  upstream.on('error', () => {
    if (res.headersSent) { res.destroy(); return; }
    res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: '本地服务未连接，请检查 API 开发服务。' }));
  });
  req.on('aborted', () => upstream.destroy());
  res.on('close', () => { if (!res.writableFinished) upstream.destroy(); });
  req.pipe(upstream);
}

function createInviteServer({ apiOrigin } = {}) {
  const api = apiOrigin ? loopbackOrigin(apiOrigin) : null;
  return http.createServer(async (req, res) => {
    const host = req.headers.host || '';
    if (!/^(?:127\.0\.0\.1|localhost|\[::1\])(?::\d+)?$/.test(host) || !req.url.startsWith('/') || req.url.startsWith('//')) {
      res.writeHead(400); res.end('Invalid local request'); return;
    }
    const url = new URL(req.url, 'http://127.0.0.1');
    if (api && (url.pathname === apiPrefix || url.pathname.startsWith(`${apiPrefix}/`))) { proxy(req, res, api); return; }
    if (api && url.pathname === consolePrefix.slice(0, -1)) {
      res.writeHead(302, { Location: consolePrefix }); res.end(); return;
    }
    const relativePath = api && url.pathname.startsWith(consolePrefix)
      ? url.pathname.slice(consolePrefix.length) : url.pathname.slice(1);
    const file = relativePath || 'index.html';
    if (!['GET', 'HEAD'].includes(req.method) || !files.has(file)) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not found');
      return;
    }
    try {
      const body = api && file === 'config.js'
        ? `window.InviteConsoleConfig = Object.freeze({ mode: 'api', apiBasePath: '${apiPrefix}' });\n`
        : await fs.readFile(path.join(__dirname, file));
      res.writeHead(200, {
        'Content-Type': `${contentTypes[path.extname(file)]}${/\.(html|css|js|svg)$/.test(file) ? '; charset=utf-8' : ''}`,
        'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'no-referrer',
        'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
      });
      res.end(req.method === 'HEAD' ? undefined : body);
    } catch {
      res.writeHead(500);
      res.end('Unable to read page asset');
    }
  });
}

if (require.main === module) {
  const port = Number(process.env.PORT || 4179);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('PORT must be between 0 and 65535.');
  const apiOrigin = process.env.INVITE_API_ORIGIN || 'http://127.0.0.1:8080';
  const server = createInviteServer({ apiOrigin });
  server.on('error', (error) => { console.error(`预览服务启动失败：${error.message}`); process.exitCode = 1; });
  server.listen(port, '127.0.0.1', () => {
    const origin = `http://127.0.0.1:${server.address().port}`;
    console.log(`邀请码页面：${origin}/`);
    console.log('真实发码模式：输入服务端配置的管理员密码后进入。');
  });
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { server.close(); });
}

module.exports = { createInviteServer };
