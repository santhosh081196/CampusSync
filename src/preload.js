const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('desktopAPI', {
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: settings => ipcRenderer.invoke('settings:save', settings),
  setGoogleCredentials: text => ipcRenderer.invoke('google:set-credentials', text),
  connectGoogle: () => ipcRenderer.invoke('google:connect'),
  disconnectGoogle: () => ipcRenderer.invoke('google:disconnect'),
  refresh: () => ipcRenderer.invoke('data:refresh'),
  minimize: () => ipcRenderer.invoke('window:minimize'),
  close: () => ipcRenderer.invoke('window:close'),
  togglePin: () => ipcRenderer.invoke('window:toggle-pin'),
  openExternal: url => ipcRenderer.invoke('open:external', url)
});
