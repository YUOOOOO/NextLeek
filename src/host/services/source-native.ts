import { app, clipboard, Menu, Notification, shell, type BrowserWindow, type MenuItemConstructorOptions } from 'electron'
import type { Context } from '@deepseek-ai/cordis'
import { stat } from 'node:fs/promises'
import type { DesktopEvent } from '../../shared/contracts'
import type { SourceEnvironment } from './source-environment'
import type { SourceResponse } from '../../../plugins/auxiliary-surfaces/host'

// 原版页面只调用白名单原生操作；业务数据与插件权限仍由所属 Cordis 服务处理。
export function createSourceNative(ctx: Context, window: BrowserWindow, emit: (event: DesktopEvent) => void, resize: (height: number) => void, environment: SourceEnvironment, setSizeLock: (locked: boolean) => void) {
  let lockedSize: { width: number; height: number } | undefined
  ctx.effect(() => () => {
    if (lockedSize) setSizeLock(false)
    lockedSize = undefined
  }, 'Source window drag size lock')
  const text = (value: unknown): string => {
    if (typeof value !== 'string' || value.length > 32768 || value.includes('\0')) throw new TypeError('Invalid native string')
    return value
  }
  const number = (value: unknown): number => {
    if (typeof value !== 'number' || !Number.isFinite(value)) throw new TypeError('Invalid native number')
    return value
  }
  // 菜单只接受显示字段和命令标识，禁止渲染器注入原生角色、执行器及对象属性。
  const menuItems = (value: unknown, depth = 0): MenuItemConstructorOptions[] => {
    if (!Array.isArray(value) || value.length > 100 || depth > 5) throw new TypeError('Invalid native menu')
    return value.map(entry => {
      if (!entry || typeof entry !== 'object') throw new TypeError('Invalid menu item')
      const item = entry as Record<string, unknown>
      const type = item.type ?? 'normal'
      if (type !== 'normal' && type !== 'separator' && type !== 'checkbox') throw new TypeError('Invalid menu type')
      const id = item.id === undefined ? undefined : text(item.id)
      return {
        type, label: item.label === undefined ? undefined : text(item.label),
        enabled: item.enabled !== false, checked: item.checked === true,
        submenu: item.submenu === undefined ? undefined : menuItems(item.submenu, depth + 1),
        click: () => { if (id !== undefined) emit({ type: 'source-event', name: 'context-menu-command', payload: id }) },
      }
    })
  }
  return async (method: string, args: unknown[]): Promise<unknown> => {
    if (!Array.isArray(args) || args.length > 4) throw new TypeError('Invalid native arguments')
    switch (method) {
      case 'getPlatform': return process.platform
      case 'analyzeImage': {
        if (args.length !== 1 || typeof args[0] !== 'string' || args[0].length > 16 * 1024 * 1024 || args[0].includes('\0')) throw new TypeError('Invalid image analysis input')
        return environment.getContext().nativeContext.analyzeImage(args[0])
      }
      case 'setWindowSizeLock': {
        const locked = args[0]
        if (typeof locked !== 'boolean') throw new TypeError('Invalid window size lock')
        if (locked && !lockedSize) {
          const [width, height] = window.getSize()
          lockedSize = { width, height }
        } else if (!locked && lockedSize) {
          const bounds = window.getBounds()
          if (bounds.width !== lockedSize.width || bounds.height !== lockedSize.height) {
            window.setBounds({ x: bounds.x, y: bounds.y, ...lockedSize }, false)
          }
          lockedSize = undefined
        }
        setSizeLock(locked); return
      }
      case 'getLastCopiedContent': {
        const content = await environment.getContext().nativeContext.clipboardManager.getLastCopiedContent(args[0] === undefined ? undefined : number(args[0]), args[1] === undefined ? undefined : number(args[1]))
        if (!content) return null
        return { ...content, data: content.type === 'file' ? (content.data as Array<{ path: string; name: string; isDirectory: boolean }>).map(item => ({ ...item, isFile: !item.isDirectory })) : content.data }
      }
      case 'sendSuperPanelSearchResult':
      case 'sendSuperPanelWindowCommandsResult':
      case 'sendSuperPanelLaunchResult': {
        const kind = method === 'sendSuperPanelSearchResult' ? 'search' : method === 'sendSuperPanelWindowCommandsResult' ? 'window' : 'launch'
        if (!args[0] || typeof args[0] !== 'object') throw new TypeError('Invalid source response')
        environment.getContext().auxiliarySurfaces.acceptSourceResponse(kind, args[0] as SourceResponse)
        return
      }
      case 'getWindowMaterial': return environment.getWindowMaterial()
      case 'getWindowPosition': { const [x, y] = window.getPosition(); return { x, y } }
      case 'setWindowPosition': {
        const x = Math.round(number(args[0]))
        const y = Math.round(number(args[1]))
        const [currentX, currentY] = window.getPosition()
        if (x === currentX && y === currentY) return
        // Electron setPosition 会重新读取尺寸；拖动固定使用起始快照，避免 DIP 取整误差累积。
        if (lockedSize) window.setBounds({ x, y, ...lockedSize }, false)
        else window.setPosition(x, y, false)
        return
      }
      case 'copyToClipboard': clipboard.writeText(text(args[0])); return
      case 'revealInFinder': { const path = text(args[0]); await stat(path); shell.showItemInFolder(path); return }
      case 'openExternal': {
        const url = new URL(text(args[0]))
        if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new TypeError('Unsupported external URL')
        await shell.openExternal(url.href); return
      }
      case 'showNotification': {
        const body = text(args[0]).trim()
        if (!body || args.length !== 1) throw new TypeError('Invalid notification message')
        if (!Notification.isSupported()) throw new Error('Native notifications are not supported')
        // 系统确认展示后才完成调用，原生展示失败直接反馈给设置页。
        const delivery = Promise.withResolvers<void>()
        const notification = new Notification({ title: app.getName(), body })
        const release = ctx.effect(() => {
          const shown = () => delivery.resolve()
          const failed = (_event: Electron.Event, error: string) => delivery.reject(new Error(error))
          notification.once('show', shown)
          const closed = () => { void release() }
          notification.once('failed', failed)
          notification.once('close', closed)
          return () => {
            notification.removeListener('show', shown)
            notification.removeListener('failed', failed)
            notification.removeListener('close', closed)
            notification.close()
            delivery.reject(new Error('Notification scope disposed'))
          }
        }, 'native notification delivery')
        try {
          // 先观察两个 Promise，再触发展示，确保同步抛错也不会留下未处理的拒绝。
          await Promise.all([delivery.promise, Promise.resolve().then(() => notification.show())])
        } catch (error) { await release(); throw error }
        return
      }
      case 'checkFilePaths': {
        if (!Array.isArray(args[0]) || args[0].length > 1000) throw new TypeError('Invalid file path list')
        return Promise.all(args[0].map(async value => { const path = text(value); try { const info = await stat(path); return { path, exists: true, isDirectory: info.isDirectory() } } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { path, exists: false, isDirectory: false }; throw error } }))
      }
      case 'showContextMenu': Menu.buildFromTemplate(menuItems(args[0])).popup({ window }); return
      default: throw new Error(`Native operation is not registered: ${method}`)
    }
  }
}
