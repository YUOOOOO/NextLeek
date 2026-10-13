import type { Context } from '@deepseek-ai/cordis'
import { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, nativeImage, screen, shell } from 'electron'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import type { Session } from 'electron'
import type { FileLocationWindowInfo } from '../../../plugins/auxiliary-surfaces/contracts'
import { createSettingsNativeBaseline } from './settings-native'
import { loadWindowsNativeAddon } from '../../../plugins/native-context'
import { launchSystemSetting } from '../../../plugins/native-system-settings/host'
import type { SettingsNative } from '../../../plugins/settings/native-contract'
import type { RuntimeOptions } from '../runtime'
import type { DesktopEvent } from '../../shared/contracts'
import type { ZToolsNativeAddon } from '../../../plugins/native-context/windows-native'

export interface SourceEnvironment {
  settingsNative: SettingsNative
  options: RuntimeOptions
  getWindowMaterial(): 'none' | 'mica' | 'acrylic'
  native: ZToolsNativeAddon
  getContext(): Context
  start(): Promise<void>
}

// 仅注入原生端口；剪贴板和辅助窗口实例由各自 Cordis 插件拥有。
export function createSourceEnvironment(ports: {
  window: BrowserWindow; rendererSession: Session; rendererFile: string; preloadDirectory: string; resourcesDirectory: string;
  emit(event: DesktopEvent): void; show(): void; toggle(): void;
  setTrayVisible(visible: boolean): void; setDefaultHeight(height: number): void;
}): SourceEnvironment {
  let context: Context | undefined
  let material: 'none' | 'mica' | 'acrylic' = 'none'
  let previousWindow: FileLocationWindowInfo | null = null
  const startup: Array<() => Promise<void>> = []
  const native = loadWindowsNativeAddon(join(ports.resourcesDirectory, 'native', 'ztools_native.node'))
  const getContext = () => { if (!context) throw new Error('Source runtime is not ready'); return context }
  const baseline = createSettingsNativeBaseline({
    window: ports.window, app, session: ports.rendererSession,
    sessions: () => [ports.rendererSession, ...BrowserWindow.getAllWindows().map(window => window.webContents.session)], dialog, nativeImage,
    setTrayIconVisible: ports.setTrayVisible, setWindowDefaultHeight: ports.setDefaultHeight,
    broadcast(name, payload) {
      if (name === 'update-window-material') material = payload as typeof material
      ports.emit({ type: 'source-event', name, payload })
      for (const window of BrowserWindow.getAllWindows()) if (!window.isDestroyed()) window.webContents.send(name, payload)
    },
  })
  const settingsNative: SettingsNative = {
    ...baseline,
    async showMainWindow(text) { ports.show(); if (text !== undefined) ports.emit({ type: 'source-event', name: 'set-search-text', payload: text }) },
    async toggleMainWindow() { ports.toggle() },
    async launchSystemSetting(uri) {
      await launchSystemSetting(uri, { openExternal: uri => shell.openExternal(uri), confirm: async options => {
        const result = await dialog.showMessageBox(ports.window, { type: 'warning', title: options.title, message: options.message, buttons: ['取消', '确认'], defaultId: 0, cancelId: 0 })
        return result.response === 1
      } })
    },
    async getCurrentWindowInfo() { return getContext().nativeContext.getCurrentWindowInfo() },
    setIgnoreHotkeysOnFullscreen(value) { getContext().nativeContext.setIgnoreHotkeysOnFullscreen(value) },
    async setFloatingBallEnabled(value) { await getContext().auxiliarySurfaces.setFloatingBallEnabled(value) },
    async setFloatingBallLetter(value) { await getContext().auxiliarySurfaces.setFloatingBallLetter(value) },
    updateSuperPanelConfig(value) { getContext().auxiliarySurfaces.updateSuperPanelConfig(value) },
    async updateClipboardConfig(value) { await getContext().nativeContext.updateClipboardConfig(value) },
    updateWakeupBlacklist(value) { getContext().nativeContext.updateWakeupBlacklist(value) },
    updateSuperPanelBlockedApps(value) { getContext().nativeContext.updateSuperPanelBlockedApps(value); getContext().auxiliarySurfaces.updateSuperPanelBlockedApps(value) },
    async prepareShortcut(value) {
      if (value.autoCopy) {
        const foreground = getContext().nativeContext.clipboardManager.getCurrentWindow()
        if (!foreground?.hwnd || !native.activateWindow(foreground.hwnd)) throw new Error('Cannot activate shortcut target window')
        if (!native.simulateKeyboardTap('c', 'ctrl')) throw new Error('Cannot copy foreground selection')
        await delay(180)
      }
      if (value.preScreenshotOptimization) { ports.window.hide(); await delay(100) }
    },
  }
  const options: RuntimeOptions = {
    onContext(ctx) { context = ctx },
    settings: {
      dialogs: dialog, version: app.getVersion(),
      fileIcon: async path => (await app.getFileIcon(path, { size: 'normal' })).toDataURL(),
      openPath: path => shell.openPath(path), registerStartup: callback => startup.push(callback),
    },
    nativeContext: {
      native, clipboard, nativeImage,
      clipboardPath: join(app.getPath('userData'), 'clipboard'),
      settingsDocumentsPath: join(app.getPath('userData'), 'settings', 'documents.json'),
      imageRoot: app.getAppPath(),
      onClipboardChange: item => ports.emit({ type: 'source-event', name: 'clipboard-changed', payload: item }),
      onError: error => console.error('Native context:', error),
    },
    auxiliarySurfaces: {
      BrowserWindow, screen, ipcMain, Menu, native, platform: process.platform, mainWindow: ports.window,
      sendMainEvent: (name, payload) => ports.emit({ type: 'source-event', name, payload }),
      floatingBallHtml: join(ports.resourcesDirectory, 'source-floating-ball.html'),
      preloadPath: join(ports.preloadDirectory, 'auxiliary.cjs'),
      windowManager: {
        getMainWindow: () => ports.window, showWindow: ports.show,
        hideWindow: restore => { ports.window.hide(); const previous = previousWindow ?? getContext().nativeContext.clipboardManager.getCurrentWindow(); if (restore && previous?.hwnd) native.activateWindow(previous.hwnd) },
        setPreviousActiveWindow: info => { previousWindow = { ...info } },
      },
      pluginsAPI: { getDisabledPluginSet: () => new Set(Object.entries(getContext().storage.read().enabled).filter(([, enabled]) => !enabled).map(([id]) => id)) },
      loadPanelWindow: panel => panel.loadFile(join(ports.rendererFile, '../../../plugins/auxiliary-surfaces/renderer/super-panel.html')),
      applyWindowMaterial: (window, value) => window.setBackgroundMaterial(value),
      getDefaultWindowMaterial: () => material,
    },
  }
  return { settingsNative, options, getWindowMaterial: () => material, native,
    getContext,
    async start() { for (const callback of startup) await callback() },
  }
}
