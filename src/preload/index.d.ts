import { ElectronAPI } from '@electron-toolkit/preload'

declare global {
  interface Window {
    electron: ElectronAPI
    api: {
      getControlToken: () => Promise<string>
      openExternal: (url: string) => Promise<void>
      onUpdateAvailable: (callback: (version: string) => void) => void
    }
  }
}
