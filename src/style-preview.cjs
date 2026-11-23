// Local visual preview only. The regular package continues to use main.cjs.
if (process.argv.includes('--minduck-companion-host')) {
  require('./main.cjs')
} else {
  const http = require('node:http')
  const path = require('node:path')
  const { app } = require('electron')
  app.setName('minduck matter 0.2.0')
  app.setPath('userData', path.join(app.getPath('appData'), 'minduck-matter-style-preview-0.2.0'))
  const user = { id: 'user_style_preview', name: '样式预览', email: 'preview@example.invalid', locale: 'zh-CN' }
  const organization = { id: 'org_style_preview', name: '样式预览', kind: 'personal', owner_user_id: user.id,
    status: 'active', role: 'owner' }
  const fixtures = {
    '/api/desktop-access/policy': { protocol: 1, required: false },
    '/api/me': user,
    '/api/me/orgs': { orgs: [organization], current_org_id: organization.id },
    '/api/orgs/org_style_preview/spaces': { spaces: [{ id: 'space_style_preview', org_id: organization.id,
      name: '默认空间', is_default: true }] },
    '/api/teams': { teams: [] },
    '/api/conversations': { conversations: [] },
    '/api/me/changelog': { unread: false },
    '/api/models': { models: [] },
    '/api/billing/overview': { balance: { available: 0, held: 0 }, pools: [], channels: [],
      agreement: null, current_subscription: null, scheduled_subscriptions: [], unread_notifications: 0 },
    '/api/knowledge/binding': { connected: false, can_manage: false, knowledge_org_id: '', revision: 0 },
  }
  const server = http.createServer((request, response) => {
    const pathname = new URL(request.url, 'http://localhost').pathname
    const value = request.method === 'GET' ? fixtures[pathname] : undefined
    response.writeHead(value ? 200 : 404, { 'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store' })
    response.end(JSON.stringify(value || { error: '本地样式预览未连接业务服务' }))
  })
  server.on('upgrade', (_request, socket) => socket.destroy())
  server.on('error', error => { console.error('Local preview failed:', error.message); app.quit() })
  app.once('will-quit', () => server.close())
  server.listen(0, '127.0.0.1', () => {
    const origin = 'http://127.0.0.1:' + server.address().port
    process.env.MINDUCK_MATTER_ORIGIN = origin
    app.on('web-contents-created', (_event, contents) => {
      let seeded = false
      contents.on('did-finish-load', async () => {
        if (seeded || contents.isDestroyed() || !contents.getURL().startsWith(origin + '/')) return
        seeded = true
        try {
          const payload = Buffer.from(JSON.stringify({ uid: user.id, exp: Math.floor(Date.now() / 1000) + 86400 })).toString('base64url')
          await contents.executeJavaScript('localStorage.setItem("matter.token", ' + JSON.stringify('preview.' + payload + '.local')
            + '); localStorage.setItem(' + JSON.stringify('matter.coached.' + user.id) + ', "1")')
          if (!contents.isDestroyed()) contents.reload()
        } catch (error) {
          console.error('Local preview initialization failed:', error.message)
        }
      })
    })
    require('./main.cjs')
  })
}
