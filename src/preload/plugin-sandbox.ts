import { contextBridge, ipcRenderer } from 'electron'

const session = process.argv.find(argument => argument.startsWith('--plugin-session='))?.slice('--plugin-session='.length)
if (!session || !/^[a-f0-9-]{36}$/.test(session)) throw new Error('Missing plugin sandbox session')
const channel = `nexttools:plugin-sandbox:${session}`
let pending = 0

// 专用桥只允许包声明能力和只读概况，不暴露频道名、宿主 desktop 或凭据配置。
async function request(method: 'runtimeSummary' | 'invokeCapability', args: unknown): Promise<unknown> {
  if (pending >= 64) throw new Error('Too many pending runtime requests')
  pending++
  try { return await ipcRenderer.invoke(channel, method, args) } finally { pending-- }
}
contextBridge.exposeInMainWorld('nextleek', Object.freeze({
  runtimeSummary: () => request('runtimeSummary', null),
  invokeCapability: (sourcePluginId: string, sourceId: string, method: string, args: unknown = {}) => request('invokeCapability', { sourcePluginId, sourceId, method, args }),
  invokeTool: (name: string, args: unknown = {}) => request('invokeCapability', { kind: 'tools', name, args }),
  readSkill: (name: string) => request('invokeCapability', { kind: 'skills', name, args: {} }),
}))
