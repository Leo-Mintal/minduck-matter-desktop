'use strict';

// Deliberately serves only the standalone page, never the repository or an API.
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');

const files = new Set([
  'index.html', 'styles.css', 'web-primitives.css', 'config.js', 'theme.js', 'core.js', 'app.js',
  'assets/logo.svg', 'assets/copy.svg', 'assets/refresh.svg',
  'assets/inter-latin.woff2', 'assets/jbmono-latin.woff2',
]);
const contentTypes = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };
const port = Number(process.env.PORT || 4179);
if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('PORT must be between 0 and 65535.');

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  const file = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
  if (!['GET', 'HEAD'].includes(req.method) || !files.has(file)) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not found');
    return;
  }
  try {
    const body = await fs.readFile(path.join(__dirname, file));
    res.writeHead(200, {
      'Content-Type': `${contentTypes[path.extname(file)]}${/\.(html|css|js|svg)$/.test(file) ? '; charset=utf-8' : ''}`,
      'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
    });
    res.end(req.method === 'HEAD' ? undefined : body);
  } catch {
    res.writeHead(500);
    res.end('Unable to read page asset');
  }
});
server.on('error', (error) => { console.error(`预览服务启动失败：${error.message}`); process.exitCode = 1; });
server.listen(port, '127.0.0.1', () => { console.log(`邀请码页面：http://127.0.0.1:${server.address().port}`); });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { server.close(); });
