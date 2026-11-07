const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld(
  'minduckPanelResizer',
  Object.freeze({
    getState: () => ipcRenderer.invoke('panel-resizer:get-state'),
    start: () => ipcRenderer.send('panel-resizer:start'),
    resize: (deltaX) => ipcRenderer.send('panel-resizer:resize', deltaX),
    finish: () => ipcRenderer.send('panel-resizer:finish'),
    onState(listener) {
      if (typeof listener !== 'function') return () => {}
      const handler = (_event, state) => listener(state)
      ipcRenderer.on('panel-resizer:state', handler)
      return () => ipcRenderer.removeListener('panel-resizer:state', handler)
    },
  }),
)
