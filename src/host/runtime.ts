import { Context } from '@deepseek-ai/cordis'
import packageMetadata from '../../package.json'
import type { CommandResult, PluginInfo, Settings, Snapshot, LauncherSearchRequest } from '../shared/contracts'
import { settingsPatch, identifier, boolean, launcherSearchRequest, searchItemId } from '../shared/validation'
import type { DesktopService } from './services/contracts'
import type { EverythingEnvironment } from './services/everything'
import type { ApplicationsEnvironment } from '../../plugins/applications/host'
import { composePlugins, type CompositionEnvironment } from './composition'
import type { InstalledPlugin } from '../../plugins/plugin-market/shared'

const statuses = ['pending', 'loading', 'active', 'failed', 'disposed', 'unloading'] as const

export interface RuntimeOptions extends Pick<CompositionEnvironment, 'settings' | 'nativeContext' | 'auxiliarySurfaces'> { version?: string; onContext?(ctx: Context): void }


export async function createRuntime(path: string, desktop: DesktopService, everythingEnvironment?: EverythingEnvironment, applicationsEnvironment?: ApplicationsEnvironment, options: RuntimeOptions = {}) {
  const ctx = new Context()
  options.onContext?.(ctx)
  const version = options.version ?? packageMetadata.version
  const entries = await composePlugins({ path, version, desktop, everything: everythingEnvironment, applications: applicationsEnvironment, executeCommand, settings: options.settings, nativeContext: options.nativeContext, auxiliarySurfaces: options.auxiliarySurfaces })
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
  // 市场包与可信部署插件共用界面入口，不共享能力权限或安装方式。
  async function invokeEndpoint(pluginId: string, method: string, args: unknown): Promise<unknown> {
    const clients = ctx.get('clientModules')
    if (pluginId === 'plugin-market' && clients && args && typeof args === 'object') {
      const input = args as Record<string, unknown>
      if (((method === 'open' || method === 'getPluginMemoryInfo') && typeof input.id === 'string' && clients.has(input.id)) || (typeof input.session === 'string' && clients.ownsSession(input.session))) return clients.invoke(method, input)
    }
    const result = await ctx.get('pluginEndpoints')!.invoke(pluginId, method, args)
    if (pluginId === 'plugin-market' && method === 'installed' && clients) return [...result as InstalledPlugin[], ...clients.list()]
    return result
  }
  function snapshot(): Snapshot {
    const state = ctx.get('storage')!.read()
    const plugins: PluginInfo[] = entries.map(entry => ({
      id: entry.id, name: entry.name, version, protected: entry.protected,
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
  // 所有执行入口共享最近使用记录；端点内部调用不能再次进入运行时串行队列。
  async function executeCommand(id: string): Promise<CommandResult> {
    identifier(id)
    const result = await ctx.get('commands')!.run(id)
    ctx.get('launcher')!.recordCommand(id)
    notify()
    if (result.navigate) desktop.emit({ type: 'navigate', page: result.navigate })
    return result
  }
  try {
    for (const entry of entries) {
      if (!entry.protected && ctx.get('storage')!.read().enabled[entry.id] === false) continue
      entry.fiber = ctx.plugin(entry.plugin, entry.config)
      await entry.fiber.await()
      if (entry.id === 'storage') {
        const storage = ctx.get('storage')!
        const state = storage.read()
        if (state.enabled['builtin-search'] !== true || ['everything-provider', 'everything', 'applications'].some(id => Object.hasOwn(state.enabled, id))) {
          const enabled: Record<string, boolean> = { ...state.enabled, 'builtin-search': true }
          delete enabled['everything-provider']
          delete enabled.everything
          delete enabled.applications
          storage.write({ ...state, enabled })
        }
      }
    }
    ctx.get('commands')!.subscribe(ctx, () => { if (!disposed) desktop.emit({ type: 'commands-changed' }) })
    await desktop.applySettings(ctx.get('storage')!.read().settings)
  } catch (error) {
    await release()
    throw error
  }
  return {
    ctx,
    getSnapshot: snapshot,
    listCommands: () => ctx.get('commands')!.list(),
    invokePlugin(pluginId: string, method: string, args: unknown) {
      // Data requests must not hold the mutation queue: disabling their provider
      // needs to reach the market immediately so it can abort in-flight work.
      if (pluginId === 'plugin-market' && ['invokeCapability', 'configureSource', 'cancelDownload', 'close', 'viewBounds', 'viewVisible', 'focus', 'sendInputEvent', 'detach', 'getPluginMemoryInfo'].includes(method)) {
        if (disposed) return Promise.reject(new Error('Runtime is shutting down'))
        return invokeEndpoint(pluginId, method, args)
      }
      return serialize(() => invokeEndpoint(pluginId, method, args))
    },
    searchLauncher(request: LauncherSearchRequest) {
      const validated = launcherSearchRequest(request)
      // 查询不能占用变更队列；旧查询由渲染端版本号隔离，服务释放由 Cordis effect 管理。
      if (disposed) return Promise.reject(new Error('Runtime is shutting down'))
      return ctx.get('search')!.search(validated)
    },
    performSearchAction(providerId: string, itemId: string, action: string) {
      identifier(providerId); searchItemId(itemId); identifier(action)
      return serialize(() => ctx.get('search')!.performAction(providerId, itemId, action))
    },
    updateSettings(patch: Partial<Settings>) {
      const validated = settingsPatch(patch)
      return serialize(async () => {
        await ctx.get('settings')!.update(validated)
        return notify()
      })
    },
    runCommand(id: string): Promise<CommandResult> {
      identifier(id)
      return serialize(() => executeCommand(id))
    },
    setPinned(id: string, pinned: boolean) {
      identifier(id); boolean(pinned)
      return serialize(() => {
        ctx.get('launcher')!.setPinned(id, pinned)
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
          const fiber = ctx.plugin(entry.plugin, entry.config)
          try { await fiber.await() } catch (error) { await fiber.dispose(); throw error }
          entry.fiber = fiber
        } else if (!enabled && entry.fiber) {
          await entry.fiber.dispose()
          entry.fiber = undefined
        }
        try { storage.write({ ...state, enabled: { ...state.enabled, [id]: enabled } }) }
        catch (error) {
          if (enabled && entry.fiber) { await entry.fiber.dispose(); entry.fiber = undefined }
          if (!enabled && !entry.fiber) { entry.fiber = ctx.plugin(entry.plugin, entry.config); await entry.fiber.await() }
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
