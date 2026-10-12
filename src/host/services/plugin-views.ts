import type { Context } from '@deepseek-ai/cordis'
import { WebContentsView, ipcMain } from 'electron'
import type { BrowserWindow, Input } from 'electron'
import type { DesktopEvent, CommandResult } from '../../shared/contracts'
import type { PluginViewOptions, PluginViewHandle } from './contracts'

const channel = 'nexttools:plugin-sandbox'

// 原生适配只持有窗口资源，业务会话和撤销由调用方 Cordis 作用域管理。
export function createPluginViewAdapter(window: BrowserWindow, preload: string, emit: (event: DesktopEvent) => void, dispatch: (accelerator: string) => Promise<CommandResult | null>) {
  return async (ctx: Context, options: PluginViewOptions): Promise<PluginViewHandle> => {
    const url = `data:text/html;charset=utf-8,${encodeURIComponent(options.html)}`
    const partition = `nexttools-plugin-${options.session}`
    let view!: WebContentsView
    let visible = false
    let pending = 0
    let disposed = false
    // 独立非持久化 partition 不共享宿主 cookie、权限或 preload。
    const release = ctx.effect(() => {
      view = new WebContentsView({ webPreferences: { preload, partition, additionalArguments: [`--plugin-session=${options.session}`], sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true, allowRunningInsecureContent: false, webviewTag: false } })
      const contents = view.webContents
      const session = contents.session
      view.setVisible(false)
      view.setBounds({ x: 0, y: 0, width: 0, height: 0 })
      window.contentView.addChildView(view)
      // 隐藏窗口只收起 surface，唤出恢复同一 contents，不重建插件状态。
      const hide = () => view.setVisible(false)
      const show = () => view.setVisible(visible)
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
      const destroyed = () => { if (!disposed) options.closed() }
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
        if (disposed || !visible || !window.isVisible() || key.type !== 'keyDown' || key.isAutoRepeat || key.isComposing) return
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
        if (!window.isDestroyed()) window.contentView.removeChildView(view)
        if (!contents.isDestroyed()) contents.close()
      }
    }, `plugin sandbox ${options.session}`)
    try { await view.webContents.loadURL(url) } catch (error) { await release(); throw error }
    if (disposed) throw new Error('Plugin sandbox closed during load')
    return {
      bounds(value) {
        if (disposed) throw new Error('Plugin sandbox is closed')
        const [width, height] = window.getContentSize()
        const x = Math.min(width, Math.max(0, Math.round(value.x)))
        const y = Math.min(height, Math.max(0, Math.round(value.y)))
        view.setBounds({ x, y, width: Math.min(width - x, Math.max(0, Math.round(value.width))), height: Math.min(height - y, Math.max(0, Math.round(value.height))) })
      },
      visible(value) {
        if (disposed) throw new Error('Plugin sandbox is closed')
        visible = value
        view.setVisible(value)
        if (value && window.isVisible()) view.webContents.focus()
      },
    }
  }
}
