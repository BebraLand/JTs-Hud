const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('aerial', {
  capturePose: (options) => ipcRenderer.invoke('capture-pose', options),
  detectMap: (options) => ipcRenderer.invoke('detect-map', options),
  teleportPose: (payload) => ipcRenderer.invoke('teleport-pose', payload),
  loadDraft: (map) => ipcRenderer.invoke('load-draft', map),
  saveDraft: (manifest) => ipcRenderer.invoke('save-draft', manifest),
  exportManifest: (payload) => ipcRenderer.invoke('export-manifest', payload),
  importManifest: () => ipcRenderer.invoke('import-manifest')
})
