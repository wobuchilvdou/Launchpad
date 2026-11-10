const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('launchpad', {
  listApps: () => ipcRenderer.invoke('apps:list'),
  refreshApps: () => ipcRenderer.invoke('apps:refresh'),
  getAppDiagnostics: () => ipcRenderer.invoke('apps:diagnostics'),
  saveState: (state) => ipcRenderer.invoke('state:save', state),
  saveOrder: (ids) => ipcRenderer.invoke('apps:order', ids),
  launchApp: (id) => ipcRenderer.invoke('app:launch', id),
  recycleApp: (id) => ipcRenderer.invoke('app:recycle', id),
  syncDesktop: () => ipcRenderer.invoke('desktop:sync'),
  getDesktopWallpaper: () => ipcRenderer.invoke('wallpaper:desktop'),
  listWallpapers: (force = false) => ipcRenderer.invoke('wallpaper:list', Boolean(force)),
  minimize: () => ipcRenderer.invoke('window:minimize'),
  close: () => ipcRenderer.invoke('window:close'),
});
