// Keep demo mode until the new backend is deployed. API mode reads the existing
// same-origin matter.token login; never put an administrator token in this file.
window.InviteConsoleConfig = Object.freeze({
  mode: 'demo',
  apiBasePath: '/api/admin/desktop-invites',
});
