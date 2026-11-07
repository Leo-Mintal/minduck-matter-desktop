const { contextBridge, ipcRenderer } = require('electron')
contextBridge.exposeInMainWorld('localSettings', { request: (action, value) => ipcRenderer.invoke('matter-local:settings', action, value) })
