const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('minduckBrowserSettings', Object.freeze({
  get: () => ipcRenderer.invoke('browser-settings:get'),
  save: (preferences) => ipcRenderer.invoke('browser-settings:save', preferences),
  clearCache: () => ipcRenderer.invoke('browser-settings:clear-cache'),
  close: () => ipcRenderer.send('browser-settings:close'),
}))
