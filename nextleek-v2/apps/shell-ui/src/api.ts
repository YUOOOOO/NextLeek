export interface NavigationConfig { enabled:boolean; label?:string; icon?:string; order:number }
export interface PluginManifest {
 id:string; name:string; version:string; entry:string; description?:string; author?:string; icon?:string;
 minCreatorVersion?:string; capabilities:string[]; permissions:string[]; navigation?:NavigationConfig
}
export interface RuntimeSummary { pluginCount:number; mode:string; version:string }
export interface ValidationReport { valid:boolean; errors:string[] }
export interface PackageArtifact { pluginId:string; version:string; path:string; sha256:string; size:number; files:string[] }
export interface PluginState { manifest:PluginManifest; builtin:boolean; trusted:boolean; source?:'builtin'|'official-market'|'local-import'|'user-created' }
export interface MarketPlugin { id:string; name:string; version:string; description:string; author:string; iconUrl?:string; packageUrl:string; sha256:string; minCreatorVersion:string; permissions:string[] }
export interface MarketCatalog { schemaVersion:number; updatedAt:string; plugins:MarketPlugin[] }
export interface AiSettings { enabled:boolean; baseUrl:string; apiKey:string; model:string; temperature:number }
export interface Settings { marketUrl:string; trustedPlugins:string[]; ai:AiSettings }
export interface SettingsView { settings:Settings; version:string; dataDir:string }
export interface RuntimeLaunch { token:string; manifest:PluginManifest; entryHtml:string; textAssets:Record<string,string>; trusted:boolean }
export interface PluginDraft { manifest:PluginManifest; files:Record<string,string> }
export interface GeneratePluginRequest { instruction:string; currentDraft:PluginDraft; validationErrors?:string[] }
export interface GeneratePluginResponse { manifest:PluginManifest; files:Record<string,string>; explanation:string }
export interface KernelApi {
  runtimeSummary():Promise<RuntimeSummary>
  listPlugins():Promise<PluginState[]>
  createDraft(id:string, manifest:PluginManifest):Promise<void>
  writeDraftFile(id:string, relative:string, content:string):Promise<void>
  validateDraft(id:string):Promise<ValidationReport>
  packageDraft(id:string):Promise<PackageArtifact>
  refreshMarket():Promise<MarketCatalog>
  installMarketPlugin(plugin:MarketPlugin):Promise<PluginState>
  installLocalPackage(bytes:number[]):Promise<PluginState>
  uninstallPlugin(id:string):Promise<void>
  readSettings():Promise<SettingsView>
  setMarketUrl(url:string):Promise<SettingsView>
  setAiSettings(settings:AiSettings):Promise<SettingsView>
  setPluginTrust(id:string, trusted:boolean):Promise<SettingsView>
  launchPlugin(id:string):Promise<RuntimeLaunch>
  pluginSdkCall(token:string, method:string, params:unknown):Promise<unknown>
  closePlugin(token:string):Promise<void>
  generatePlugin(request:GeneratePluginRequest):Promise<GeneratePluginResponse>
}

export async function createTauriApi(): Promise<KernelApi> {
  const { invoke } = await import('@tauri-apps/api/core')
  return {
    runtimeSummary: () => invoke<RuntimeSummary>('runtime_summary_command'),
    listPlugins: () => invoke<PluginState[]>('list_plugins_command'),
    createDraft: (draftId, manifest) => invoke<void>('create_draft_command', { draftId, manifest }),
    writeDraftFile: (draftId, relative, content) => invoke<void>('write_draft_file_command', { draftId, relative, content }),
    validateDraft: draftId => invoke<ValidationReport>('validate_draft_command', { draftId }),
    packageDraft: draftId => invoke<PackageArtifact>('package_draft_command', { draftId }),
    refreshMarket: () => invoke<MarketCatalog>('refresh_market_command'),
    installMarketPlugin: plugin => invoke<PluginState>('install_market_plugin_command', { plugin }),
    installLocalPackage: bytes => invoke<PluginState>('install_local_package_command', { bytes }),
    uninstallPlugin: id => invoke<void>('uninstall_plugin_command', { pluginId:id }),
    readSettings: () => invoke<SettingsView>('read_settings_command'),
    setMarketUrl: url => invoke<SettingsView>('set_market_url_command', { url }),
    setAiSettings: settings => invoke<SettingsView>('set_ai_settings_command', { settings }),
    setPluginTrust: (id, trusted) => invoke<SettingsView>('set_plugin_trust_command', { pluginId:id, trusted }),
    launchPlugin: id => invoke<RuntimeLaunch>('launch_plugin_command', { pluginId:id }),
    pluginSdkCall: (token, method, params) => invoke<unknown>('plugin_sdk_call_command', { token, method, params }),
    closePlugin: token => invoke<void>('close_plugin_command', { token }),
    generatePlugin: request => invoke<GeneratePluginResponse>('generate_plugin_command', { request })
  }
}

export function createMemoryApi(installed:PluginState[]):KernelApi {
  const drafts = new Map<string, PluginManifest>()
  const localInstalled = new Map(installed.map(plugin => [plugin.manifest.id, plugin]))
  const market:MarketPlugin = {id:'com.example.clock',name:'Clock',version:'1.0.0',description:'Clock plugin',author:'Community',packageUrl:'https://example.com/clock.nlplugin',sha256:'a'.repeat(64),minCreatorVersion:'0.1.0',permissions:[]}
  const settings:SettingsView = {settings:{marketUrl:'https://raw.githubusercontent.com/YUOOOOO/NextLeek-Plugins/main/index.json',trustedPlugins:[],ai:{enabled:true,baseUrl:'https://api.openai.com/v1',apiKey:'',model:'gpt-4.1-mini',temperature:0.2}},version:'0.1.0',dataDir:'Data'}
  return {
    runtimeSummary: async () => ({ pluginCount:localInstalled.size, mode:'dual-trust', version:'0.1.0' }),
    listPlugins: async () => [...localInstalled.values()],
    createDraft: async (id, manifest) => { if(id.includes('..')) throw new Error('unsafe draft id'); drafts.set(id, structuredClone(manifest)) },
    writeDraftFile: async () => undefined,
    validateDraft: async id => ({ valid:drafts.has(id), errors:drafts.has(id)?[]:['draft not found'] }),
    packageDraft: async id => { const manifest=drafts.get(id); if(!manifest) throw new Error('draft not found'); return {pluginId:manifest.id,version:manifest.version,path:`Data/creator-packages/${manifest.id}-${manifest.version}.nlplugin`,sha256:'b'.repeat(64),size:420,files:['manifest.json','ui/index.html','ui/main.js','ui/style.css']} },
    refreshMarket: async () => ({schemaVersion:1,updatedAt:'2026-08-24T00:00:00Z',plugins:[market]}),
    installMarketPlugin: async plugin => { const state={manifest:{...plugin,entry:'ui/index.html',capabilities:[]},builtin:false,trusted:false}; localInstalled.set(plugin.id,state); return state },
    installLocalPackage: async () => { const state={manifest:{id:'com.example.local',name:'Local',version:'1.0.0',entry:'ui/index.html',minCreatorVersion:'0.1.0',capabilities:[],permissions:[]},builtin:false,trusted:false}; localInstalled.set(state.manifest.id,state); return state },
    uninstallPlugin: async id => { localInstalled.delete(id) },
    readSettings: async () => structuredClone(settings),
    setMarketUrl: async url => { settings.settings.marketUrl=url; return structuredClone(settings) },
    setAiSettings: async value => { settings.settings.ai=structuredClone(value); return structuredClone(settings) },
    setPluginTrust: async (id, trusted) => { settings.settings.trustedPlugins=trusted?[...new Set([...settings.settings.trustedPlugins,id])]:settings.settings.trustedPlugins.filter(value=>value!==id); const state=localInstalled.get(id); if(state) state.trusted=trusted; return structuredClone(settings) },
    launchPlugin: async id => { const state=localInstalled.get(id); if(!state) throw new Error('plugin not installed'); return {token:`token-${id}`,manifest:state.manifest,entryHtml:`<main><h1>${state.manifest.name}</h1></main>`,textAssets:{},trusted:state.trusted} },
    pluginSdkCall: async () => null,
    closePlugin: async () => undefined,
    generatePlugin: async request => ({manifest:structuredClone(request.currentDraft.manifest),files:{...request.currentDraft.files},explanation:'已根据需求生成插件草稿'})
  }
}
