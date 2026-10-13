// Adapted from ZTools (MIT); original source attribution is retained in LICENSE.
import type { BrowserWindow, BrowserWindowConstructorOptions, IpcMain, Menu, screen } from 'electron'

export interface AuxiliaryOwner { effect(setup: () => () => void): unknown }
export interface FileLocationWindowInfo {
  platform?: 'win32' | 'darwin'
  kind?: 'windows-explorer' | 'windows-file-dialog' | 'mac-finder' | 'mac-file-dialog'
  preciseTarget?: boolean
  hwnd?: number; windowId?: number; finderId?: number; pid?: number
  bundleId?: string; app?: string; title?: string; className?: string
  axRole?: string; axSubrole?: string; path?: string; url?: string
  x?: number; y?: number; width?: number; height?: number; appPath?: string
}
export interface ClipboardContent {
  type: 'text' | 'image' | 'file'
  text?: string; image?: string
  files?: Array<{ path: string; name: string; isDirectory: boolean }>
}
export interface LastCopiedContent {
  type: 'text' | 'image' | 'file'
  data: string | Array<{ path: string; name: string; isDirectory: boolean }>
}
export type MouseMonitorResult = { shouldBlock?: boolean } | void
export interface AuxiliaryCommand {
  name: string; path: string; type?: string; icon?: string; featureCode?: string
  pluginName?: string; pluginExplain?: string; cmdType?: string; commandId?: string
  id?: string; subType?: string; param?: unknown
  isFolder?: boolean; items?: AuxiliaryCommand[]; windowInfo?: FileLocationWindowInfo
}
export interface AuxiliarySettings {
  floatingBallEnabled?: boolean; floatingBallLetter?: string; floatingBallDoubleClickCommand?: string
  floatingBallPosition?: { x: number; y: number }
  superPanelEnabled?: boolean; superPanelMouseButton?: 'middle' | 'right' | 'back' | 'forward'
  superPanelLongPressMs?: number; superPanelBlockedApps?: Array<{ app: string; bundleId?: string; label?: string }>
  windowMaterial?: 'mica' | 'acrylic' | 'none'
  avatar?: string; acrylicLightOpacity?: number; acrylicDarkOpacity?: number
  primaryColor?: string; customColor?: string
}
export interface AuxiliaryCommonDependencies {
  BrowserWindow: new (options: BrowserWindowConstructorOptions) => BrowserWindow
  screen: typeof screen
  ipcMain: IpcMain
  databaseAPI: {
    dbGet(key: 'settings-general'): AuxiliarySettings | undefined
    dbGet(key: 'super-panel-pinned'): AuxiliaryCommand[] | undefined
    dbPut(key: string, value: unknown): Promise<unknown>
  }
  windowManager: {
    getMainWindow(): BrowserWindow | null
    showWindow(): unknown
    hideWindow(restorePrevious: boolean): unknown
    setPreviousActiveWindow(info: FileLocationWindowInfo): unknown
  }
  preloadPath: string
  /** Only trusted built-in commands may execute; static .nlplugin permissions remain enforced. */
  launchCommand(command: AuxiliaryCommand | string, payload: { launchSource: 'floating-ball' | 'super-panel'; clipboardContent?: ClipboardContent | null; windowInfo?: FileLocationWindowInfo | null }): Promise<unknown>
  sendMainEvent(name: 'floating-ball-files', payload: unknown): void
}
export interface FloatingBallDependencies extends AuxiliaryCommonDependencies {
  Menu: typeof Menu
  floatingBallHtml: string
}
export interface SuperPanelDependencies extends AuxiliaryCommonDependencies {
  platform: NodeJS.Platform
  MouseMonitor: {
    readonly isMonitoring: boolean
    start(button: 'middle' | 'right' | 'back' | 'forward', longPressMs: number, callback: () => MouseMonitorResult): void
    stop(): void
  }
  WindowManager: {
    getActiveWindow(): FileLocationWindowInfo | null
    getExplorerFolderPath(hwnd: number): string | null
    simulateKeyboardTap(key: string, modifier: string): unknown
    getAllExplorerWindows(): Array<FileLocationWindowInfo | string>
    isFileLocationWindow?(hwnd: number): boolean
    setAddressBar(target: number | string | FileLocationWindowInfo, address: string): boolean
  }
  ClipboardMonitor: { setClipboardPollingBoost(interval: number, duration: number): unknown }
  clipboardManager: {
    getCurrentWindow(): FileLocationWindowInfo | null
    getLastCopiedSequence(): number
    getLastCopiedContent(waitMs: number, afterSequence: number): Promise<LastCopiedContent | null>
  }
  dndManager: { shouldIgnoreHotkeys(): boolean }
  pluginsAPI: { getDisabledPluginSet(): Set<string> }
  /** Load the actual renderer entry in this plugin, not a reconstructed host page. */
  loadPanelWindow(window: BrowserWindow): void | Promise<void>
  applyWindowMaterial(window: BrowserWindow, material: 'mica' | 'acrylic' | 'none'): void
  getDefaultWindowMaterial(): 'mica' | 'acrylic' | 'none'
  searchCommands(content: ClipboardContent): Promise<AuxiliaryCommand[]>
  searchWindowCommands(windowInfo: FileLocationWindowInfo): Promise<AuxiliaryCommand[]>
  /** Translation/providers are excluded unless a real provider is supplied. */
  translate?: (text: string) => Promise<{ text?: string } | null>
}
