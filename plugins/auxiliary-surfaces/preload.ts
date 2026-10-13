import type { ContextBridge, IpcRenderer, WebUtils } from 'electron'
import { statSync } from 'node:fs'
import { basename } from 'node:path'
import type { AuxiliarySettings } from './contracts'
import type { SuperPanelRendererBridge } from './protocol'

const ballSendChannels: Record<string, true> = {
  'floating-ball-click': true, 'floating-ball-double-click': true, 'floating-ball-drag-start': true,
  'floating-ball-dragging': true, 'floating-ball-drag-end': true, 'floating-ball-contextmenu': true, 'floating-ball-file-drop': true,
}

/** Trusted ball page receives only its own IPC and file-drop primitives, never Node/Electron. */
export function installFloatingBallBridge(contextBridge: ContextBridge, ipc: IpcRenderer, webUtils: WebUtils) {
  const droppedPaths = new Set<string>()
  contextBridge.exposeInMainWorld('floatingBall', {
    ipcRenderer: {
      send(channel: string, payload?: unknown) {
        if (!Object.hasOwn(ballSendChannels, channel)) throw new Error('Floating ball channel denied')
        ipc.send(channel, payload)
      },
      on(channel: string, listener: (event: null, letter: string) => void) {
        if (channel !== 'floating-ball-set-letter') throw new Error('Floating ball listener denied')
        const handler = (_event: Electron.IpcRendererEvent, letter: string) => listener(null, letter)
        ipc.on(channel, handler)
        return () => ipc.removeListener(channel, handler)
      },
    },
    webUtils: { getPathForFile(file: File) {
      const path = webUtils.getPathForFile(file)
      if (path) droppedPaths.add(path)
      return path
    } },
    path: { basename },
    fs: { statSync(path: string) {
      if (!droppedPaths.delete(path)) throw new Error('File was not dropped onto the floating ball')
      const directory = statSync(path).isDirectory()
      return { isDirectory: () => directory }
    } },
  })
}

export interface SuperPanelHostBridge {
  dbGet(key: 'settings-general'): Promise<AuxiliarySettings | undefined>
  getWindowMaterial(): Promise<'mica' | 'acrylic' | 'none'>
  getPlatform(): NodeJS.Platform
  showContextMenu(items: unknown[]): Promise<unknown>
}

/** Source renderer protocol; caller exposes this only to the bundled SuperPanel window. */
export function createSuperPanelBridge(ipc: IpcRenderer, host: SuperPanelHostBridge) {
  const listeners = new Set<() => void>()
  const on = <Data>(channel: string, callback: (data: Data) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, data: Data) => callback(data)
    ipc.on(channel, listener)
    const dispose = () => { ipc.removeListener(channel, listener); listeners.delete(dispose) }
    listeners.add(dispose)
    return dispose
  }
  const bridge: SuperPanelRendererBridge = {
    ...host,
    superPanelReady: () => ipc.send('super-panel:ready'),
    superPanelShowPinned: () => ipc.send('super-panel:show-pinned'),
    superPanelShowMainWindow: () => ipc.send('super-panel:show-main-window'),
    superPanelLaunch: (command: unknown) => ipc.invoke('super-panel:launch', command),
    superPanelAddBlockedApp: () => ipc.invoke('super-panel:add-blocked-app'),
    updateSuperPanelPinnedOrder: (commands: unknown[]) => ipc.invoke('super-panel:update-pinned-order', commands),
    unpinSuperPanelCommand: (path: string, featureCode?: string) => ipc.invoke('super-panel:unpin-command', path, featureCode),
    superPanelSearchWindowCommands: (windowInfo: unknown) => ipc.invoke('super-panel:search-window-commands', windowInfo),
    superPanelGetFileLocationWindows: () => ipc.invoke('super-panel:get-file-location-windows'),
    superPanelIsFileLocationWindow: (hwnd: number) => ipc.invoke('super-panel:is-file-location-window', hwnd),
    superPanelSetFileLocationAddressBar: (target: unknown, address: string) => ipc.invoke('super-panel:set-file-location-address-bar', target, address),
    onSuperPanelData: callback => on('super-panel-data', callback),
    onSuperPanelWindowCommandsData: callback => on('super-panel-window-commands-data', callback),
    onSuperPanelTranslation: callback => on('super-panel-translation', callback),
    onUpdateWindowMaterial: (callback: (data: 'mica' | 'acrylic' | 'none') => void) => on('update-window-material', callback),
    onUpdateAcrylicOpacity: (callback: (data: { lightOpacity: number; darkOpacity: number }) => void) => on('update-acrylic-opacity', callback),
    onUpdatePrimaryColor: (callback: (data: { primaryColor: string; customColor?: string }) => void) => on('update-primary-color', callback),
    onUpdateAvatar: (callback: (data: string) => void) => on('update-avatar', callback),
    onContextMenuCommand: (callback: (data: string) => void) => on('context-menu-command', callback),
  }
  return { bridge, dispose: () => { for (const remove of [...listeners]) remove() } }
}
