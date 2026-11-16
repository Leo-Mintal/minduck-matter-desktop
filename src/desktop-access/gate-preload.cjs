const { contextBridge, ipcRenderer } = require('electron')
contextBridge.exposeInMainWorld('desktopActivation', {
  state: () => ipcRenderer.invoke('desktop-access:state'),
  submit: code => ipcRenderer.invoke('desktop-access:submit', code),
  retry: () => ipcRenderer.invoke('desktop-access:retry'),
  quit: () => ipcRenderer.send('desktop-access:quit'),
  update: () => ipcRenderer.send('desktop-access:update'),
  changed: listener => ipcRenderer.on('desktop-access:changed', (_event, value) => listener(value)),
})
