import type { Context } from '@deepseek-ai/cordis'
import type { Command, CommandResult, DesktopEvent, Settings, EverythingStatus, EverythingSearchRequest, EverythingSearchResult, EverythingAction } from '../../shared/contracts'

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
export interface DesktopService {
  applySettings(next: Settings, previous?: Settings): Promise<void>
  emit(event: DesktopEvent): void
  hide(): void
  quit(): void
  openDataDirectory(): Promise<void>
}
export interface EverythingService {
  getStatus(): Promise<EverythingStatus>
  search(request: EverythingSearchRequest): Promise<EverythingSearchResult>
  performAction(id: string, action: EverythingAction): Promise<void>
}
declare module '@deepseek-ai/cordis' {
  interface Context {
    storage: StorageService
    commands: CommandsService
    desktop: DesktopService
    everything: EverythingService
  }
}
