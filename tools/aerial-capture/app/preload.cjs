const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('aerial', {
  capturePose: (options) => ipcRenderer.invoke('capture-pose', options),
  exportManifest: (payload) => ipcRenderer.invoke('export-manifest', payload),
  importManifest: () => ipcRenderer.invoke('import-manifest')
})
