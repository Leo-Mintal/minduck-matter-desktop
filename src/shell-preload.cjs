const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld(
  'minduckBrowserShell',
  Object.freeze({
    getState: () => ipcRenderer.invoke('browser-shell:get-state'),
    command: (command) => ipcRenderer.send('browser-shell:command', command),
    reportMetrics: (metrics) => ipcRenderer.send('browser-shell:metrics', metrics),
    onFocusAddress(listener) {
      if (typeof listener !== 'function') return () => {}
      const handler = () => listener()
      ipcRenderer.on('browser-shell:focus-address', handler)
      return () => ipcRenderer.removeListener('browser-shell:focus-address', handler)
    },
    onState(listener) {
      if (typeof listener !== 'function') return () => {}
      const handler = (_event, state) => listener(state)
      ipcRenderer.on('browser-shell:state', handler)
      return () => ipcRenderer.removeListener('browser-shell:state', handler)
    },
  }),
)
