import type { Settings } from '../../src/shared/contracts'

export interface ForegroundApplication { app: string; bundleId?: string; label?: string }
export interface SettingsNative {
  prepareShortcut?(flags: { autoCopy: boolean; preScreenshotOptimization: boolean }): Promise<void>
  showMainWindow(text?: string): Promise<void>
  toggleMainWindow(): Promise<void>
  launchSystemSetting(uri: string): Promise<void>
  setWindowOpacity(value: number): Promise<void> | void
  setWindowDefaultHeight(value: number): Promise<void> | void
  setWindowMaterial(value: 'mica' | 'acrylic' | 'none'): Promise<void> | void
  setTrayIconVisible(value: boolean): Promise<void> | void
  setLaunchAtLogin(value: boolean): Promise<void> | void
  getLaunchAtLogin(): Promise<boolean> | boolean
  setProxyConfig(value: { enabled: boolean; url: string }): Promise<void> | void
  selectAvatar(): Promise<{ success: boolean; path?: string; error?: string }>
  selectSearchWallpaper(): Promise<{ success: boolean; path?: string; error?: string }>
  getCurrentWindowInfo(): Promise<ForegroundApplication | null>
  setIgnoreHotkeysOnFullscreen(value: boolean): Promise<void> | void
  setFloatingBallEnabled(value: boolean): Promise<void> | void
  setFloatingBallLetter(value: string): Promise<void> | void
  updateSuperPanelConfig(value: { enabled: boolean; mouseButton: string; longPressMs: number }): Promise<void> | void
  updateClipboardConfig(value: { retentionDays: number }): Promise<void> | void
  updateWakeupBlacklist(value: ForegroundApplication[]): Promise<void> | void
  updateSuperPanelBlockedApps(value: ForegroundApplication[]): Promise<void> | void
  setAcrylicOpacity(light: number, dark: number): Promise<void> | void
  getSystemSettings(): Array<{ name: string; uri: string; category?: string; confirmDialog?: { title: string; message: string } }>
}

// Native OS operations only. Settings documents, commands and server lifecycle belong to plugins.
export interface SettingsNativeDesktop {
  settingsNative: SettingsNative
  applySettings(next: Settings, previous?: Settings): Promise<void>
}
