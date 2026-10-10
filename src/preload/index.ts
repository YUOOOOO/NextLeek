import { contextBridge, ipcRenderer } from 'electron'
import { channels, type DesktopAPI, type DesktopEvent } from '../shared/contracts'

const api: DesktopAPI = {
  getSnapshot: () => ipcRenderer.invoke(channels.snapshot),
  updateSettings: (patch) => ipcRenderer.invoke(channels.settings, patch),
  listCommands: () => ipcRenderer.invoke(channels.commands),
  runCommand: (id) => ipcRenderer.invoke(channels.run, id),
  setPinned: (id, pinned) => ipcRenderer.invoke(channels.pin, id, pinned),
  setPluginEnabled: (id, enabled) => ipcRenderer.invoke(channels.plugin, id, enabled),
  invokePlugin: (pluginId, method, args) => ipcRenderer.invoke(channels.invokePlugin, pluginId, method, args),
  getFrameNonce: () => ipcRenderer.invoke(channels.frameNonce),
  hide: () => ipcRenderer.invoke(channels.hide),
  quit: () => ipcRenderer.invoke(channels.quit),
  setHotkeyCapture: active => ipcRenderer.invoke(channels.hotkeyCapture, active),
  setLauncherHeight: height => ipcRenderer.invoke(channels.layout, height),
  getUpdateState: () => ipcRenderer.invoke(channels.updateState),
  checkForUpdates: () => ipcRenderer.invoke(channels.updateCheck),
  downloadUpdate: () => ipcRenderer.invoke(channels.updateDownload),
  installUpdate: () => ipcRenderer.invoke(channels.updateInstall),
  searchLauncher: request => ipcRenderer.invoke(channels.searchLauncher, request),
  performSearchAction: (providerId, itemId, action) => ipcRenderer.invoke(channels.searchAction, providerId, itemId, action),
  subscribe(callback) {
    const listener = (_event: Electron.IpcRendererEvent, event: DesktopEvent) => callback(event)
    ipcRenderer.on(channels.event, listener)
    return () => ipcRenderer.removeListener(channels.event, listener)
  },
}
contextBridge.exposeInMainWorld('desktop', Object.freeze(api))
