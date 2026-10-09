import { app, BrowserWindow, WebContentsView, Menu, Tray, nativeImage, globalShortcut, ipcMain, nativeTheme, shell, dialog } from 'electron'
import type { IpcMainInvokeEvent } from 'electron'
import { realpathSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { channels, type DesktopEvent, type Settings } from '../shared/contracts'
import { argumentsCount, boolean, identifier, settingsPatch } from '../shared/validation'
import { createRuntime, type Runtime } from './runtime'
import type { DesktopService } from './services/contracts'
import { createUpdater, type OnlineUpdater } from './updater'

function trayImage() {
  const pixels = Buffer.alloc(24 * 24 * 4)
  for (let y = 2; y < 22; y++) for (let x = 2; x < 22; x++) {
    const on = (x < 7 || x > 16 || Math.abs(x - y) < 3)
    if (!on) continue
    const offset = (y * 24 + x) * 4
    pixels[offset] = 52; pixels[offset + 1] = 190; pixels[offset + 2] = 130; pixels[offset + 3] = 255
  }
  return nativeImage.createFromBitmap(pixels, { width: 24, height: 24, scaleFactor: 1 })
}

async function start() {
  app.setName('NextLeek')
  app.setAppUserModelId('com.nextleek.desktop')
  const profileDirectory = process.argv.find(argument => argument.startsWith('--profile-dir='))?.slice('--profile-dir='.length)
  if (profileDirectory) app.setPath('userData', profileDirectory)
  if (!app.requestSingleInstanceLock()) { app.quit(); return }
  await app.whenReady()
  const here = fileURLToPath(new URL('.', import.meta.url))
  const rendererFile = join(here, '../renderer/index.html')
  const devURL = !app.isPackaged ? process.env.ELECTRON_RENDERER_URL : undefined
  const rendererURL = devURL ?? pathToFileURL(rendererFile).href
  const window = new BrowserWindow({
    width: 980, height: 82, minWidth: 680, minHeight: 64, show: false,
    title: 'NextLeek', frame: false, backgroundColor: '#f4f6fa', autoHideMenuBar: true,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true },
  })
  const view = new WebContentsView({ webPreferences: {
    preload: join(here, '../preload/index.cjs'), sandbox: true, contextIsolation: true,
    nodeIntegration: false, webSecurity: true, allowRunningInsecureContent: false,
  } })
  window.contentView.addChildView(view)
  const resize = () => { const [width, height] = window.getContentSize(); view.setBounds({ x: 0, y: 0, width, height }) }
  resize()
  let runtime: Runtime | undefined
  let quitting = false
  let cleanup: Promise<void> | undefined
  let currentHotkey: string | undefined
  let hotkeyCapture = false
  const setLauncherExpanded = (expanded: boolean) => {
    if (window.isDestroyed()) return
    const [width] = window.getSize()
    window.setSize(width, expanded ? 690 : 82)
  }
  const emit = (event: DesktopEvent) => { if (!view.webContents.isDestroyed()) view.webContents.send(channels.event, event) }
  const show = () => {
    if (window.isDestroyed()) return
    if (window.isMinimized()) window.restore()
    window.show(); window.focus(); view.webContents.focus(); emit({ type: 'shown' })
  }
  const toggle = () => {
    if (hotkeyCapture) return
    if (window.isVisible() && window.isFocused() && !window.isMinimized()) window.hide()
    else show()
  }
  const setHotkeyCapture = (active: boolean) => {
    if (active === hotkeyCapture) return
    hotkeyCapture = active
    if (!currentHotkey) return
    if (active) globalShortcut.unregister(currentHotkey)
    else if (!globalShortcut.isRegistered(currentHotkey) && !globalShortcut.register(currentHotkey, toggle)) {
      console.error(`Unable to restore global shortcut: ${currentHotkey}`)
    }
  }
  const desktop: DesktopService = {
    emit,
    hide: () => window.hide(),
    quit: () => app.quit(),
    async openDataDirectory() {
      const error = await shell.openPath(app.getPath('userData'))
      if (error) throw new Error(error)
    },
    async applySettings(next: Settings, previous?: Settings) {
      if (next.autostart && !app.isPackaged) throw new Error('Autostart is available in packaged builds only')
      if (currentHotkey !== next.hotkey) {
        let registered = false
        try { registered = globalShortcut.register(next.hotkey, toggle) }
        catch { throw new Error(`Invalid global shortcut: ${next.hotkey}`) }
        if (!registered) throw new Error(`Global shortcut is already in use: ${next.hotkey}`)
        if (currentHotkey) globalShortcut.unregister(currentHotkey)
        currentHotkey = next.hotkey
      }
      try {
        if (app.isPackaged && (!previous || previous.autostart !== next.autostart)) {
          app.setLoginItemSettings({ openAtLogin: next.autostart, path: process.execPath })
          if (app.getLoginItemSettings().openAtLogin !== next.autostart) throw new Error('Operating system did not apply autostart preference')
        }
        nativeTheme.themeSource = next.theme
      } catch (error) {
        if (previous && currentHotkey !== previous.hotkey) {
          globalShortcut.unregister(currentHotkey!)
          if (globalShortcut.register(previous.hotkey, toggle)) currentHotkey = previous.hotkey
          else currentHotkey = undefined
        }
        throw error
      }
    },
  }
  try {
    runtime = await createRuntime(join(app.getPath('userData'), 'lmdb'), desktop)
    const ctx = runtime.ctx
    ctx.effect(() => {
      window.on('resize', resize)
      const close = (event: Electron.Event) => { if (!quitting) { event.preventDefault(); window.hide() } }
      const quit = (event: Electron.Event) => {
        if (quitting) return
        event.preventDefault()
        if (cleanup) return
        cleanup = runtime!.dispose().catch(error => { console.error('Runtime cleanup failed', error) }).finally(() => { quitting = true; app.quit() })
      }
      const activate = () => show()
      const denyPopup = () => ({ action: 'deny' as const })
      const denyNavigation = (event: Electron.Event) => event.preventDefault()
      const denyWebview = (event: Electron.Event) => event.preventDefault()
      const systemMenu = (event: Electron.Event) => event.preventDefault()
      const blur = () => setHotkeyCapture(false)
      window.on('system-context-menu', systemMenu)
      window.on('blur', blur)
      window.on('close', close)
      app.on('before-quit', quit)
      app.on('second-instance', activate)
      app.on('activate', activate)
      view.webContents.setWindowOpenHandler(denyPopup)
      view.webContents.on('will-navigate', denyNavigation)
      view.webContents.on('will-attach-webview', denyWebview)
      const session = view.webContents.session
      session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
      session.setPermissionCheckHandler(() => false)
      const headers: Electron.WebRequestFilter = { urls: [devURL ? `${new URL(devURL).origin}/*` : 'file://*/*'] }
      session.webRequest.onHeadersReceived(headers, (details, callback) => {
        callback({ responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': [devURL
          ? "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' ws:; object-src 'none'; frame-src 'none'; base-uri 'none'"
          : "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'none'; object-src 'none'; frame-src 'none'; base-uri 'none'"] } })
      })
      return () => {
        window.removeListener('resize', resize); window.removeListener('close', close)
        window.removeListener('system-context-menu', systemMenu)
        window.removeListener('blur', blur)
        app.removeListener('before-quit', quit); app.removeListener('second-instance', activate); app.removeListener('activate', activate)
        session.webRequest.onHeadersReceived(null)
        session.setPermissionRequestHandler(null); session.setPermissionCheckHandler(null)
        globalShortcut.unregisterAll()
        if (!view.webContents.isDestroyed()) view.webContents.close()
        if (!window.isDestroyed()) window.destroy()
      }
    }, 'Electron lifecycle and security')
    ctx.effect(() => {
      const tray = new Tray(trayImage())
      tray.setToolTip('NextLeek — Alt+Z')
      tray.setContextMenu(Menu.buildFromTemplate([
        { label: '显示 NextLeek', click: show },
        { label: '设置', click: () => { show(); emit({ type: 'navigate', page: 'settings' }) } },
        { type: 'separator' }, { label: '退出', click: () => app.quit() },
      ]))
      tray.on('click', toggle)
      return () => tray.destroy()
    }, 'system tray')
    const updater = await createUpdater(ctx, {
      app,
      emit,
      async prepareInstall() {
        quitting = true
        cleanup ??= runtime!.dispose()
        await cleanup
      },
    })
    installIPC(runtime, view, rendererURL, setHotkeyCapture, setLauncherExpanded, updater)
    await (devURL ? view.webContents.loadURL(devURL) : view.webContents.loadFile(rendererFile))
    show()
  } catch (error) {
    if (runtime) await runtime.dispose()
    globalShortcut.unregisterAll()
    if (!view.webContents.isDestroyed()) view.webContents.close()
    if (!window.isDestroyed()) window.destroy()
    throw error
  }
}

function installIPC(runtime: Runtime, view: WebContentsView, rendererURL: string, setHotkeyCapture: (active: boolean) => void, setLauncherExpanded: (expanded: boolean) => void, updater: OnlineUpdater) {
  const verify = (event: IpcMainInvokeEvent) => {
    const frame = event.senderFrame
    if (event.sender !== view.webContents || !frame || frame !== view.webContents.mainFrame) throw new Error('Unauthorized IPC sender')
    const actual = new URL(frame.url)
    const expected = new URL(rendererURL)
    actual.hash = ''; expected.hash = ''
    if (actual.protocol === 'file:' && expected.protocol === 'file:') {
      if (realpathSync(fileURLToPath(actual)) !== realpathSync(fileURLToPath(expected))) throw new Error('Unauthorized renderer URL')
      return
    }
    if (actual.href !== expected.href) throw new Error('Unauthorized renderer URL')
  }
  const bind = (channel: string, count: number, handler: (...args: unknown[]) => unknown) => {
    runtime.ctx.effect(() => {
      ipcMain.handle(channel, (event, ...args: unknown[]) => { verify(event); argumentsCount(args, count); return handler(...args) })
      return () => ipcMain.removeHandler(channel)
    }, `IPC ${channel}`)
  }
  bind(channels.snapshot, 0, () => runtime.getSnapshot())
  bind(channels.commands, 0, () => runtime.listCommands())
  bind(channels.settings, 1, patch => runtime.updateSettings(settingsPatch(patch)))
  bind(channels.run, 1, id => runtime.runCommand(identifier(id)))
  bind(channels.pin, 2, (id, pinned) => runtime.setPinned(identifier(id), boolean(pinned)))
  bind(channels.plugin, 2, (id, enabled) => runtime.setPluginEnabled(identifier(id), boolean(enabled)))
  bind(channels.hide, 0, () => runtime.ctx.get('desktop')!.hide())
  bind(channels.quit, 0, () => runtime.ctx.get('desktop')!.quit())
  bind(channels.hotkeyCapture, 1, active => setHotkeyCapture(boolean(active)))
  bind(channels.layout, 1, expanded => setLauncherExpanded(boolean(expanded)))
  bind(channels.updateState, 0, () => updater.getState())
  bind(channels.updateCheck, 0, () => updater.check())
  bind(channels.updateDownload, 0, () => updater.download())
  bind(channels.updateInstall, 0, () => updater.install())
}

start().catch(error => {
  console.error(error)
  dialog.showErrorBox('NextLeek 无法启动', error instanceof Error ? error.message : String(error))
  app.exit(1)
})
