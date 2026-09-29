export interface NavigationConfig { enabled: boolean; label?: string; icon?: string; order: number }
export interface PluginCmd { code: string; label: string; matches?: string[] }
export interface PluginManifest {
  id: string
  name: string
  version: string
  entry: string
  description?: string
  author?: string
  icon?: string
  minCreatorVersion?: string
  capabilities: string[]
  permissions: string[]
  navigation?: NavigationConfig
  cmds?: PluginCmd[]
}
export interface RuntimeSummary { pluginCount: number; mode: string; version: string }
export interface PluginState { manifest: PluginManifest; builtin: boolean; trusted: boolean; source?: 'builtin' | 'official-market' | 'local-import' | 'user-created' }
export interface MarketPlugin { id: string; name: string; version: string; description: string; author: string; iconUrl?: string; packageUrl: string; sha256: string; minCreatorVersion: string; permissions: string[] }
export interface MarketCatalog { schemaVersion: number; updatedAt: string; plugins: MarketPlugin[] }
export interface Settings { marketUrl: string; trustedPlugins: string[] }
export interface SettingsView { settings: Settings; version: string; dataDir: string }
export interface RuntimeLaunch { token: string; manifest: PluginManifest; entryHtml: string; textAssets: Record<string, string>; trusted: boolean }

export interface KernelApi {
  runtimeSummary(): Promise<RuntimeSummary>
  listPlugins(): Promise<PluginState[]>
  refreshMarket(): Promise<MarketCatalog>
  installMarketPlugin(plugin: MarketPlugin): Promise<PluginState>
  uninstallPlugin(id: string): Promise<void>
  readSettings(): Promise<SettingsView>
  setMarketUrl(url: string): Promise<SettingsView>
  setPluginTrust(id: string, trusted: boolean): Promise<SettingsView>
  launchPlugin(id: string): Promise<RuntimeLaunch>
  pluginSdkCall(token: string, method: string, params: unknown): Promise<unknown>
  closePlugin(token: string): Promise<void>
}

export async function createTauriApi(): Promise<KernelApi> {
  const { invoke } = await import('@tauri-apps/api/core')
  return {
    runtimeSummary: () => invoke<RuntimeSummary>('runtime_summary_command'),
    listPlugins: () => invoke<PluginState[]>('list_plugins_command'),
    refreshMarket: () => invoke<MarketCatalog>('refresh_market_command'),
    installMarketPlugin: plugin => invoke<PluginState>('install_market_plugin_command', { plugin }),
    uninstallPlugin: id => invoke<void>('uninstall_plugin_command', { pluginId: id }),
    readSettings: () => invoke<SettingsView>('read_settings_command'),
    setMarketUrl: url => invoke<SettingsView>('set_market_url_command', { url }),
    setPluginTrust: (id, trusted) => invoke<SettingsView>('set_plugin_trust_command', { pluginId: id, trusted }),
    launchPlugin: id => invoke<RuntimeLaunch>('launch_plugin_command', { pluginId: id }),
    pluginSdkCall: (token, method, params) => invoke<unknown>('plugin_sdk_call_command', { token, method, params }),
    closePlugin: token => invoke<void>('close_plugin_command', { token }),
  }
}

export function createMemoryApi(installed: PluginState[], pluginFiles: Record<string, Record<string, string>> = {}): KernelApi {
  const localInstalled = new Map(installed.map(plugin => [plugin.manifest.id, plugin]))
  const market: MarketPlugin = {
    id: 'com.example.clock',
    name: 'Clock',
    version: '1.0.0',
    description: 'Clock plugin',
    author: 'Community',
    packageUrl: 'https://example.com/clock.nlplugin',
    sha256: 'a'.repeat(64),
    minCreatorVersion: '0.1.0',
    permissions: [],
  }
  const settings: SettingsView = {
    settings: { marketUrl: 'https://raw.githubusercontent.com/YUOOOOO/NextLeek-Plugins/main/index.json', trustedPlugins: [] },
    version: '0.1.0',
    dataDir: 'Data',
  }
  return {
    runtimeSummary: async () => ({ pluginCount: localInstalled.size, mode: 'dual-trust', version: '0.1.0' }),
    listPlugins: async () => [...localInstalled.values()],
    refreshMarket: async () => ({ schemaVersion: 1, updatedAt: '2026-08-24T00:00:00Z', plugins: [market] }),
    installMarketPlugin: async plugin => {
      const state = { manifest: { ...plugin, entry: 'ui/index.html', capabilities: [] }, builtin: false, trusted: false, source: 'official-market' as const }
      localInstalled.set(plugin.id, state)
      return state
    },
    uninstallPlugin: async id => { localInstalled.delete(id) },
    readSettings: async () => structuredClone(settings),
    setMarketUrl: async url => { settings.settings.marketUrl = url; return structuredClone(settings) },
    setPluginTrust: async (id, trusted) => {
      settings.settings.trustedPlugins = trusted
        ? [...new Set([...settings.settings.trustedPlugins, id])]
        : settings.settings.trustedPlugins.filter(value => value !== id)
      const state = localInstalled.get(id)
      if (state) state.trusted = trusted
      return structuredClone(settings)
    },
    launchPlugin: async id => {
      const state = localInstalled.get(id)
      if (!state) throw new Error('plugin not installed')
      const files = pluginFiles[id] ?? {}
      return {
        token: `token-${id}`,
        manifest: state.manifest,
        entryHtml: files[state.manifest.entry] ?? `<main><h1>${state.manifest.name}</h1></main>`,
        textAssets: Object.fromEntries(Object.entries(files).filter(([path]) => path !== state.manifest.entry)),
        trusted: state.trusted,
      }
    },
    pluginSdkCall: async () => null,
    closePlugin: async () => undefined,
  }
}
