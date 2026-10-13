import type { DesktopAPI } from '../../src/shared/contracts'
import type { InstalledPlugin, MarketEntry } from '../plugin-market/shared'

function sourceEntry(item: MarketEntry | InstalledPlugin) {
  return { ...item, name: item.id, title: item.name, path: item.id,
    features: (item.commands ?? []).map(command => ({ code: command.id, explain: command.description ?? command.title, cmds: [command.title, ...command.keywords] })),
    sourceType: 'open_source' as const, sourceLabel: '受信任静态插件（.nlplugin）' }
}
export function createMarketBridge(api: DesktopAPI) {
  const invoke = (method: string, args: unknown = null) => api.invokePlugin('plugin-market', method, args)
  const installed = async () => (await invoke('installed') as InstalledPlugin[]).map(sourceEntry)
  const result = async (work: () => Promise<unknown>) => {
    try { return { success: true, data: await work() } }
    catch (error) { const message = error instanceof Error ? error.message : String(error); return { success: false, error: message, cancelled: message === 'Plugin download cancelled' } }
  }
  return {
    getPlugins: installed,
    getPluginMemoryInfo: (id: string) => invoke('getPluginMemoryInfo', { id }),
    fetchPluginMarket: () => result(async () => (await invoke('catalog') as MarketEntry[]).map(sourceEntry)),
    fetchPluginMarketRecommendations: async (limit: number) => (await invoke('catalog') as MarketEntry[]).slice(0, limit).map(sourceEntry),
    installPluginFromMarket: (plugin: { name: string }, taskId?: string) => result(() => invoke('install', { id: plugin.name, ...(taskId ? { taskId } : {}) })),
    installPluginFromPath: async (path: string) => {
      try { const plugin = await invoke('installLocal', { path }) as InstalledPlugin; return { success: true, plugin: sourceEntry(plugin) } }
      catch (error) { return { success: false, error: error instanceof Error ? error.message : String(error) } }
    },
    readPluginInfoFromZpx: async (path: string) => {
      try {
        const entry = await invoke('previewLocal', { path }) as MarketEntry
        return { success: true, pluginInfo: { ...sourceEntry(entry), isInstalled: (await installed()).some(item => item.name === entry.id) } }
      } catch (error) { return { success: false, error: error instanceof Error ? error.message : String(error) } }
    },
    deletePlugin: (id: string) => result(() => invoke('uninstall', { id })),
    setPluginDisabled: (id: string, disabled: boolean) => result(() => invoke('setEnabled', { id, enabled: !disabled })),
    getRunningPlugins: async () => (await invoke('running') as Array<{ id: string; name: string }>).map(item => ({ ...item, name: item.id, title: item.name, path: item.id })),
    killPlugin: (id: string) => result(() => invoke('stop', { id })),
    revealInFinder: (id: string) => invoke('reveal', { id }),
    cancelPluginMarketDownload: (taskId: string) => result(() => invoke('cancelDownload', { taskId })),
    exportAllPlugins: async () => {
      try { const exported = await invoke('exportAll') as { path: string; count: number } | null
        return exported ? { success: true, filePath: exported.path, count: exported.count } : { success: false, error: '用户取消选择' }
      } catch (error) { return { success: false, error: error instanceof Error ? error.message : String(error) } }
    },
    onPluginMarketDownloadProgress: (fn: (payload: unknown) => void) => api.subscribe(event => { if (event.type === 'source-event' && event.name === 'plugin-market-download-progress') fn(event.payload) }),
  }
}
