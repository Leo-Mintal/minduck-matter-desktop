const { contextBridge, ipcRenderer } = require('electron')
contextBridge.exposeInMainWorld('browserSettings', {
  request: (action, value) => ipcRenderer.invoke('matter-browser:settings', action, value),
})
