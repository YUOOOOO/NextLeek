// Native primitives adapted from ZTools (MIT); the plugin owns all monitoring lifetimes.
import { createRequire } from 'node:module'
import path from 'node:path'

export interface ForegroundWindow {
  app: string
  appName?: string
  bundleId?: string
  pid?: number
  processId?: number
  title?: string
  x?: number
  y?: number
  width?: number
  height?: number
  appPath?: string
  className?: string
  hwnd?: number
  isFullscreen?: boolean
  error?: string
}
export interface FileLocationWindowInfo {
  platform?: 'win32' | 'darwin'
  kind?: 'windows-explorer' | 'windows-file-dialog' | 'mac-finder' | 'mac-file-dialog'
  preciseTarget?: boolean
  hwnd?: number
  windowId?: number
  finderId?: number
  pid?: number
  bundleId?: string
  app?: string
  title?: string
  className?: string
  axRole?: string
  axSubrole?: string
  path?: string
  url?: string
}
export interface ClipboardFile { path: string; name: string; isDirectory: boolean }
export interface ZToolsNativeAddon {
  startMonitor(callback: () => void): void
  stopMonitor(): void
  startWindowMonitor(callback: (window: ForegroundWindow) => void): void
  stopWindowMonitor(): void
  getActiveWindow(): ForegroundWindow | null
  activateWindow(identifier: string | number): boolean
  getClipboardFiles(): ClipboardFile[]
  setClipboardFiles(files: Array<string | { path: string }>): boolean
  simulatePaste(): boolean
  simulateKeyboardTap(key: string, ...modifiers: string[]): boolean
  startMouseMonitor(button: 'middle' | 'right' | 'back' | 'forward', longPressMs: number, callback: () => void | { shouldBlock?: boolean }): void
  stopMouseMonitor(): void
  setClipboardPollingBoost?(intervalMs: number, durationMs: number): void
  getExplorerFolderPath(hwnd: number): string | null
  getAllExplorerWindows(): Array<FileLocationWindowInfo | string>
  isFileLocationWindow?(hwnd: number): boolean
  setAddressBar(identifier: number | string | FileLocationWindowInfo, address: string): boolean
}

/** Loads the existing upstream N-API binary; never substitutes made-up foreground information. */
export function loadWindowsNativeAddon(addonPath: string): ZToolsNativeAddon {
  if (process.platform !== 'win32') throw new Error('Windows native addon requires Windows')
  if (!path.isAbsolute(addonPath)) throw new Error('Native addon path must be absolute')
  process.env.ZTOOLS_LOG_LEVEL ??= 'off'
  const addon = createRequire(import.meta.url)(addonPath) as ZToolsNativeAddon
  for (const method of ['startMonitor', 'stopMonitor', 'startWindowMonitor', 'stopWindowMonitor', 'getActiveWindow', 'activateWindow', 'getClipboardFiles', 'setClipboardFiles', 'startMouseMonitor', 'stopMouseMonitor'] as const) {
    if (typeof addon[method] !== 'function') throw new Error(`ZTools native addon missing ${method}`)
  }
  return addon
}
