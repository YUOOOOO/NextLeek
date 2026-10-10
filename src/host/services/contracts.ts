import type { Context } from '@deepseek-ai/cordis'
import type { Command, CommandResult, DesktopEvent, Settings, LauncherSearchRequest, LauncherSearchGroup } from '../../shared/contracts'

export interface PersistentState {
  settings: Settings
  recent: string[]
  pinned: string[]
  enabled: Record<string, boolean>
}
export interface StorageService {
  read(): PersistentState
  write(state: PersistentState): void
}
export interface CommandsService {
  register(ctx: Context, command: Command, execute: () => Promise<CommandResult> | CommandResult): void
  list(): Command[]
  has(id: string): boolean
  run(id: string): Promise<CommandResult>
}
export type PluginEndpointHandler = (method: string, args: unknown) => Promise<unknown> | unknown
export interface PluginEndpointsService {
  register(ctx: Context, pluginId: string, handler: PluginEndpointHandler): void
  invoke(pluginId: string, method: string, args: unknown): Promise<unknown>
}
export interface DesktopService {
  applySettings(next: Settings, previous?: Settings): Promise<void>
  emit(event: DesktopEvent): void
  hide(): void
  quit(): void
  openDataDirectory(): Promise<void>
}
export interface SearchProvider {
  id: string
  title: string
  search(request: LauncherSearchRequest): Promise<Omit<LauncherSearchGroup, 'providerId' | 'title' | 'offset' | 'hasMore'>>
  performAction(itemId: string, action: string): Promise<void>
}
export interface SearchService {
  register(ctx: Context, provider: SearchProvider): void
  search(request: LauncherSearchRequest): Promise<LauncherSearchGroup[]>
  performAction(providerId: string, itemId: string, action: string): Promise<void>
}
export interface EverythingStatus {
  status: 'ready' | 'unavailable' | 'unsupported'
  message: string
  version?: string
}
export interface EverythingItem {
  id: string
  name: string
  path: string
  isDirectory: boolean
  size: number | null
  modifiedAt: string | null
}
export interface EverythingSearchResult {
  items: EverythingItem[]
  total: number
  hasMore: boolean
  offset: number
}
export type EverythingAction = 'open' | 'reveal' | 'copy-path'
export interface EverythingService {
  getStatus(): Promise<EverythingStatus>
  search(request: LauncherSearchRequest): Promise<EverythingSearchResult>
  performAction(id: string, action: EverythingAction): Promise<void>
}
declare module '@deepseek-ai/cordis' {
  interface Context {
    storage: StorageService
    commands: CommandsService
    pluginEndpoints: PluginEndpointsService
    search: SearchService
    desktop: DesktopService
    everything: EverythingService
  }
}
