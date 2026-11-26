const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('graveBrowser', {
  navigate: action => ipcRenderer.send('grave-browser:navigate', action),
  onState: callback => ipcRenderer.on('grave-browser:state', (_event, state) => callback(state))
});
