// Standalone preview only. API mode requires a separately implemented admin service.
// Keep credentials out of this file; production uses the same-origin admin session.
window.InviteConsoleConfig = Object.freeze({
  mode: 'demo',
  apiBasePath: '/api/admin/desktop-invites',
});
