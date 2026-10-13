import type { Context } from '@deepseek-ai/cordis'
import type { BrowserWindow, MenuItemConstructorOptions } from 'electron'
import type { AuxiliaryCommand, AuxiliarySettings, ClipboardContent, FileLocationWindowInfo, FloatingBallDependencies, SuperPanelDependencies } from './contracts'
import type { ZToolsNativeAddon } from '../native-context/windows-native'
import { createFloatingBallManager, type FloatingBallService } from './floating-ball'
import { createSuperPanelManager, type SuperPanelService } from './super-panel'
import { createOwnedIPC } from './owned-ipc'

export interface AuxiliarySurfacesOptions extends Omit<SuperPanelDependencies, 'databaseAPI' | 'MouseMonitor' | 'WindowManager' | 'ClipboardMonitor' | 'clipboardManager' | 'dndManager' | 'launchCommand' | 'searchCommands' | 'searchWindowCommands'> {
  Menu: FloatingBallDependencies['Menu']
  floatingBallHtml: string
  native: ZToolsNativeAddon
  mainWindow: BrowserWindow
}

export interface SourceResponse { requestId: number; results?: AuxiliaryCommand[]; success?: boolean; error?: string }
export type AuxiliarySurfacesService = {
  floating: FloatingBallService
  superPanel: SuperPanelService
  setFloatingBallEnabled(enabled: boolean): Promise<{ success: boolean }>
  setFloatingBallLetter(letter: string): Promise<{ success: boolean }>
  setFloatingBallDoubleClickCommand(command: string): Promise<{ success: boolean }>
  updateSuperPanelConfig(config: { enabled: boolean; mouseButton: string; longPressMs: number }): void
  updateSuperPanelBlockedApps(apps: NonNullable<AuxiliarySettings['superPanelBlockedApps']>): void
  acceptSourceResponse(kind: 'search' | 'window' | 'launch', response: SourceResponse): void
}
declare module '@deepseek-ai/cordis' { interface Context { auxiliarySurfaces: AuxiliarySurfacesService } }

/** Actual managers and source-renderer RPC belong to this Cordis scope, not desktop bootstrap. */
export function createAuxiliarySurfacesPlugin(options: AuxiliarySurfacesOptions) {
  return {
    name: 'auxiliary-surfaces', inject: ['desktop', 'settings', 'nativeContext', 'commands', 'pluginEndpoints'],
    async apply(ctx: Context) {
      let nextRequest = 0
      let active = true
      let monitoring = false
      const pending = new Map<number, { kind: 'search' | 'window' | 'launch'; resolve(value: AuxiliaryCommand[] | boolean): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }>()
      const request = (kind: 'search' | 'window' | 'launch', name: string, payload: Record<string, unknown>) => new Promise<AuxiliaryCommand[] | boolean>((resolve, reject) => {
        if (!active) { reject(new Error('Auxiliary surfaces disposed')); return }
        const requestId = ++nextRequest
        const timer = setTimeout(() => { pending.delete(requestId); reject(new Error(`Source ${kind} request timed out`)) }, 10000)
        pending.set(requestId, { kind, resolve, reject, timer })
        ctx.desktop.emit({ type: 'source-event', name, payload: { ...payload, requestId } })
      })
      let pinned: AuxiliaryCommand[] = []
      const reloadPinned = async () => {
        const value = await ctx.pluginEndpoints.invoke('builtin-search', 'getSuperPanelPinned', [])
        if (!Array.isArray(value)) throw new TypeError('Super panel pinned document must be an array')
        pinned = value as AuxiliaryCommand[]
      }
      await reloadPinned()
      const databaseAPI = {
        dbGet(key: 'settings-general' | 'super-panel-pinned') {
          return key === 'super-panel-pinned' ? structuredClone(pinned) : structuredClone(ctx.settings.getDocument(key)) as AuxiliarySettings | undefined
        },
        async dbPut(key: string, value: unknown) {
          await ctx.pluginEndpoints.invoke('settings', 'dbPut', { key, value })
          if (key === 'super-panel-pinned') await reloadPinned()
        },
      } as SuperPanelDependencies['databaseAPI']
      const common = {
        ...options, databaseAPI,
        async launchCommand(command: AuxiliaryCommand | string, payload: Parameters<SuperPanelDependencies['launchCommand']>[1]) {
          if (typeof command === 'string') {
            ctx.desktop.emit({ type: 'source-event', name: 'floating-ball-double-click-command', payload: command })
            return
          }
          await request('launch', 'super-panel-launch', { command, ...payload })
        },
      }
      const floating = createFloatingBallManager(common, ctx)
      const superPanel = createSuperPanelManager({
        ...common,
        MouseMonitor: {
          get isMonitoring() { return monitoring },
          start(button, delay, callback) { options.native.startMouseMonitor(button, delay, callback); monitoring = true },
          stop() { if (monitoring) { options.native.stopMouseMonitor(); monitoring = false } },
        },
        WindowManager: options.native,
        ClipboardMonitor: { setClipboardPollingBoost(interval, duration) {
          if (options.native.setClipboardPollingBoost) options.native.setClipboardPollingBoost(interval, duration)
          else throw new Error('Clipboard polling boost is unavailable')
        } },
        clipboardManager: ctx.nativeContext.clipboardManager,
        dndManager: ctx.nativeContext,
        async searchCommands(content: ClipboardContent) {
          const result = await request('search', 'super-panel-search', { text: content.type === 'text' ? content.text ?? '' : '', clipboardContent: content })
          if (!Array.isArray(result)) throw new TypeError('Source search response must contain commands')
          return result
        },
        async searchWindowCommands(windowInfo: FileLocationWindowInfo) {
          const result = await request('window', 'super-panel-search-window-commands', { windowInfo })
          if (!Array.isArray(result)) throw new TypeError('Source window response must contain commands')
          return result
        },
      }, ctx)
      ctx.effect(() => () => {
        active = false
        for (const item of pending.values()) { clearTimeout(item.timer); item.reject(new Error('Auxiliary surfaces disposed')) }
        pending.clear()
      }, 'source surface requests')
      const service: AuxiliarySurfacesService = {
        floating, superPanel,
        setFloatingBallEnabled: enabled => floating.setEnabled(enabled),
        setFloatingBallLetter: letter => floating.setLetter(letter),
        setFloatingBallDoubleClickCommand: command => floating.setDoubleClickCommand(command),
        updateSuperPanelConfig: config => superPanel.updateConfig(config),
        updateSuperPanelBlockedApps: apps => superPanel.updateBlockedApps(apps),
        acceptSourceResponse(kind, response) {
          if (!response || typeof response.requestId !== 'number') throw new TypeError('Invalid source response')
          const item = pending.get(response.requestId)
          if (!item || item.kind !== kind) return
          pending.delete(response.requestId); clearTimeout(item.timer)
          if (response.error || response.success === false) item.reject(new Error(response.error ?? 'Source launch failed'))
          else if (kind === 'launch' && response.success === true) item.resolve(true)
          else if (Array.isArray(response.results)) item.resolve(response.results)
          else item.reject(new TypeError('Source matching response has no commands'))
        },
      }
      ctx.provide('auxiliarySurfaces', service)
      const panelIPC = createOwnedIPC(options.ipcMain, (_channel, sender) => superPanel.accepts('super-panel:ready', sender))
      panelIPC.handle('auxiliary-panel:db-get', (_event, key: string) => {
        if (key !== 'settings-general') throw new Error('Panel settings document denied')
        return ctx.settings.getDocument(key)
      })
      panelIPC.handle('auxiliary-panel:material', () => options.getDefaultWindowMaterial())
      panelIPC.handle('auxiliary-panel:context-menu', (event, raw: MenuItemConstructorOptions[]) => {
        if (!Array.isArray(raw)) throw new TypeError('Invalid context menu')
        const buildItems = (entries: MenuItemConstructorOptions[]): MenuItemConstructorOptions[] => entries.map(item => {
          if (item.type === 'separator') return { type: 'separator' }
          if (typeof item.label !== 'string' || typeof item.id !== 'string') throw new TypeError('Context menu label/id required')
          const submenu = Array.isArray(item.submenu) ? buildItems(item.submenu) : undefined
          return { id: item.id, label: item.label, enabled: item.enabled !== false, submenu,
            click: submenu ? undefined : () => { if (!event.sender.isDestroyed()) event.sender.send('context-menu-command', item.id) } }
        })
        options.Menu.buildFromTemplate(buildItems(raw)).popup()
      })
      ctx.effect(() => () => panelIPC.dispose(), 'panel native IPC')
      ctx.settings.subscribe(ctx, (key, value) => {
        if (key === 'super-panel-pinned') {
          if (!Array.isArray(value)) throw new TypeError('Pinned document must be an array')
          pinned = value as AuxiliaryCommand[]
        }
      })
      await floating.init()
      superPanel.init(options.mainWindow)
    },
  }
}
