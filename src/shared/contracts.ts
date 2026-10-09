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
export type DesktopEvent =
  | { type: 'snapshot'; snapshot: Snapshot }
  | { type: 'navigate'; page: Page }
  | { type: 'shown' }
export interface DesktopAPI {
  getSnapshot(): Promise<Snapshot>
  updateSettings(patch: Partial<Settings>): Promise<Snapshot>
  listCommands(): Promise<Command[]>
  runCommand(id: string): Promise<CommandResult>
  setPinned(id: string, pinned: boolean): Promise<Snapshot>
  setPluginEnabled(id: string, enabled: boolean): Promise<Snapshot>
  hide(): Promise<void>
  quit(): Promise<void>
  subscribe(callback: (event: DesktopEvent) => void): () => void
}
export const channels = {
  snapshot: 'desktop:snapshot', settings: 'desktop:settings', commands: 'desktop:commands',
  run: 'desktop:run', pin: 'desktop:pin', plugin: 'desktop:plugin', hide: 'desktop:hide',
  quit: 'desktop:quit', event: 'desktop:event',
} as const
