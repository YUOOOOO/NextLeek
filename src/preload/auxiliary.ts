import { contextBridge, ipcRenderer, webUtils } from 'electron'
import { createSuperPanelBridge, installFloatingBallBridge } from '../../plugins/auxiliary-surfaces/preload'

// Built-in auxiliary pages receive only their explicit surface bridge, never desktop or market APIs.
const surfaces = process.argv.filter(argument => argument.startsWith('--source-surface='))
if (surfaces.length !== 1) throw new Error('Exactly one auxiliary surface is required')

switch (surfaces[0]) {
  case '--source-surface=floating-ball':
    installFloatingBallBridge(contextBridge, ipcRenderer, webUtils)
    break
  case '--source-surface=super-panel': {
    const { bridge, dispose } = createSuperPanelBridge(ipcRenderer, {
      dbGet: key => {
        if (key !== 'settings-general') throw new Error('Panel settings document denied')
        return ipcRenderer.invoke('auxiliary-panel:db-get', key)
      },
      getWindowMaterial: () => ipcRenderer.invoke('auxiliary-panel:material'),
      getPlatform: () => process.platform,
      showContextMenu: items => ipcRenderer.invoke('auxiliary-panel:context-menu', items),
    })
    contextBridge.exposeInMainWorld('ztools', Object.freeze(bridge))
    window.addEventListener('unload', dispose, { once: true })
    break
  }
  default:
    throw new Error('Unknown auxiliary surface')
}
