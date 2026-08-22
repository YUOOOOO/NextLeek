export interface PluginManifest { id:string; name:string; version:string; entry:string; capabilities:string[]; permissions:string[] }
export interface RuntimeSummary { pluginCount:number; mode:string }
export interface ValidationReport { valid:boolean; errors:string[] }
export interface PackageInventory { pluginId:string; version:string; files:string[] }
export interface KernelApi {
  runtimeSummary():Promise<RuntimeSummary>
  listPlugins():Promise<PluginManifest[]>
  createDraft(id:string, manifest:PluginManifest):Promise<void>
  validateDraft(id:string):Promise<ValidationReport>
  packageDraft(id:string):Promise<PackageInventory>
}

export async function createTauriApi(): Promise<KernelApi> {
  const { invoke } = await import('@tauri-apps/api/core')
  return {
    runtimeSummary: () => invoke<RuntimeSummary>('runtime_summary_command'),
    listPlugins: () => invoke<PluginManifest[]>('list_plugins_command'),
    createDraft: (draftId, manifest) => invoke<void>('create_draft_command', { draftId, manifest }),
    validateDraft: draftId => invoke<ValidationReport>('validate_draft_command', { draftId }),
    packageDraft: draftId => invoke<PackageInventory>('package_draft_command', { draftId })
  }
}

export function createMemoryApi(installed:PluginManifest[]):KernelApi {
  const drafts = new Map<string, PluginManifest>()
  return {
    runtimeSummary: async () => ({ pluginCount:installed.length, mode:'declarative-only' }),
    listPlugins: async () => [...installed],
    createDraft: async (id, manifest) => { if (id.includes('..')) throw new Error('unsafe draft id'); drafts.set(id, structuredClone(manifest)) },
    validateDraft: async id => ({ valid:drafts.has(id), errors:drafts.has(id) ? [] : ['draft not found'] }),
    packageDraft: async id => { const manifest=drafts.get(id); if(!manifest) throw new Error('draft not found'); return {pluginId:manifest.id,version:manifest.version,files:['manifest.json']} }
  }
}
