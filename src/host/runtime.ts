import { Context, type Fiber, type Plugin } from '@deepseek-ai/cordis'
import type { CommandResult, PluginInfo, Settings, Snapshot, EverythingSearchRequest, EverythingAction } from '../shared/contracts'
import { settingsPatch, identifier, boolean } from '../shared/validation'
import type { DesktopService } from './services/contracts'
import { storagePlugin } from './services/storage'
import { commandsPlugin } from './services/commands'
import { quickLaunchPlugin, settingsPlugin, themePlugin, everythingSearchPlugin } from './plugins/builtins'
import { everythingPlugin, type EverythingEnvironment } from './services/everything'

interface PluginEntry {
  id: string
  name: string
  protected: boolean
  plugin: Plugin
  fiber?: Fiber
}
const statuses = ['pending', 'loading', 'active', 'failed', 'disposed', 'unloading'] as const

export async function createRuntime(path: string, desktop: DesktopService, everythingEnvironment?: EverythingEnvironment) {
  const ctx = new Context()
  const entries: PluginEntry[] = [
    { id: 'storage', name: 'LMDB 存储', protected: true, plugin: storagePlugin(path) },
    { id: 'commands', name: '命令注册表', protected: true, plugin: commandsPlugin },
    { id: 'desktop', name: 'Electron 桌面宿主', protected: true, plugin: { name: 'desktop', apply(scope: Context) { scope.provide('desktop', desktop) } } },
    { id: 'everything-provider', name: 'Everything 搜索服务', protected: true, plugin: everythingPlugin(everythingEnvironment) },
    { id: 'settings', name: '设置', protected: true, plugin: settingsPlugin },
    { id: 'theme', name: '主题', protected: true, plugin: themePlugin },
    { id: 'quick-launch', name: '快速启动', protected: false, plugin: quickLaunchPlugin },
    { id: 'everything', name: 'Everything 文件搜索', protected: false, plugin: everythingSearchPlugin },
  ]
  let pending: Promise<unknown> = Promise.resolve()
  let disposed = false
  async function release() {
    for (const entry of [...entries].reverse()) await entry.fiber?.dispose()
    await ctx.fiber.dispose()
  }
  function serialize<T>(task: () => T | Promise<T>): Promise<T> {
    if (disposed) return Promise.reject(new Error('Runtime is shutting down'))
    const next = pending.then(task)
    pending = next.catch(() => {})
    return next
  }
  function snapshot(): Snapshot {
    const state = ctx.get('storage')!.read()
    const plugins: PluginInfo[] = entries.map(entry => ({
      id: entry.id, name: entry.name, version: '4.0.0', protected: entry.protected,
      enabled: entry.protected || state.enabled[entry.id] !== false,
      status: entry.fiber ? statuses[entry.fiber.state] : 'disabled',
    }))
    return { settings: state.settings, recent: state.recent, pinned: state.pinned, plugins }
  }
  function notify(): Snapshot {
    const value = snapshot()
    desktop.emit({ type: 'snapshot', snapshot: value })
    return value
  }
  try {
    for (const entry of entries) {
      if (!entry.protected && ctx.get('storage')!.read().enabled[entry.id] === false) continue
      entry.fiber = ctx.plugin(entry.plugin, undefined)
      await entry.fiber.await()
    }
    await desktop.applySettings(ctx.get('storage')!.read().settings)
  } catch (error) {
    await release()
    throw error
  }
  return {
    ctx,
    getSnapshot: snapshot,
    listCommands: () => ctx.get('commands')!.list(),
    getEverythingStatus() {
      if (disposed) return Promise.reject(new Error('Runtime is shutting down'))
      return ctx.get('everything')!.getStatus()
    },
    searchEverything(request: EverythingSearchRequest) {
      if (disposed) return Promise.reject(new Error('Runtime is shutting down'))
      return ctx.get('everything')!.search(request)
    },
    performEverythingAction(id: string, action: EverythingAction) {
      if (disposed) return Promise.reject(new Error('Runtime is shutting down'))
      return ctx.get('everything')!.performAction(id, action)
    },
    updateSettings(patch: Partial<Settings>) {
      const validated = settingsPatch(patch)
      return serialize(async () => {
        const storage = ctx.get('storage')!
        const state = storage.read()
        const next = { ...state.settings, ...validated }
        await desktop.applySettings(next, state.settings)
        try { storage.write({ ...state, settings: next }) }
        catch (error) { await desktop.applySettings(state.settings, next); throw error }
        return notify()
      })
    },
    runCommand(id: string): Promise<CommandResult> {
      identifier(id)
      return serialize(async () => {
        const result = await ctx.get('commands')!.run(id)
        const storage = ctx.get('storage')!
        const state = storage.read()
        storage.write({ ...state, recent: [id, ...state.recent.filter(item => item !== id)].slice(0, 50) })
        notify()
        if (result.navigate) desktop.emit({ type: 'navigate', page: result.navigate })
        return result
      })
    },
    setPinned(id: string, pinned: boolean) {
      identifier(id); boolean(pinned)
      return serialize(() => {
        if (!ctx.get('commands')!.has(id)) throw new Error(`Command unavailable: ${id}`)
        const storage = ctx.get('storage')!
        const state = storage.read()
        const pins = state.pinned.filter(item => item !== id)
        if (pinned) pins.push(id)
        storage.write({ ...state, pinned: pins })
        return notify()
      })
    },
    setPluginEnabled(id: string, enabled: boolean) {
      identifier(id); boolean(enabled)
      return serialize(async () => {
        const entry = entries.find(item => item.id === id)
        if (!entry) throw new Error(`Unknown plugin: ${id}`)
        if (entry.protected) throw new Error('Core plugins cannot be disabled')
        const storage = ctx.get('storage')!
        const state = storage.read()
        if (enabled && !entry.fiber) {
          const fiber = ctx.plugin(entry.plugin, undefined)
          try { await fiber.await() } catch (error) { await fiber.dispose(); throw error }
          entry.fiber = fiber
        } else if (!enabled && entry.fiber) {
          await entry.fiber.dispose()
          entry.fiber = undefined
        }
        try { storage.write({ ...state, enabled: { ...state.enabled, [id]: enabled } }) }
        catch (error) {
          if (enabled && entry.fiber) { await entry.fiber.dispose(); entry.fiber = undefined }
          if (!enabled && !entry.fiber) { entry.fiber = ctx.plugin(entry.plugin, undefined); await entry.fiber.await() }
          throw error
        }
        return notify()
      })
    },
    async dispose() {
      if (disposed) return
      disposed = true
      await pending
      await release()
    },
  }
}
export type Runtime = Awaited<ReturnType<typeof createRuntime>>
