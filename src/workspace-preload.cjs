const { contextBridge, ipcRenderer } = require('electron')

// Only the fixed Matter document receives this UI bridge; no execution or credential APIs.
const prefix = '--minduck-workspace-origin='
const origin = process.argv.find(value => value.startsWith(prefix))?.slice(prefix.length)
if (origin && window.location.origin === origin && window.top === window) {
  contextBridge.exposeInMainWorld('minduckWorkspaceShell', Object.freeze({
    getState: () => ipcRenderer.invoke('workspace-shell:get-state'),
    command(type) {
      if (type === 'check-update' || type === 'companion-settings') ipcRenderer.send('workspace-shell:command', type)
    },
    onState(listener) {
      if (typeof listener !== 'function') return () => {}
      const handler = (_event, state) => listener(state)
      ipcRenderer.on('workspace-shell:state', handler)
      return () => ipcRenderer.removeListener('workspace-shell:state', handler)
    },
  }))
  window.addEventListener('DOMContentLoaded', () => {
    document.documentElement.dataset.matterWorkspace = 'true'
    document.documentElement.dataset.matterDesktop = 'true'
  }, { once: true })
}
