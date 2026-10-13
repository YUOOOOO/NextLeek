import { watch } from 'vue'
import { router } from '../../../settings/src/router'
import { useDesktopStore } from '../../../../src/client/store'
import { createSourcePluginSession } from './pluginSession'
import settingsIcon from '../../../settings/src/assets/icons/settings.svg?url'
import searchIcon from '../../../settings/src/assets/icons/search.svg?url'
import pluginIcon from '../../../settings/src/assets/icons/plugin.svg?url'
import storeIcon from '../../../settings/src/assets/icons/store.svg?url'
import { searchWallpaperReference } from '../../../ztools-shared/searchWallpaper'

const commandIcons: Record<string, string> = { settings: settingsIcon, palette: settingsIcon, search: searchIcon, blocks: pluginIcon, store: storeIcon }

interface SourceRecord {
  path: string; name?: string; type?: string; featureCode?: string
  searchQuery?: string; payload?: string
  param?: { inputState?: SourceRecord }
  option?: { id?: string }
}

// 原版 API 的适配层仅连接真实插件端点；没有原生能力时明确拒绝。
export function installLauncherBridge(): () => void {
  const desktop = useDesktopStore()
  const api = window.desktop as typeof window.desktop & {
    getPlatform(): string
    getPathForFile?: (file: File) => string
    sourceNative(method: string, args: unknown): Promise<unknown>
  }
  const listeners = new Map<string, Set<(payload: unknown) => void>>()
  let pluginReturnPage: 'plugins' | 'plugin-market' = 'plugin-market'
  const emit = (name: string, payload?: unknown) => {
    if (name === 'ShowPluginPlaceholder' || name === 'BackToSearch') desktop.page = 'launcher'
    if (name === 'BackToPluginList') desktop.page = pluginReturnPage
    listeners.get(name)?.forEach(fn => fn(payload))
  }
  const pluginSession = createSourcePluginSession(emit)
  // 搜索、设置卡片和命令快捷键共用原生会话；关闭后恢复来源列表。
  const openPlugin = async (id: string, commandId?: string) => {
    if (!pluginSession.currentId()) pluginReturnPage = desktop.page !== 'launcher' && router.currentRoute.value.name === 'Plugins' ? 'plugins' : 'plugin-market'
    await pluginSession.open(id, commandId)
  }
  // 快捷键结果不再落到废弃市场组件，由原版启动器占位区承接。
  const stopOpenRequest = watch(() => desktop.openPluginRequest, request => {
    if (request) void openPlugin(request.pluginId, request.commandId).catch(error => { desktop.error = String(error) })
  })
  // 原版页面允许可选字段与响应式对象；端点只接收 JSON 数据，不传递 Vue 代理。
  const invoke = (plugin: string, method: string, args: unknown = null) => api.invokePlugin(plugin, method, JSON.parse(JSON.stringify(args)))
  const native = (method: string, args: unknown[] = []) => api.sourceNative(method, JSON.parse(JSON.stringify(args)))
  const on = (name: string, fn: (payload: unknown) => void) => {
    const bucket = listeners.get(name) ?? new Set()
    listeners.set(name, bucket); bucket.add(fn)
    return () => bucket.delete(fn)
  }
  let launchContext: SourceRecord = { path: '' }
  let lastMatch: SourceRecord | null = null
  let subInputCallback: ((value: { text: string }) => void) | undefined
  // 内置设置是宿主 Vue 页面，退出仍沿用原版关闭事件，但不要求隔离会话。
  const closePlugin = () => pluginSession.close()
  // 终止当前真实市场插件；内置设置只关闭页面，不停止设置服务。
  const killPluginAndReturn = async (path?: string) => {
    const id = pluginSession.currentId()
    if (id && path && path !== id) throw new Error('插件路径与当前授权会话不一致')
    await closePlugin()
    if (id) await invoke('plugin-market', 'stop', { id })
    return { success: true }
  }
  const source = {
    getPlatform: () => api.getPlatform(),
    isWindows: () => api.getPlatform() === 'win32',
    isMacOs: () => api.getPlatform() === 'darwin',
    isMacOS: () => api.getPlatform() === 'darwin',
    // Vite 图片相对当前文档解析，避免宿主把打包后的 ../../assets 当成项目目录。
    analyzeImage: (imagePath: string) => native('analyzeImage', [/^(?:[a-z]:[\\/]|\\\\)/i.test(imagePath) ? imagePath : new URL(imagePath, window.location.href).href]),
    isLinux: () => api.getPlatform() === 'linux',
    shellOpenExternal: (url: string) => native('openExternal', [url]),
    showNotification: (message: string) => native('showNotification', [message]),
    // 子输入框回调留在渲染器，不把函数跨 IPC 发送给原生进程。
    setSubInput: (callback: (value: { text: string }) => void, placeholder = '搜索', focus = true) => {
      subInputCallback = callback
      emit('UpdateSubInputPlaceholder', { pluginPath: 'settings', placeholder })
      emit('UpdateSubInputVisible', true)
      if (focus) emit('FocusSubInput')
      return true
    },
    removeSubInput: () => { subInputCallback = undefined; emit('UpdateSubInputVisible', false); return true },
    setSubInputValue: async (text: string) => { emit('SetSubInputValue', text); return true },
    notifySubInputChange: (text: string) => subInputCallback?.({ text }),
    subInputFocus: () => { emit('FocusSubInput'); return true },
    subInputSelect: () => { emit('SelectSubInput'); return true },
    outPlugin: closePlugin,
    getPathForFile: (file: File) => { if (!api.getPathForFile) throw new Error('原生文件拖放路径桥接不可用'); return api.getPathForFile(file) },
    dbGet: async (key: string) => {
      const value = await invoke('settings', 'dbGet', { key })
      if (key === 'enabled-main-push-plugin' && value == null) return ['文件搜索']
      return value
    },
    dbPut: async (key: string, value: unknown) => {
      const document = key === 'settings-general' && value && typeof value === 'object' && 'searchWallpaper' in value
        ? { ...value, searchWallpaper: searchWallpaperReference(value.searchWallpaper) } : value
      await invoke('settings', 'dbPut', { key, value: document })
      const event: Record<string, string> = { 'pinned-commands': 'PinnedChanged', 'command-history': 'HistoryChanged', 'command-aliases': 'CommandAliasesChanged', 'disable-commands': 'DisabledCommandsChanged' }
      if (event[key]) emit(event[key])
    },
    getApps: () => invoke('applications', 'getApps'),
    getSystemSettings: () => invoke('settings', 'getSystemSettings'),
    // 部署插件与市场静态包分属不同状态源，原版禁用列表必须同时读取两者。
    getDisabledPlugins: async () => {
      const [snapshot, installed] = await Promise.all([api.getSnapshot(), invoke('plugin-market', 'installed')])
      if (!Array.isArray(installed)) throw new TypeError('已安装插件列表无效')
      const disabled = new Set(snapshot.plugins.filter(item => !item.enabled).map(item => item.id))
      for (const item of installed) {
        if (!item || typeof item !== 'object' || typeof item.id !== 'string' || typeof item.enabled !== 'boolean') throw new TypeError('已安装插件信息无效')
        if (!item.enabled) disabled.add(item.id)
      }
      return [...disabled]
    },
    getAllPlugins: async () => {
      const [snapshot, commands, installed] = await Promise.all([api.getSnapshot(), api.listCommands(), invoke('plugin-market', 'installed')])
      const plugins = snapshot.plugins.map(plugin => ({ ...plugin, path: plugin.id, title: plugin.name,
        features: commands.filter(command => command.pluginId === plugin.id).map(command => ({ code: command.id, explain: command.description, cmds: [command.title, ...command.keywords] as unknown[], icon: commandIcons[command.icon] ?? command.icon, mainPush: false })) }))
      if (!Array.isArray(installed)) throw new TypeError('已安装插件列表无效')
      for (const value of installed) {
        if (!value || typeof value !== 'object' || typeof value.id !== 'string' || typeof value.name !== 'string') throw new TypeError('已安装插件信息无效')
        if (plugins.some(plugin => plugin.id === value.id)) continue
        plugins.push({ id: value.id, name: value.id, path: value.id, title: value.name, enabled: value.enabled === true, protected: value.deploymentManaged === true,
          status: value.enabled ? 'active' : 'disabled', version: String(value.version),
          features: commands.filter(command => command.pluginId === value.id).map(command => ({ code: command.id, explain: command.description, cmds: [command.title, ...command.keywords] as unknown[], icon: commandIcons[command.icon] ?? command.icon, mainPush: false })) })
      }
      // 文件搜索作为受限 Cordis mainPush 提供者，保持上游聚合展示和选择逻辑。
      plugins.push({ id: 'everything', name: '文件搜索', path: 'everything', title: '文件搜索', enabled: true,
        protected: true, status: 'active', version: '1', features: [{ code: 'everything', explain: '文件搜索', icon: '', cmds: [{ type: 'over', label: '文件搜索', minLength: 1 }], mainPush: true }] })
      return plugins
    },
    launch: async (options: SourceRecord) => {
      lastMatch = options.param?.inputState ?? launchContext
      if (options.type === 'direct' || options.type === 'app' || options.type === 'system-setting') {
        const shortcuts = await invoke('settings', 'getLocalShortcuts')
        if (Array.isArray(shortcuts) && shortcuts.some(item => item && typeof item === 'object' && item.path === options.path)) await invoke('settings', 'openLocalShortcut', { path: options.path })
        else if (options.path.startsWith('ms-settings:')) await invoke('settings', 'launchSystemSetting', { uri: options.path })
        else await invoke('applications', 'launch', { path: options.path })
        await invoke('builtin-search', 'recordSourceCommand', options)
        emit('HistoryChanged'); emit('AppLaunched'); await api.hide()
      } else {
        const commands = await api.listCommands()
        const command = commands.find(item => item.id === options.featureCode || item.id === options.path)
          ?? commands.find(item => item.pluginId === options.path && item.title === options.name)
          ?? commands.find(item => item.pluginId === options.path)
        if (!command) throw new Error('插件指令未注册或已禁用')
        const result = await api.runCommand(command.id)
        if (result.pluginId) {
          await openPlugin(result.pluginId, result.commandId)
        } else desktop.applyCommandResult(result)
        await invoke('builtin-search', 'recordSourceCommand', { ...options, path: command.pluginId ?? command.id, featureCode: command.id })
        emit('HistoryChanged')
      }
    },
    updateLaunchContext: (value: SourceRecord) => { launchContext = value; desktop.query = value.searchQuery ?? '' },
    restoreLastMatch: async () => lastMatch,
    openSettings: () => { desktop.page = 'settings' },
    hideWindow: () => api.hide(),
    hidePlugin: closePlugin,
    // 内置设置聚焦实际子输入框，外部插件继续使用授权视图。
    focusPlugin: async () => { if (desktop.page !== 'launcher') emit('FocusSubInput'); else await pluginSession.action('focus') },
    sendInputEvent: async (event: unknown) => { await pluginSession.action('sendInputEvent', event); return { success: true } },
    detachPlugin: () => desktop.page !== 'launcher' ? Promise.resolve({ success: false, error: '内置设置不支持分离窗口' }) : pluginSession.action('detach'),
    openPluginDevTools: () => desktop.page !== 'launcher' ? Promise.resolve({ success: false, error: '内置设置没有独立插件开发者工具' }) : pluginSession.action('openDevTools'),
    killPlugin: killPluginAndReturn,
    killPluginAndReturn,
    // 搜索自动测量只能调整搜索页；设置和原生插件会话各自拥有固定内容高度。
    resizeWindow: (height: number) => desktop.page === 'launcher' && !pluginSession.currentId()
      ? api.setLauncherHeight(Math.ceil(height)) : Promise.resolve(),
    getUsageStats: () => invoke('builtin-search', 'getUsageStats', []),
    getSuperPanelPinned: () => invoke('builtin-search', 'getSuperPanelPinned', []),
    localShortcuts: { getAll: () => invoke('settings', 'getLocalShortcuts') },
    queryMainPush: async (plugin: string, _feature: string, query: SourceRecord) => {
      if (plugin !== 'everything') return invoke(plugin, 'queryMainPush', query)
      const groups = await api.searchLauncher({ query: query.payload ?? '', offset: 0, limit: 100 })
      const group = groups.find(item => item.providerId === 'everything')
      if (!group || group.status !== 'ready') throw new Error(group?.message ?? '文件搜索不可用')
      return group.items.map(item => ({ ...item, text: item.name, title: item.name, description: item.path, providerId: group.providerId }))
    },
    selectMainPush: async (plugin: string, _feature: string, selection: SourceRecord) => {
      if (plugin !== 'everything') return invoke(plugin, 'selectMainPush', selection)
      const item = selection.option
      if (!item || typeof item.id !== 'string') throw new Error('文件结果授权标识缺失')
      await api.performSearchAction('everything', item.id, 'open'); await api.hide(); return false
    },
    setPluginMainPushEnabled: async (name: string, enabled: boolean) => {
      const key = 'enabled-main-push-plugin'
      const stored = await source.dbGet(key)
      const list: string[] = Array.isArray(stored) ? stored.filter((item): item is string => typeof item === 'string') : []
      await source.dbPut(key, enabled ? [...new Set([...list, name])] : list.filter(item => item !== name))
      return { success: true }
    },
    launchAsAdmin: (path: string) => invoke('applications', 'launchAsAdmin', { path }),
    updater: {
      getDownloadStatus: async () => { const state = await api.getUpdateState(); return { ...state, hasUpdate: ['available', 'downloading', 'downloaded'].includes(state.status) } },
      startUpdate: () => api.downloadUpdate(), installDownloadedUpdate: () => api.installUpdate(),
      showUpdateWindow: async () => { desktop.page = 'settings'; return { success: true } },
      cancelUpdate: () => native('cancelUpdate'),
    },
    pluginUpdates: {
      check: async (name: string, path?: string) => {
        const [installed, catalog] = await Promise.all([invoke('plugin-market', 'installed'), invoke('plugin-market', 'catalog')])
        if (!Array.isArray(installed) || !Array.isArray(catalog)) throw new TypeError('插件版本列表无效')
        const current = installed.find(item => item.id === (path ?? name))
        const latest = catalog.find(item => item.id === (path ?? name))
        return { success: true, updateAvailable: !!current && !!latest && current.version !== latest.version, currentVersion: current?.version, latestVersion: latest?.version }
      },
      openMarket: async () => { desktop.page = 'plugins'; return { success: true } },
      upgrade: async (name: string, path?: string) => {
        await invoke('plugin-market', 'install', { id: path ?? name })
        emit('PluginInstalled')
        return { success: true }
      },
      onProgress: (fn: (payload: unknown) => void) => on('PluginUpdateProgress', fn),
    },
  }
  const actions: Record<string, (...args: unknown[]) => Promise<unknown>> = {}
  for (const method of ['pinApp', 'unpinApp', 'removeFromHistory', 'updatePinnedOrder', 'pinToSuperPanel', 'unpinSuperPanelCommand', 'updateSuperPanelPinnedOrder']) {
    actions[method] = async (...args: unknown[]) => {
      const result = await invoke('builtin-search', method, args)
      emit(method === 'removeFromHistory' ? 'HistoryChanged' : method.includes('SuperPanel') ? 'SuperPanelPinnedChanged' : 'PinnedChanged')
      return result
    }
  }
  const bridge = new Proxy({ ...source, ...actions }, { get(target, property: string) {
    if (property in target) return Reflect.get(target, property)
    if (property.startsWith('on')) return (fn: (payload: unknown) => void) => on(property.slice(2), fn)
    return (...args: unknown[]) => native(property, args)
  } })
  // 上游 API 类型描述的是同一展示协议，原生权限由对应端点再校验。
  window.ztools = bridge as unknown as typeof window.ztools
  const dispose = api.subscribe((event) => {
    if (event.type === 'shown') emit('FocusSearch')
    if (event.type === 'commands-changed') { emit('AppsChanged'); emit('PluginsChanged') }
    if (event.type === 'source-event') {
      const name = event.name.replace(/(^|-)(\w)/g, (_: string, _prefix: string, char: string) => char.toUpperCase())
      emit(name, event.payload)
    }
    if (event.type === 'update' && event.update.status === 'available') emit('UpdateAvailable', event.update)
  })
  return () => { stopOpenRequest(); dispose(); pluginSession.dispose(); listeners.clear() }
}
