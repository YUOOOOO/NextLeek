export const themes = ['system', 'light', 'dark'] as const
export const accents = ['blue', 'violet', 'rose', 'orange', 'green', 'teal'] as const
export interface Settings {
  hotkey: string
  autostart: boolean
  theme: (typeof themes)[number]
  accent: (typeof accents)[number]
  compact: boolean
  escHide: boolean
}
export interface Command {
  id: string
  title: string
  description: string
  icon: string
  keywords: string[]
}
export type Page = 'launcher' | 'settings' | 'plugins' | 'theme'
export interface CommandResult { navigate?: Page }
export interface PluginInfo {
  id: string
  name: string
  version: string
  enabled: boolean
  protected: boolean
  status: 'pending' | 'loading' | 'active' | 'failed' | 'disposed' | 'unloading' | 'disabled'
}
export interface Snapshot {
  settings: Settings
  plugins: PluginInfo[]
  recent: string[]
  pinned: string[]
}
export interface LauncherSearchRequest { query: string; offset: number; limit: number }
export interface LauncherSearchAction { id: string; label: string }
export interface LauncherSearchItem {
  id: string
  name: string
  path: string
  isDirectory: boolean
  size: number | null
  modifiedAt: string | null
  icon?: string
  iconUrl?: string
  actions: LauncherSearchAction[]
}
export interface LauncherSearchGroup {
  providerId: string
  title: string
  status: 'ready' | 'unavailable' | 'unsupported' | 'error'
  message?: string
  items: LauncherSearchItem[]
  total: number
  offset: number
  hasMore: boolean
}
export interface UpdateState {
  status: 'unsupported' | 'idle' | 'checking' | 'available' | 'not-available' | 'downloading' | 'downloaded' | 'installing' | 'error'
  currentVersion: string
  supported: boolean
  message: string
  version?: string
  progress?: { percent: number; transferred: number; total: number; bytesPerSecond: number }
}
export type DesktopEvent =
  | { type: 'snapshot'; snapshot: Snapshot }
  | { type: 'navigate'; page: Page }
  | { type: 'shown' }
  | { type: 'close-request' }
  | { type: 'hotkey'; value: string }
  | { type: 'update'; update: UpdateState }
export interface DesktopAPI {
  getSnapshot(): Promise<Snapshot>
  updateSettings(patch: Partial<Settings>): Promise<Snapshot>
  listCommands(): Promise<Command[]>
  runCommand(id: string): Promise<CommandResult>
  setPinned(id: string, pinned: boolean): Promise<Snapshot>
  setPluginEnabled(id: string, enabled: boolean): Promise<Snapshot>
  hide(): Promise<void>
  quit(): Promise<void>
  setHotkeyCapture(active: boolean): Promise<void>
  setLauncherHeight(height: number): Promise<void>
  getUpdateState(): Promise<UpdateState>
  checkForUpdates(): Promise<UpdateState>
  downloadUpdate(): Promise<UpdateState>
  installUpdate(): Promise<UpdateState>
  searchLauncher(request: LauncherSearchRequest): Promise<LauncherSearchGroup[]>
  performSearchAction(providerId: string, itemId: string, action: string): Promise<void>
  subscribe(callback: (event: DesktopEvent) => void): () => void
}
export const channels = {
  snapshot: 'desktop:snapshot', settings: 'desktop:settings', commands: 'desktop:commands',
  run: 'desktop:run', pin: 'desktop:pin', plugin: 'desktop:plugin', hide: 'desktop:hide',
  quit: 'desktop:quit', event: 'desktop:event',
  hotkeyCapture: 'desktop:hotkey-capture', layout: 'desktop:layout',
  updateState: 'desktop:update-state', updateCheck: 'desktop:update-check',
  updateDownload: 'desktop:update-download', updateInstall: 'desktop:update-install',
  searchLauncher: 'desktop:search-launcher', searchAction: 'desktop:search-action',
} as const
