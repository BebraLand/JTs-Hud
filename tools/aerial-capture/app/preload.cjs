const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('aerial', {
  apiVersion: 'gsi-state-fix-1',
  capturePose: (options) => ipcRenderer.invoke('capture-pose', options),
  detectMap: (options) => ipcRenderer.invoke('detect-map', options),
  getTelnetSettings: () => ipcRenderer.invoke('get-telnet-settings'),
  teleportPose: (payload) => ipcRenderer.invoke('teleport-pose', payload),
  saveHlaeCampath: (options) => ipcRenderer.invoke('save-hlae-campath', options),
  listHlaeCampaths: (map) => ipcRenderer.invoke('list-hlae-campaths', map),
  deleteHlaeCampath: (payload) => ipcRenderer.invoke('delete-hlae-campath', payload),
  importHlaeCampath: (options) => ipcRenderer.invoke('import-hlae-campath', options),
  loadHlaeCampath: (options) => ipcRenderer.invoke('load-hlae-campath', options),
  exportHlaeCampaths: () => ipcRenderer.invoke('export-hlae-campaths'),
  loadDraft: (map) => ipcRenderer.invoke('load-draft', map),
  saveDraft: (manifest) => ipcRenderer.invoke('save-draft', manifest),
  createBundle: (manifests) => ipcRenderer.invoke('create-bundle', manifests),
  getBundleManifests: (bundle) => ipcRenderer.invoke('get-bundle-manifests', bundle),
  isBundle: (value) => ipcRenderer.invoke('is-bundle', value),
  exportManifest: (payload) => ipcRenderer.invoke('export-manifest', payload),
  importManifest: () => ipcRenderer.invoke('import-manifest')
})
