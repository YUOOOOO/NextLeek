// Foreground policy adapted from ZTools dndManager/windowManager/superPanelManager (MIT).
import type { ForegroundWindow } from './windows-native'

export interface BlockedApplication { app: string; bundleId?: string; label?: string }
const desktopClasses: Record<string, true> = { Progman: true, WorkerW: true, Shell_TrayWnd: true, Shell_SecondaryTrayWnd: true }

export function isWindowsDesktopWindow(window: ForegroundWindow): boolean {
  return typeof window.className === 'string' && desktopClasses[window.className] === true
}

export function isFullscreenWindow(window: ForegroundWindow, platform: NodeJS.Platform = process.platform): boolean {
  if (window.pid === process.pid) return false
  if (platform === 'win32' && isWindowsDesktopWindow(window)) return false
  return (platform === 'win32' || platform === 'darwin') && window.isFullscreen === true
}

export function isWakeupBlocked(window: ForegroundWindow, blacklist: readonly BlockedApplication[], platform: NodeJS.Platform = process.platform): boolean {
  if (platform === 'darwin' && window.bundleId) return blacklist.some(item => item.bundleId === window.bundleId)
  return blacklist.some(item => item.app.toLowerCase() === window.app.toLowerCase())
}

export function isSuperPanelBlocked(window: ForegroundWindow, blacklist: readonly BlockedApplication[]): boolean {
  return blacklist.some(item => Boolean(item.bundleId && window.bundleId && item.bundleId.toLowerCase() === window.bundleId.toLowerCase()) || item.app.toLowerCase() === window.app.toLowerCase())
}
