import { contextBridge, ipcRenderer } from 'electron'
import { channels, type DesktopAPI, type DesktopEvent } from '../shared/contracts'

const api: DesktopAPI = {
  getSnapshot: () => ipcRenderer.invoke(channels.snapshot),
  updateSettings: (patch) => ipcRenderer.invoke(channels.settings, patch),
  listCommands: () => ipcRenderer.invoke(channels.commands),
  runCommand: (id) => ipcRenderer.invoke(channels.run, id),
  setPinned: (id, pinned) => ipcRenderer.invoke(channels.pin, id, pinned),
  setPluginEnabled: (id, enabled) => ipcRenderer.invoke(channels.plugin, id, enabled),
  hide: () => ipcRenderer.invoke(channels.hide),
  quit: () => ipcRenderer.invoke(channels.quit),
  subscribe(callback) {
    const listener = (_event: Electron.IpcRendererEvent, event: DesktopEvent) => callback(event)
    ipcRenderer.on(channels.event, listener)
    return () => ipcRenderer.removeListener(channels.event, listener)
  },
}
contextBridge.exposeInMainWorld('desktop', Object.freeze(api))
