const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('matterServiceSettings', {
  get: () => ipcRenderer.invoke('matter-service-settings:get'),
  save: (origin) => ipcRenderer.invoke('matter-service-settings:save', { origin }),
  reset: () => ipcRenderer.invoke('matter-service-settings:reset'),
  close: () => ipcRenderer.send('matter-service-settings:close'),
  restart: () => ipcRenderer.send('matter-service-settings:restart'),
})
