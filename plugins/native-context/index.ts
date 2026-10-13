// ZTools native context integration (MIT); native I/O is injected, business state belongs here.
import type { clipboard, nativeImage } from 'electron'
import { ClipboardManager, type ClipboardConfig, type ClipboardItem, type FileItem } from './clipboard-manager'
import { isFullscreenWindow, isSuperPanelBlocked, isWakeupBlocked, type BlockedApplication } from './foreground'
import type { ForegroundWindow, ZToolsNativeAddon } from './windows-native'
export { loadWindowsNativeAddon } from './windows-native'
export type { ForegroundWindow, ZToolsNativeAddon } from './windows-native'
export { isFullscreenWindow, isWindowsDesktopWindow, isWakeupBlocked, isSuperPanelBlocked } from './foreground'

export interface Monitor<T> { start(callback: (value: T) => void): void; stop(): void }
export interface ClipboardDocument extends Omit<ClipboardItem, 'id'> { _id: string }
export interface ClipboardDatabase {
  get(id: string): Promise<ClipboardDocument | undefined | null>
  put(document: ClipboardDocument): Promise<unknown>
  remove(id: string): Promise<unknown>
  allDocs(prefix: string): Promise<ClipboardDocument[]>
}
export interface NativeContextDependencies {
  native: ZToolsNativeAddon
  clipboard: typeof clipboard
  nativeImage: typeof nativeImage
  database: ClipboardDatabase
  clipboardPath: string
  getSettings(): unknown | Promise<unknown>
  onClipboardChange(item: ClipboardItem): void
  onError(error: unknown): void
  /** Registers the disposer with the owning Cordis runtime scope. */
  onDispose(dispose: () => Promise<void>): void
  platform?: NodeJS.Platform
}
export interface ClipboardDependencies extends Omit<NativeContextDependencies, 'getSettings' | 'platform'> {
  platform: NodeJS.Platform
  getSettings(): Promise<{ clipboardRetentionDays?: number } | null>
  clipboardMonitor: Monitor<void>
  windowMonitor: Monitor<ForegroundWindow>
  readClipboardFiles(): FileItem[]
}

export interface NativeContextService {
  clipboardManager: ClipboardManager
  getLastCopiedContent(timeLimit?: number, minSequence?: number): Promise<{ lastText: string | null; lastImage: string | null; lastFiles: FileItem[] | null }>
  getCurrentWindowInfo(): Promise<ForegroundWindow | null>
  getActiveWindow(): ForegroundWindow | null
  updateClipboardConfig(config: Partial<ClipboardConfig>): void
  setIgnoreHotkeysOnFullscreen(value: boolean): void
  updateWakeupBlacklist(value: BlockedApplication[]): void
  updateSuperPanelBlockedApps(value: BlockedApplication[]): void
  shouldIgnoreHotkeys(): boolean
  isWakeupBlocked(window?: ForegroundWindow | null): boolean
  isSuperPanelBlocked(window?: ForegroundWindow | null): boolean
  dispose(): Promise<void>
}

/** Starts real OS clipboard/window monitors, binding all effects to the caller's plugin scope. */
export async function createNativeContext(deps: NativeContextDependencies): Promise<NativeContextService> {
  const platform = deps.platform ?? process.platform
  if (platform !== 'win32') throw new Error('Native context currently requires the upstream Windows native addon')
  let clipboardStarted = false
  let windowStarted = false
  const manager = new ClipboardManager({
    ...deps, platform,
    getSettings: async () => {
      const settings = await deps.getSettings()
      return settings && typeof settings === 'object' ? settings as { clipboardRetentionDays?: number } : null
    },
    readClipboardFiles: () => deps.native.getClipboardFiles(),
    clipboardMonitor: {
      start(callback) { deps.native.startMonitor(callback); clipboardStarted = true },
      stop() { if (clipboardStarted) { clipboardStarted = false; deps.native.stopMonitor() } },
    },
    windowMonitor: {
      start(callback) { deps.native.startWindowMonitor(callback); windowStarted = true },
      stop() { if (windowStarted) { windowStarted = false; deps.native.stopWindowMonitor() } },
    },
  })
  deps.onDispose(() => manager.dispose())
  try { await manager.start() } catch (error) { await manager.dispose(); throw error }
  let wakeupBlacklist: BlockedApplication[] = []
  let superPanelBlacklist: BlockedApplication[] = []
  let ignoreFullscreen = false
  return {
    clipboardManager: manager,
    /** Source search bridge shape: a single last snapshot, never unrelated clipboard reads. */
    async getLastCopiedContent(timeLimit?: number, minSequence?: number) {
      const content = await manager.getLastCopiedContent(timeLimit, minSequence)
      return {
        lastText: content?.type === 'text' ? content.data as string : null,
        lastImage: content?.type === 'image' ? content.data as string : null,
        lastFiles: content?.type === 'file' ? content.data as FileItem[] : null,
      }
    },
    // Settings must use the monitored previous app, not the settings window currently in front.
    async getCurrentWindowInfo() { return manager.getCurrentWindow() },
    getActiveWindow() {
      const window = deps.native.getActiveWindow()
      return window && !window.error ? window : null
    },
    updateClipboardConfig(config: Partial<ClipboardConfig>) { manager.updateConfig(config) },
    setIgnoreHotkeysOnFullscreen(value: boolean) { ignoreFullscreen = value },
    updateWakeupBlacklist(value: BlockedApplication[]) { wakeupBlacklist = value.map(item => ({ ...item })) },
    updateSuperPanelBlockedApps(value: BlockedApplication[]) { superPanelBlacklist = value.map(item => ({ ...item })) },
    shouldIgnoreHotkeys() {
      if (!ignoreFullscreen) return false
      const window = deps.native.getActiveWindow()
      return !!window && !window.error && isFullscreenWindow(window, platform)
    },
    isWakeupBlocked(window?: ForegroundWindow | null) {
      const active = window ?? deps.native.getActiveWindow()
      return !!active && !active.error && isWakeupBlocked(active, wakeupBlacklist, platform)
    },
    isSuperPanelBlocked(window?: ForegroundWindow | null) {
      const active = window ?? deps.native.getActiveWindow()
      return !!active && !active.error && isSuperPanelBlocked(active, superPanelBlacklist)
    },
    dispose: () => manager.dispose(),
  }
}
