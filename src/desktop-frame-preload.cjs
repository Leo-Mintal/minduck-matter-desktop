const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('minduckDesktopFrame', Object.freeze({
  getState: () => ipcRenderer.invoke('desktop-frame:get-state'),
  command: (type) => ipcRenderer.send('desktop-frame:command', type),
  onState(listener) {
    if (typeof listener !== 'function') return () => {}
    const handler = (_event, state) => listener(state)
    ipcRenderer.on('desktop-frame:state', handler)
    return () => ipcRenderer.removeListener('desktop-frame:state', handler)
  },
}))
