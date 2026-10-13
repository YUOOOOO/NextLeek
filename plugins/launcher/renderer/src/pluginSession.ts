import { nextTick } from 'vue'
import type { OpenPlugin } from '../../../plugin-market/shared'

// 原生插件会话只绑定原版占位区；离开视图释放受限能力，不创建第二套市场界面。
export function createSourcePluginSession(emit: (name: string, payload?: unknown) => void) {
  let opened: OpenPlugin | undefined
  let loadedSession: string | undefined
  let generation = 0
  let frame: number | undefined
  let observer: ResizeObserver | undefined
  let disposed = false
  const invoke = (method: string, args: unknown) => window.desktop.invokePlugin('plugin-market', method, args)
  function scheduleBounds() {
    if (disposed || frame !== undefined) return
    frame = requestAnimationFrame(() => {
      frame = undefined
      const element = document.querySelector<HTMLElement>('.plugin-placeholder')
      const plugin = opened
      if (!element || !plugin) return
      const rect = element.getBoundingClientRect()
      void invoke('viewBounds', { session: plugin.session, x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) })
        .then(() => opened === plugin ? invoke('viewVisible', { session: plugin.session, visible: rect.width > 0 && rect.height > 0 && !document.hidden }) : undefined)
        .then(() => {
          if (opened === plugin && loadedSession !== plugin.session) {
            loadedSession = plugin.session
            emit('PluginLoaded', plugin)
          }
        })
        .catch(error => console.error('原生插件视图布局失败:', error))
    })
  }
  async function close() {
    ++generation
    const previous = opened
    loadedSession = undefined
    observer?.disconnect(); observer = undefined
    if (frame !== undefined) cancelAnimationFrame(frame)
    frame = undefined
    // 原生关闭完成前保留会话身份，阻止搜索延迟测量；页面事件仍按原版顺序恢复来源列表。
    if (previous) await invoke('close', { session: previous.session })
    opened = undefined
    emit('PluginClosed'); emit('BackToSearch')
    if (previous) emit('BackToPluginList')
  }
  async function attach(plugin: OpenPlugin) {
    if (disposed) { await invoke('close', { session: plugin.session }); return }
    const previous = opened
    opened = plugin
    loadedSession = undefined
    if (previous && previous.session !== plugin.session) await invoke('close', { session: previous.session })
    emit('ShowPluginPlaceholder')
    emit('PluginOpened', { ...plugin, path: plugin.id, title: plugin.name, logo: '', featureCode: plugin.commandId })
    await nextTick()
    if (opened !== plugin || disposed) return
    // 原版插件管理器负责展开窗口；桥接须先恢复内容高度，再测量原生视图占位区。
    await window.desktop.setLauncherHeight(690)
    await nextTick()
    if (opened !== plugin || disposed) return
    observer?.disconnect()
    observer = new ResizeObserver(scheduleBounds)
    const element = document.querySelector('.plugin-placeholder')
    if (element) observer.observe(element)
    scheduleBounds()
  }
  async function open(id: string, commandId?: string) {
    const current = ++generation
    const result = await invoke('open', { id, ...(commandId ? { commandId } : {}) })
    if (!result || typeof result !== 'object' || !('session' in result) || typeof result.session !== 'string' || !('id' in result) || typeof result.id !== 'string' || !('name' in result) || typeof result.name !== 'string') throw new Error('插件会话响应无效')
    const plugin = result as OpenPlugin
    if (disposed || generation !== current) { await invoke('close', { session: plugin.session }); return }
    await attach(plugin)
  }
  function visibility() {
    const plugin = opened
    if (plugin) void invoke('viewVisible', { session: plugin.session, visible: !document.hidden }).catch(error => console.error('插件可见性更新失败:', error))
    if (!document.hidden) scheduleBounds()
  }
  function fromSettings(event: Event) {
    const detail = (event as CustomEvent<OpenPlugin>).detail
    void attach(detail).catch(error => console.error('打开设置中的插件失败:', error))
  }
  document.addEventListener('visibilitychange', visibility)
  window.addEventListener('resize', scheduleBounds)
  window.addEventListener('settings-plugin-open', fromSettings)
  const unsubscribe = window.desktop.subscribe(event => {
    if (event.type === 'shown') scheduleBounds()
    if (event.type === 'plugin-back' && event.session === opened?.session) void close()
  })
  return { open, close, scheduleBounds, currentId: () => opened?.id,
    action(method: 'focus' | 'sendInputEvent' | 'detach' | 'openDevTools', event?: unknown) {
      if (!opened) return Promise.reject(new Error('当前没有已授权插件会话'))
      return invoke(method, { session: opened.session, ...(method === 'sendInputEvent' ? { event } : {}) })
    }, dispose() {
    disposed = true; ++generation
    observer?.disconnect()
    if (frame !== undefined) cancelAnimationFrame(frame)
    const previous = opened; opened = undefined
    if (previous) void invoke('close', { session: previous.session }).catch(error => console.error('释放插件会话失败:', error))
    unsubscribe()
    document.removeEventListener('visibilitychange', visibility)
    window.removeEventListener('resize', scheduleBounds)
    window.removeEventListener('settings-plugin-open', fromSettings)
  } }
}
