import { randomBytes } from 'node:crypto'
import { app, BrowserWindow, WebContentsView, Menu, Tray, nativeImage, globalShortcut, ipcMain, nativeTheme, shell, dialog, clipboard, screen } from 'electron'
import type { IpcMainInvokeEvent } from 'electron'
import { execFile } from 'node:child_process'
import { readFileSync, realpathSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { channels, type DesktopEvent, type Settings } from '../shared/contracts'
import type { CommandResult } from '../shared/contracts'
import { argumentsCount, boolean, identifier, settingsPatch, launcherSearchRequest, searchItemId } from '../shared/validation'
import { createRuntime, type Runtime } from './runtime'
import type { DesktopService } from './services/contracts'
import { updaterPlugin, type OnlineUpdater } from '../../plugins/updater/host'
import { getApplicationIcon } from './services/application-icons'
import { createPluginViewAdapter } from './services/plugin-views'
import { createSourceNative } from './services/source-native'
import { createSourceEnvironment } from './services/source-environment'


function trayImage(directory: string) {
  const image = nativeImage.createFromPath(join(directory, process.platform === 'darwin' ? 'trayTemplate.png' : 'tray-16.png'))
  if (process.platform === 'darwin') image.setTemplateImage(true)
  else {
    image.addRepresentation({ scaleFactor: 1.5, buffer: readFileSync(join(directory, 'tray-24.png')) })
    image.addRepresentation({ scaleFactor: 2, buffer: readFileSync(join(directory, 'tray-32.png')) })
  }
  return image
}

async function start() {
  app.setName('NextTools')
  app.setAppUserModelId('com.nextleek.desktop')
  app.setPath('userData', join(app.getPath('appData'), 'NextLeek'))
  const profileDirectory = process.argv.find(argument => argument.startsWith('--profile-dir='))?.slice('--profile-dir='.length)
  if (profileDirectory) app.setPath('userData', profileDirectory)
  if (!app.requestSingleInstanceLock()) { app.quit(); return }
  await app.whenReady()
  const here = fileURLToPath(new URL('.', import.meta.url))
  const rendererFile = join(here, '../renderer/src/client/index.html')
  const devURL = !app.isPackaged && process.env.ELECTRON_RENDERER_URL ? new URL('/src/client/index.html', process.env.ELECTRON_RENDERER_URL).href : undefined
  const rendererURL = devURL ?? pathToFileURL(rendererFile).href
  const frameNonce = randomBytes(18).toString('base64url')
  const iconDirectory = app.isPackaged ? join(process.resourcesPath, 'icons') : fileURLToPath(new URL('../../resources/icons/', import.meta.url))
  // 搜索窗口宽度固定且不超出当前屏幕可用区；高度仍由结果布局调整。
  const launcherWidth = Math.min(980, screen.getPrimaryDisplay().workArea.width)
  const window = new BrowserWindow({
    width: launcherWidth, height: 82, minWidth: launcherWidth, maxWidth: launcherWidth, minHeight: 64, resizable: false, maximizable: false, show: false, skipTaskbar: true, alwaysOnTop: true,
    title: 'NextTools', frame: false, backgroundColor: nativeTheme.shouldUseDarkColors ? '#303133' : '#f4f4f4', autoHideMenuBar: true,
    icon: join(iconDirectory, process.platform === 'win32' ? 'icon.ico' : 'icon-256.png'),
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true },
  })
  const view = new WebContentsView({ webPreferences: {
    preload: join(here, '../preload/index.cjs'), sandbox: true, contextIsolation: true,
    nodeIntegration: false, webSecurity: true, allowRunningInsecureContent: false,
  } })
  // 原生材质由宿主窗口绘制，嵌入页面不能再盖一层默认白底。
  view.setBackgroundColor('#00000000')
  window.contentView.addChildView(view)
  const resize = () => { const [width, height] = window.getContentSize(); view.setBounds({ x: 0, y: 0, width, height }) }
  resize()
  let runtime: Runtime | undefined
  let quitting = false
  let cleanup: Promise<void> | undefined
  let currentHotkey: string | undefined
  let hotkeyCapture = false
  let captureAltSpace = false
  let materialActive = false
  const commandShortcuts = new Map<string, { commandId: string; callback: () => void }>()
  let layoutBounds = window.getBounds()
  let launcherCenterY = layoutBounds.y + layoutBounds.height / 2
  let dragTimer: NodeJS.Timeout | undefined
  let releaseDragTimer: (() => void) | undefined
  let defaultHeight = 690
  let tray: Tray | undefined
  let sizeLocked = false
  let pendingHeight: number | undefined
  const endWindowDrag = () => {
    if (dragTimer === undefined) return
    releaseDragTimer?.()
    releaseDragTimer = undefined
    dragTimer = undefined
  }
  const startWindowDrag = () => {
    if (dragTimer !== undefined || window.isDestroyed() || !window.isVisible() || !window.isFocused()) return
    // Electron cursor and window positions use DIP; do not mix in renderer pixels or display scale factors.
    const cursor = screen.getCursorScreenPoint()
    const [startX, startY] = window.getPosition()
    let lastX = cursor.x
    let lastY = cursor.y
    releaseDragTimer = runtime!.ctx.effect(() => {
      dragTimer = setInterval(() => {
      if (window.isDestroyed() || view.webContents.isDestroyed() || !window.isVisible() || !window.isFocused()) {
        endWindowDrag()
        return
      }
      const next = screen.getCursorScreenPoint()
      if (next.x === lastX && next.y === lastY) return
      window.setPosition(startX + next.x - cursor.x, startY + next.y - cursor.y, false)
      lastX = next.x
      lastY = next.y
    }, 16)
      return () => { clearInterval(dragTimer); dragTimer = undefined }
    }, 'Window input drag timer')
  }
  const setLauncherHeight = (height: number) => {
    if (!Number.isFinite(height) || height < 0) throw new TypeError('Invalid launcher height')
    pendingHeight = height
    if (sizeLocked) return
    if (window.isDestroyed()) return
    const bounds = window.getBounds()
    const workArea = screen.getDisplayMatching(bounds).workArea
    if (bounds.y !== layoutBounds.y) launcherCenterY = bounds.y + bounds.height / 2
    const margin = Math.min(24, Math.max(0, (workArea.height - 64) / 2))
    const nextHeight = Math.min(defaultHeight, workArea.height - margin * 2, Math.max(64, Math.ceil(height)))
    const y = Math.round(Math.max(workArea.y + margin, Math.min(launcherCenterY - nextHeight / 2, workArea.y + workArea.height - margin - nextHeight)))
    if (bounds.height === nextHeight && bounds.y === y) return
    window.setBounds({ ...bounds, height: nextHeight, y })
    layoutBounds = window.getBounds()
  }
  const emit = (event: DesktopEvent) => {
    // Electron 的颜色 getter 不保留透明度，使用原生材质成功广播记录状态。
    if (event.type === 'source-event' && event.name === 'update-window-material') materialActive = event.payload !== 'none'
    if (!view.webContents.isDestroyed()) view.webContents.send(channels.event, event)
  }
  const show = () => {
    if (window.isDestroyed()) return
    if (window.isMinimized()) window.restore()
    window.show(); window.focus(); view.webContents.focus(); emit({ type: 'shown' })
  }
  const toggle = () => {
    if (hotkeyCapture || (runtime && (runtime.ctx.nativeContext.shouldIgnoreHotkeys() || runtime.ctx.nativeContext.isWakeupBlocked()))) return
    if (window.isVisible() && window.isFocused() && !window.isMinimized()) window.hide()
    else show()
  }
  const setHotkeyCapture = (active: boolean) => {
    if (active === hotkeyCapture) return
    hotkeyCapture = active
    if (active) {
      if (currentHotkey) globalShortcut.unregister(currentHotkey)
      for (const accelerator of commandShortcuts.keys()) globalShortcut.unregister(accelerator)
      if (process.platform === 'win32') {
        captureAltSpace = globalShortcut.register('Alt+Space', () => {
          if (hotkeyCapture && window.isFocused()) emit({ type: 'hotkey', value: 'Alt+Space' })
        })
        if (!captureAltSpace) {
          setHotkeyCapture(false)
          throw new Error('无法录制 Alt+Space：该快捷键已被其他程序占用')
        }
      }
    } else {
      if (captureAltSpace) { globalShortcut.unregister('Alt+Space'); captureAltSpace = false }
      if (currentHotkey && !globalShortcut.isRegistered(currentHotkey) && !globalShortcut.register(currentHotkey, toggle)) {
        console.error(`Unable to restore global shortcut: ${currentHotkey}`)
      }
      for (const [accelerator, binding] of commandShortcuts) {
        if (!globalShortcut.register(accelerator, binding.callback)) throw new Error(`无法恢复插件快捷键：${accelerator}`)
      }
    }
  }
  const setTrayVisible = (visible: boolean) => {
    if (!visible) { tray?.destroy(); tray = undefined; return }
    if (tray) return
    tray = new Tray(trayImage(iconDirectory))
    tray.setToolTip('NextTools — Alt+Z')
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: '显示 NextTools', click: show },
      { label: '设置', click: () => { show(); emit({ type: 'navigate', page: 'settings' }) } },
      { type: 'separator' }, { label: '退出', click: () => app.quit() },
    ]))
    const currentTray = tray
    runtime!.ctx.effect(() => {
      currentTray.on('click', toggle)
      return () => { if (!currentTray.isDestroyed()) currentTray.removeListener('click', toggle) }
    }, 'tray click listener')
  }
  const sourceEnvironment = createSourceEnvironment({
    window, rendererSession: view.webContents.session, rendererFile,
    preloadDirectory: join(here, '../preload'),
    resourcesDirectory: app.isPackaged ? process.resourcesPath : join(here, '../../resources'),
    emit, show, toggle, setTrayVisible,
    setDefaultHeight(height) { defaultHeight = height; setLauncherHeight(window.getBounds().height) },
  })
  const desktop: DesktopService = {
    emit,
    settingsNative: sourceEnvironment.settingsNative,
    async revealMarketPath(path) { shell.showItemInFolder(path) },
    async chooseMarketExportPath(suggestedName) {
      const selection = await dialog.showSaveDialog(window, { title: '导出插件', defaultPath: join(app.getPath('downloads'), suggestedName), filters: [{ name: 'NextTools 插件备份', extensions: ['zip'] }] })
      return selection.canceled ? null : selection.filePath ?? null
    },
    openPluginView: createPluginViewAdapter(window, join(here, '../preload/plugin-sandbox.cjs'), emit, async accelerator => {
      if (!runtime || hotkeyCapture) return null
      return await runtime.invokePlugin('command-shortcuts', 'dispatch', { accelerator }) as CommandResult | null
    }, () => { if (!quitting) show() }),
    hide: () => window.hide(),
    quit: () => app.quit(),
    // 系统桥仅注册原生组合键，指令配置和生命周期由内置插件管理。
    registerCommandShortcut(accelerator, commandId) {
      const nativeAccelerator = accelerator.replace(/Meta/g, 'Super')
      if (nativeAccelerator === currentHotkey || commandShortcuts.has(nativeAccelerator)) throw new Error(`快捷键已被使用：${accelerator}`)
      const callback = () => {
        if (hotkeyCapture || !runtime || runtime.ctx.nativeContext.shouldIgnoreHotkeys()) return
        void runtime.invokePlugin('command-shortcuts', 'beforeExecute', { commandId }).then(() => runtime!.runCommand(commandId)).then(result => {
          show()
          emit({ type: 'command-result', result })
        }).catch(error => console.error('Plugin shortcut failed', error))
      }
      if (!hotkeyCapture && !globalShortcut.register(nativeAccelerator, callback)) throw new Error(`系统快捷键不可用：${accelerator}`)
      const binding = { commandId, callback }
      commandShortcuts.set(nativeAccelerator, binding)
      return () => {
        if (commandShortcuts.get(nativeAccelerator) !== binding) return
        commandShortcuts.delete(nativeAccelerator)
        globalShortcut.unregister(nativeAccelerator)
      }
    },
    async openDataDirectory() {
      const error = await shell.openPath(app.getPath('userData'))
      if (error) throw new Error(error)
    },
    async applySettings(next: Settings, previous?: Settings) {
      if (next.autostart && !app.isPackaged) throw new Error('Autostart is available in packaged builds only')
      if (currentHotkey !== next.hotkey) {
        if (commandShortcuts.has(next.hotkey)) throw new Error(`快捷键已被插件指令使用：${next.hotkey}`)
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
        // 材质启用时保留原生透明底色，主题或快捷键更新不能覆盖它。
        if (!materialActive) {
          window.setBackgroundColor(nativeTheme.shouldUseDarkColors ? '#303133' : '#f4f4f4')
        }
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
    runtime = await createRuntime(join(app.getPath('userData'), 'lmdb'), desktop, {
      addonPath: app.isPackaged ? join(process.resourcesPath, 'everything', 'addon-x64.node') : join(app.getAppPath(), 'resources', 'everything', 'addon-x64.node'),
      executable: app.isPackaged ? join(process.resourcesPath, 'everything', 'Everything.exe') : join(app.getAppPath(), 'resources', 'everything', 'Everything.exe'),
      platform: process.platform,
      openPath: path => shell.openPath(path),
      async revealPath(path) {
        if (process.platform !== 'win32') { shell.showItemInFolder(path); return }
        const executable = join(process.env.SystemRoot ?? process.env.WINDIR!, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
        // Both transports are base64: no file path is parsed as shell syntax.
        const script = `$ErrorActionPreference = 'Stop'
try {
$path = [Text.Encoding]::Unicode.GetString([Convert]::FromBase64String('${Buffer.from(path, 'utf16le').toString('base64')}'))
$parent = [IO.Path]::GetDirectoryName($path)
$name = [IO.Path]::GetFileName($path)
$shell = New-Object -ComObject Shell.Application
$shell.Open($parent)
$deadline = [DateTime]::UtcNow.AddSeconds(10)
do {
  $windows = $shell.Windows()
  for ($i = 0; $i -lt $windows.Count; $i++) {
    $view = $windows.Item($i).Document
    if ($view.Folder.Self.Path -ne $parent) { continue }
    $item = $view.Folder.ParseName($name)
    if ($null -eq $item) { continue }
    $view.SelectItem($item, 29)
    $selected = $view.SelectedItems()
    for ($j = 0; $j -lt $selected.Count; $j++) {
      if ($selected.Item($j).Path -eq $path) { exit 0 }
    }
  }
  Start-Sleep -Milliseconds 100
} while ([DateTime]::UtcNow -lt $deadline)
throw 'Explorer did not select the requested file.'
} catch {
[Console]::Error.WriteLine($_.Exception.ToString())
exit 1
}`
        let settled = false
        let release: (() => unknown) | undefined
        try {
          await new Promise<void>((resolve, reject) => {
            release = runtime!.ctx.effect(() => {
              const child = execFile(executable, ['-NoProfile', '-NonInteractive', '-STA', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], {
                shell: false, windowsHide: true, encoding: 'utf8', timeout: 15000, maxBuffer: 64 * 1024,
              }, (error, _stdout, stderr) => {
                if (settled) return
                settled = true
                if (error) reject(new Error(`无法定位文件：${stderr.trim() || error.message}`))
                else resolve()
              })
              return () => {
                if (settled) return
                settled = true
                child.kill()
                reject(new Error('Everything 服务已关闭，文件定位已取消。'))
              }
            }, 'Everything native selection subprocess')
          })
        } finally { await release?.() }
      },
      copyPath: path => clipboard.writeText(path),
    }, {
      platform: process.platform,
      desktopDirectory: app.getPath('desktop'),
      preferredLanguages: app.getPreferredSystemLanguages(),
      getFileIcon: path => getApplicationIcon(path, {
        readShortcutLink: shortcut => shell.readShortcutLink(shortcut),
        getFileIcon: target => app.getFileIcon(target, { size: 'normal' }),
        nativeImage,
      }),
      openPath: path => shell.openPath(path),
      launchAsAdmin: async path => {
        if (process.platform !== 'win32') throw new Error('Administrator launch is only available on Windows')
        const encoded = Buffer.from(path, 'utf16le').toString('base64')
        const script = `$ErrorActionPreference='Stop'; $target=[Text.Encoding]::Unicode.GetString([Convert]::FromBase64String('${encoded}')); Start-Process -FilePath $target -Verb RunAs`
        await new Promise<void>((resolve, reject) => {
          execFile(join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'), ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { timeout: 60000, windowsHide: true }, error => error ? reject(error) : resolve())
        })
      },
    }, { version: app.getVersion(), ...sourceEnvironment.options })
    const ctx = runtime.ctx
    ctx.effect(() => {
      window.on('resize', resize)
      const close = (event: Electron.Event) => { if (!quitting) { event.preventDefault(); emit({ type: 'close-request' }) } }
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
      // 主启动器失焦只隐藏，保留渲染页面和查询供下次唤出。
      const blur = () => { endWindowDrag(); setHotkeyCapture(false); window.hide() }
      window.on('system-context-menu', systemMenu)
      window.on('blur', blur)
      window.on('hide', endWindowDrag)
      window.on('closed', endWindowDrag)
      view.webContents.on('destroyed', endWindowDrag)
      view.webContents.on('render-process-gone', endWindowDrag)
      window.on('close', close)
      app.on('before-quit', quit)
      app.on('second-instance', activate)
      app.on('activate', activate)
      view.webContents.setWindowOpenHandler(denyPopup)
      view.webContents.on('will-navigate', denyNavigation)
      view.webContents.on('will-frame-navigate', denyNavigation)
      view.webContents.on('will-attach-webview', denyWebview)
      const session = view.webContents.session
      session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
      session.setPermissionCheckHandler(() => false)
      const headers: Electron.WebRequestFilter = { urls: [devURL ? `${new URL(devURL).origin}/*` : 'file://*/*'] }
      session.webRequest.onHeadersReceived(headers, (details, callback) => {
        const policy = devURL
          ? `default-src 'self'; script-src 'self' 'nonce-${frameNonce}'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' ws:; object-src 'none'; frame-src 'self' data: about:; base-uri 'none'`
          : `default-src 'self'; script-src 'self' 'nonce-${frameNonce}'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'none'; object-src 'none'; frame-src 'self' data: about:; base-uri 'none'`
        callback({ responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': [policy] } })
      })
      return () => {
        endWindowDrag()
        window.removeListener('hide', endWindowDrag)
        window.removeListener('closed', endWindowDrag)
        view.webContents.removeListener('destroyed', endWindowDrag)
        view.webContents.removeListener('render-process-gone', endWindowDrag)
        window.removeListener('resize', resize); window.removeListener('close', close)
        window.removeListener('system-context-menu', systemMenu)
        window.removeListener('blur', blur)
        app.removeListener('before-quit', quit); app.removeListener('second-instance', activate); app.removeListener('activate', activate)
        view.webContents.removeListener('will-navigate', denyNavigation)
        view.webContents.removeListener('will-frame-navigate', denyNavigation)
        session.webRequest.onHeadersReceived(null)
        session.setPermissionRequestHandler(null); session.setPermissionCheckHandler(null)
        globalShortcut.unregisterAll()
        if (!view.webContents.isDestroyed()) view.webContents.close()
        if (!window.isDestroyed()) window.destroy()
      }
    }, 'Electron lifecycle and security')
    ctx.effect(() => {
      setTrayVisible(true)
      return () => setTrayVisible(false)
    }, 'system tray')
    const updaterFiber = ctx.plugin(updaterPlugin({
      app,
      emit,
      async prepareInstall() {
        quitting = true
        cleanup ??= runtime!.dispose()
        await cleanup
      },
    }))
    await updaterFiber.await()
    const updater = ctx.get('updater')!
    installIPC(runtime, view, rendererURL, frameNonce, setHotkeyCapture, setLauncherHeight, startWindowDrag, endWindowDrag, updater)
    ctx.effect(() => {
      const invoke = createSourceNative(ctx, window, emit, setLauncherHeight, sourceEnvironment, locked => {
        sizeLocked = locked
        if (!locked && pendingHeight !== undefined) setLauncherHeight(pendingHeight)
      })
      ipcMain.handle(channels.sourceNative, (event, method: unknown, args: unknown) => {
        const frame = event.senderFrame
        if (event.sender !== view.webContents || frame !== view.webContents.mainFrame || !frame || frame.url !== view.webContents.getURL()) throw new Error('Unauthorized native sender')
        if (typeof method !== 'string' || !Array.isArray(args)) throw new TypeError('Invalid native request')
        return invoke(method, args)
      })
      return () => ipcMain.removeHandler(channels.sourceNative)
    }, 'Original source native IPC')
    await (devURL ? view.webContents.loadURL(devURL) : view.webContents.loadFile(rendererFile))
    await sourceEnvironment.start()
    show()
  } catch (error) {
    endWindowDrag()
    if (runtime) await runtime.dispose()
    globalShortcut.unregisterAll()
    if (!view.webContents.isDestroyed()) view.webContents.close()
    if (!window.isDestroyed()) window.destroy()
    throw error
  }
}

function installIPC(runtime: Runtime, view: WebContentsView, rendererURL: string, frameNonce: string, setHotkeyCapture: (active: boolean) => void, setLauncherHeight: (height: number) => void, startWindowDrag: () => void, endWindowDrag: () => void, updater: OnlineUpdater) {
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
  bind(channels.invokePlugin, 3, (pluginId, method, args) => {
    if (typeof method !== 'string') throw new TypeError('Invalid plugin method')
    identifier(method.toLowerCase())
    return runtime.invokePlugin(identifier(pluginId), method, args)
  })
  bind(channels.hide, 0, () => runtime.ctx.get('desktop')!.hide())
  bind(channels.quit, 0, () => runtime.ctx.get('desktop')!.quit())
  bind(channels.hotkeyCapture, 1, active => setHotkeyCapture(boolean(active)))
  bind(channels.layout, 1, height => { if (typeof height !== 'number') throw new TypeError('Invalid launcher height'); setLauncherHeight(height) })
  bind(channels.startWindowDrag, 0, startWindowDrag)
  bind(channels.endWindowDrag, 0, endWindowDrag)
  bind(channels.searchLauncher, 1, request => runtime.searchLauncher(launcherSearchRequest(request)))
  bind(channels.searchAction, 3, (providerId, itemId, action) => runtime.performSearchAction(identifier(providerId), searchItemId(itemId), identifier(action)))
  bind(channels.frameNonce, 0, () => frameNonce)
  bind(channels.updateState, 0, () => updater.getState())
  bind(channels.updateCheck, 0, () => updater.check())
  bind(channels.updateDownload, 0, () => updater.download())
  bind(channels.updateInstall, 0, () => updater.install())
}

start().catch(error => {
  console.error(error)
  dialog.showErrorBox('NextTools 无法启动', error instanceof Error ? error.message : String(error))
  app.exit(1)
})
