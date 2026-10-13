import { useCommandDataStore } from '../../launcher/renderer/src/stores/commandDataStore'
import { createMarketBridge } from '../market-bridge'
import { COMMAND_ALIASES_KEY, normalizeCommandAliases, type CommandAliasStore } from '../../launcher/renderer/src/shared/commandShared'
import { searchWallpaperReference } from '../../ztools-shared/searchWallpaper'

// 原版设置调用保留；只把底层 IPC 接到 Cordis 所有者，不覆盖启动器 API。
export function installSettingsBridge(): () => void {
  const api = window.desktop
  const source = window.ztools
  function callSource(method: string, args: unknown[]) {
    const handler: unknown = Reflect.get(source, method)
    if (typeof handler !== 'function') throw new Error(`Launcher source method unavailable: ${method}`)
    return Reflect.apply(handler, source, args)
  }
  const callbacks = new Map<string, Set<(...args: unknown[]) => void>>()
  const hotkeyCallbacks = new Set<(shortcut: string) => void>()
  // 暂停宿主快捷键，录制确认仍由原版组件完成。
  const startHotkeyRecording = async () => {
    try {
      await api.setHotkeyCapture(true)
      return { success: true }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) }
    }
  }
  // 取消或确认时恢复宿主快捷键。
  const stopHotkeyRecording = () => api.setHotkeyCapture(false)
  // 原生捕获事件保持渲染器本地订阅，可随组件撤销。
  const onHotkeyRecorded = (callback: (shortcut: string) => void) => {
    hotkeyCallbacks.add(callback)
    return () => { hotkeyCallbacks.delete(callback) }
  }
  // 原版设置的可选字段和响应式数据在边界转成端点要求的 JSON。
  const invoke = (method: string, args: unknown = null) => {
    const payload = method === 'updateSearchWallpaper' && Array.isArray(args) ? [searchWallpaperReference(args[0])] : args
    return api.invokePlugin('settings', method, JSON.parse(JSON.stringify(payload)))
  }
  const on = (name: string, callback: (...args: unknown[]) => void) => {
    const bucket = callbacks.get(name) ?? new Set(); callbacks.set(name, bucket); bucket.add(callback)
    return () => bucket.delete(callback)
  }
  const direct: Record<string, unknown> = {
    startHotkeyRecording,
    stopHotkeyRecording,
    onHotkeyRecorded,
    dbGet: (key: string) => invoke('dbGet', { key }),
    updaterSetAutoCheck: (enabled: boolean) => api.invokePlugin('updater', 'setAutoCheck', [enabled]),
    updaterCheckUpdate: async () => {
      const state = await api.checkForUpdates()
      return { hasUpdate: state.status === 'available' || state.status === 'downloaded', migrationRequired: !state.supported, releaseUrl: 'https://github.com/YUOOOOO/NextLeek/releases/latest', error: state.status === 'error' ? state.message : undefined }
    },
    selectPluginFile: () => invoke('selectPluginFile'),
    dbPut: (key: string, value: unknown) => source.dbPut(key, value),
    getPlatform: () => source.getPlatform(),
    getAllPlugins: () => source.getAllPlugins(),
    getDisabledPlugins: () => source.getDisabledPlugins(),
    launch: (...args: unknown[]) => callSource('launch', args),
    getCommands: async () => {
      const store = useCommandDataStore(); await store.loadCommands()
      return { commands: store.commands, regexCommands: store.regexCommands, plugins: await source.getAllPlugins() }
    },
    // 归一化后写入真实宿主数据库，同时复用启动器的别名刷新事件。
    updateCommandAliases: async (aliases: CommandAliasStore) => {
      await source.dbPut(COMMAND_ALIASES_KEY, normalizeCommandAliases(aliases))
      return { success: true }
    },
    localShortcuts: Object.fromEntries(['getAll', 'add', 'addByPath', 'updateAlias', 'open', 'delete', 'deleteWhenNotExist'].map(method => [method, (...args: unknown[]) => invoke(`localShortcuts.${method}`, args)])),
    onLogEntries: (fn: (...args: unknown[]) => void) => on('log-entries', fn),
    offLogEntries: (fn: (...args: unknown[]) => void) => callbacks.get('log-entries')?.delete(fn),
    ...createMarketBridge(api),
  }
  // 原版页面使用“插件显示名/指令”，原生注册必须使用 Cordis 的稳定命令 ID。
  for (const method of ['registerGlobalShortcut', 'registerAppShortcut']) direct[method] = async (...args: unknown[]) => {
    const target = args[1]
    if (typeof target === 'string') {
      const [snapshot, commands] = await Promise.all([api.getSnapshot(), api.listCommands()])
      const command = commands.find(item => {
        const plugin = snapshot.plugins.find(plugin => plugin.id === item.pluginId)
        return item.id === target || [item.title, ...item.keywords].some(name =>
          `${plugin?.name}/${name}` === target || `${item.pluginId}/${name}` === target)
      })
      if (command) args[1] = command.id
    }
    return api.invokePlugin('command-shortcuts', 'source', { method, args })
  }
  for (const method of ['unregisterGlobalShortcut', 'unregisterAppShortcut', 'updateGlobalShortcutConfig']) direct[method] = (...args: unknown[]) => api.invokePlugin('command-shortcuts', 'source', { method, args })
  for (const method of ['pinApp', 'unpinApp', 'pinToSuperPanel', 'unpinSuperPanelCommand', 'getSuperPanelPinned', 'getUsageStats', 'updatePinnedOrder']) direct[method] = (...args: unknown[]) => callSource(method, args)
  for (const name of ['LocalShortcutsChanged', 'AppsChanged', 'CommandAliasesChanged', 'DisabledCommandsChanged']) direct[`on${name}`] = (fn: (...args: unknown[]) => void) => callSource(`on${name}`, [fn])
  const internal = new Proxy(direct, { get(target, property: string) {
    if (property in target) return target[property]
    return (...args: unknown[]) => invoke(property, args)
  } })
  Object.assign(source, { internal })
  const release = api.subscribe(event => {
    if (event.type === 'hotkey') hotkeyCallbacks.forEach(callback => callback(event.value))
    if (event.type === 'source-event') callbacks.get(event.name)?.forEach(fn => fn(event.payload))
  })
  return () => {
    release(); callbacks.clear(); hotkeyCallbacks.clear()
    void stopHotkeyRecording().catch(error => console.error('释放快捷键录制失败:', error))
  }
}
