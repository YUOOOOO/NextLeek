import type { AuxiliaryCommand, AuxiliarySettings, ClipboardContent, FileLocationWindowInfo } from './contracts'

export interface SuperPanelMenuItem { id?: string; label?: string; type?: 'separator'; enabled?: boolean; submenu?: SuperPanelMenuItem[] }
export interface SuperPanelData {
  type: 'pinned' | 'search'
  commands?: AuxiliaryCommand[]
  results?: AuxiliaryCommand[]
  clipboardContent?: ClipboardContent | null
  windowInfo?: FileLocationWindowInfo | null
}
export interface SuperPanelRendererBridge {
  dbGet(key: 'settings-general'): Promise<AuxiliarySettings | undefined>
  getWindowMaterial(): Promise<'mica' | 'acrylic' | 'none'>
  getPlatform(): NodeJS.Platform
  showContextMenu(items: SuperPanelMenuItem[]): Promise<unknown>
  superPanelReady(): void
  superPanelShowPinned(): void
  superPanelShowMainWindow(): void
  superPanelLaunch(command: unknown): Promise<unknown>
  superPanelAddBlockedApp(): Promise<unknown>
  updateSuperPanelPinnedOrder(commands: unknown[]): Promise<unknown>
  unpinSuperPanelCommand(path: string, featureCode?: string): Promise<unknown>
  superPanelSearchWindowCommands(windowInfo: unknown): Promise<unknown>
  superPanelGetFileLocationWindows(): Promise<Array<FileLocationWindowInfo | string>>
  superPanelIsFileLocationWindow(hwnd: number): Promise<{ supported: boolean; isFileLocation: boolean }>
  superPanelSetFileLocationAddressBar(target: unknown, address: string): Promise<boolean>
  onSuperPanelData(callback: (data: SuperPanelData) => void): () => void
  onSuperPanelWindowCommandsData(callback: (data: { results: AuxiliaryCommand[] }) => void): () => void
  onSuperPanelTranslation(callback: (data: { text: string; sourceText?: string }) => void): () => void
  onUpdateWindowMaterial(callback: (data: 'mica' | 'acrylic' | 'none') => void): () => void
  onUpdateAcrylicOpacity(callback: (data: { lightOpacity: number; darkOpacity: number }) => void): () => void
  onUpdatePrimaryColor(callback: (data: { primaryColor: string; customColor?: string }) => void): () => void
  onUpdateAvatar(callback: (data: string) => void): () => void
  onContextMenuCommand(callback: (data: string) => void): () => void
}
