import type { Context } from '@deepseek-ai/cordis'
import { app, BrowserWindow, WebContentsView, ipcMain } from 'electron'
import type { Input, KeyboardInputEvent } from 'electron'
import type { DesktopEvent, CommandResult } from '../../shared/contracts'
import type { PluginViewOptions, PluginViewHandle } from './contracts'

const channel = 'nexttools:plugin-sandbox'

// 原生适配只持有窗口资源，业务会话和撤销由调用方 Cordis 作用域管理。
export function createPluginViewAdapter(window: BrowserWindow, preload: string, emit: (event: DesktopEvent) => void, dispatch: (accelerator: string) => Promise<CommandResult | null>, restoreHost: () => void) {
  return async (ctx: Context, options: PluginViewOptions): Promise<PluginViewHandle> => {
    const url = `data:text/html;charset=utf-8,${encodeURIComponent(options.html)}`
    const partition = `nexttools-plugin-${options.session}`
    let view!: WebContentsView
    let visible = false
    let pending = 0
    let disposed = false
    let owner = window
    let detached: BrowserWindow | undefined
    let closing = false
    // 原生关闭与崩溃均撤销同一授权会话，并通知原版启动器返回搜索。
    const closed = () => {
      if (disposed || closing) return
      closing = true
      emit({ type: 'plugin-back', session: options.session })
      options.closed()
    }
    const resizeDetached = () => {
      if (!detached || detached.isDestroyed() || disposed) return
      const [width, height] = detached.getContentSize()
      view.setBounds({ x: 0, y: 0, width, height })
    }
    // 独立非持久化 partition 不共享宿主 cookie、权限或 preload。
    const release = ctx.effect(() => {
      view = new WebContentsView({ webPreferences: { preload, partition, additionalArguments: [`--plugin-session=${options.session}`], sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true, allowRunningInsecureContent: false, webviewTag: false } })
      const contents = view.webContents
      const session = contents.session
      view.setVisible(false)
      view.setBounds({ x: 0, y: 0, width: 0, height: 0 })
      window.contentView.addChildView(view)
      // 隐藏窗口只收起 surface，唤出恢复同一 contents，不重建插件状态。
      const hide = () => { if (!detached) view.setVisible(false) }
      const show = () => { if (!detached) view.setVisible(visible) }
      window.on('hide', hide)
      window.on('show', show)
      session.setPermissionRequestHandler((_sender, _permission, callback) => callback(false))
      session.setPermissionCheckHandler(() => false)
      // 包内静态资源已内联，阻止所有网络、文件及外部协议请求。
      session.webRequest.onBeforeRequest((details, callback) => callback({ cancel: details.url !== url && !details.url.startsWith('data:') }))
      contents.setWindowOpenHandler(() => ({ action: 'deny' }))
      const denyNavigation = (event: Electron.Event) => event.preventDefault()
      contents.on('will-navigate', denyNavigation)
      contents.on('will-frame-navigate', denyNavigation)
      contents.on('will-attach-webview', denyNavigation)
      const destroyed = closed
      contents.on('destroyed', destroyed)
      contents.on('render-process-gone', destroyed)
      // IPC 同时校验独立 contents、主 frame、文档 URL，绝不接受宿主或子 frame。
      const invoke = async (event: Electron.IpcMainInvokeEvent, method: unknown, args: unknown, ...extra: unknown[]) => {
        if (event.sender !== contents) throw new Error('Unauthorized plugin sandbox sender')
        if (disposed || extra.length || event.senderFrame !== contents.mainFrame || event.senderFrame?.url !== url) throw new Error('Unauthorized plugin sandbox sender')
        if (method !== 'runtimeSummary' && method !== 'invokeCapability') throw new Error('Unsupported plugin sandbox method')
        if (pending >= 64) throw new Error('Too many pending runtime requests')
        pending++
        try { return await options.invoke(method, args) } finally { pending-- }
      }
      // 每个 contents 使用单独频道，避免多个会话争用全局 handler。
      const sessionChannel = `${channel}:${options.session}`
      ipcMain.handle(sessionChannel, invoke)
      const input = (event: Electron.Event, key: Input) => {
        if (disposed || closing || (!detached && !visible) || !owner.isVisible() || key.type !== 'keyDown' || key.isAutoRepeat || key.isComposing) return
        if (key.key === 'Escape') { event.preventDefault(); emit({ type: 'plugin-back', session: options.session }); return }
        if (!key.control && !key.alt && !key.meta && !/^F(?:[1-9]|1[0-9]|2[0-4])$/i.test(key.key)) return
        const aliases: Record<string, string> = { ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right', ' ': 'Space' }
        const name = aliases[key.key] ?? key.key.toUpperCase()
        if (['CONTROL', 'SHIFT', 'ALT', 'META'].includes(name)) return
        const accelerator = [key.control ? 'Control' : null, key.alt ? 'Alt' : null, key.shift ? 'Shift' : null, key.meta ? 'Meta' : null, name].filter(Boolean).join('+')
        void dispatch(accelerator).then(result => { if (!disposed && result) emit({ type: 'command-result', result }) }).catch(error => console.error('Plugin application shortcut failed', error))
      }
      contents.on('before-input-event', input)
      return () => {
        // 仅可见的嵌入会话交回宿主焦点；隐藏窗口和独立窗口释放不得主动唤醒启动器。
        const returnToHost = !detached && !window.isDestroyed() && window.isVisible() && visible
        disposed = true
        window.removeListener('hide', hide)
        window.removeListener('show', show)
        ipcMain.removeHandler(sessionChannel)
        contents.removeListener('before-input-event', input)
        contents.removeListener('destroyed', destroyed)
        contents.removeListener('render-process-gone', destroyed)
        session.webRequest.onBeforeRequest(null)
        session.setPermissionRequestHandler(null)
        session.setPermissionCheckHandler(null)
        if (!owner.isDestroyed()) owner.contentView.removeChildView(view)
        if (detached && !detached.isDestroyed()) {
          detached.removeListener('resize', resizeDetached)
          detached.destroy()
        }
        if (!contents.isDestroyed()) contents.close()
        if (returnToHost) restoreHost()
      }
    }, `plugin sandbox ${options.session}`)
    try { await view.webContents.loadURL(url) } catch (error) { await release(); throw error }
    if (disposed) throw new Error('Plugin sandbox closed during load')
    return {
      bounds(value) {
        if (disposed) throw new Error('Plugin sandbox is closed')
        if (detached) return
        const [width, height] = window.getContentSize()
        const x = Math.min(width, Math.max(0, Math.round(value.x)))
        const y = Math.min(height, Math.max(0, Math.round(value.y)))
        view.setBounds({ x, y, width: Math.min(width - x, Math.max(0, Math.round(value.width))), height: Math.min(height - y, Math.max(0, Math.round(value.height))) })
      },
      visible(value) {
        if (disposed) throw new Error('Plugin sandbox is closed')
        if (detached) return
        visible = value
        view.setVisible(value)
        if (value && window.isVisible()) view.webContents.focus()
      },
      memoryInfo() {
        if (disposed || closing || view.webContents.isDestroyed()) return null
        const processId = view.webContents.getOSProcessId()
        const memory = app.getAppMetrics().find(metric => metric.pid === processId)?.memory
        if (!memory || !Number.isFinite(memory.privateBytes) || !Number.isFinite(memory.workingSetSize)) return null
        // 与原版详情页一致：Electron 进程指标 KB 转 MB，缺失指标不伪造零值。
        return { private: Math.round(memory.privateBytes! / 1024), shared: Math.round((memory.workingSetSize - memory.privateBytes!) / 1024), total: Math.round(memory.workingSetSize / 1024) }
      },
      focus() {
        if (disposed || closing || view.webContents.isDestroyed()) throw new Error('Plugin sandbox is closed')
        if (owner.isDestroyed()) throw new Error('Plugin window is closed')
        owner.show()
        owner.focus()
        view.webContents.focus()
      },
      sendInputEvent(event: KeyboardInputEvent) {
        if (disposed || closing || view.webContents.isDestroyed()) throw new Error('Plugin sandbox is closed')
        view.webContents.sendInputEvent(event)
      },
      openDevTools() {
        if (disposed || closing || view.webContents.isDestroyed()) throw new Error('Plugin sandbox is closed')
        view.webContents.openDevTools({ mode: 'detach' })
      },
      detach() {
        if (disposed || closing || view.webContents.isDestroyed()) throw new Error('Plugin sandbox is closed')
        if (detached) { detached.show(); detached.focus(); view.webContents.focus(); return }
        // 移动已隔离的 contents，不加载新文档、不更换 partition 或授权 token。
        const bounds = view.getBounds()
        const target = new BrowserWindow({ show: false, width: Math.max(480, bounds.width), height: Math.max(320, bounds.height), autoHideMenuBar: true, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true, allowRunningInsecureContent: false, webviewTag: false } })
        try {
          owner.contentView.removeChildView(view)
          target.contentView.addChildView(view)
        } catch (error) {
          if (!window.isDestroyed()) window.contentView.addChildView(view)
          target.destroy()
          throw error
        }
        owner = target
        detached = target
        ctx.effect(() => {
          const close = (event: Electron.Event) => { if (!disposed) { event.preventDefault(); closed() } }
          target.on('resize', resizeDetached)
          target.on('close', close)
          return () => { target.removeListener('resize', resizeDetached); target.removeListener('close', close) }
        }, 'detached plugin window listeners')
        resizeDetached()
        view.setVisible(true)
        target.show()
        target.focus()
        view.webContents.focus()
      },
    }
  }
}
