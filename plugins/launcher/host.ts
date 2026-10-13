import type { Context } from '@deepseek-ai/cordis'
import { everythingPlugin, type EverythingEnvironment } from '../../src/host/services/everything'
import { applicationsPlugin, type ApplicationsEnvironment } from '../applications/host'
import { everythingSearchPlugin } from '../file-search/host'
import { boolean, identifier } from '../../src/shared/validation'

export interface LauncherService {
  recordCommand(id: string): void
  setPinned(id: string, pinned: boolean): void
}

declare module '@deepseek-ai/cordis' {
  interface Context { launcher: LauncherService }
}

// 搜索业务拥有提供者子 Fiber、最近指令和固定项，退出一并释放。
export function launcherPlugin(everything?: EverythingEnvironment, applications?: ApplicationsEnvironment) {
  return {
    name: 'builtin-search', inject: ['search', 'commands', 'storage', 'pluginEndpoints'],
    async apply(ctx: Context) {
      // 使用设置插件的真实数据库保存上游对象，应用路径不降级成指令 ID。
      const readDocument = async (key: string): Promise<unknown[]> => {
        const value = await ctx.pluginEndpoints.invoke('settings', 'dbGet', { key })
        return Array.isArray(value) ? value : []
      }
      const writeDocument = (key: string, value: unknown[]) => ctx.pluginEndpoints.invoke('settings', 'dbPut', { key, value })
      const record = (value: unknown): Record<string, unknown> => {
        if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('指令对象无效')
        return value as Record<string, unknown>
      }
      ctx.pluginEndpoints.register(ctx, 'builtin-search', async (method, raw) => {
        const args = Array.isArray(raw) ? raw : [raw]
        if (method === 'getUsageStats') return readDocument('command-history')
        if (method === 'getSuperPanelPinned') return readDocument('super-panel-pinned')
        const superPanel = method.includes('SuperPanel')
        const key = method === 'recordSourceCommand' || method === 'removeFromHistory' ? 'command-history' : superPanel ? 'super-panel-pinned' : 'pinned-commands'
        const values = (await readDocument(key)).map(record)
        if (method === 'recordSourceCommand') {
          const target = record(raw)
          if (typeof target.path !== 'string' || typeof target.name !== 'string') throw new TypeError('历史指令无效')
          const existing = values.find(item => item.path === target.path && item.featureCode === target.featureCode)
          const entry = { ...target, lastUsed: Date.now(), count: Number(existing?.count ?? existing?.useCount ?? 0) + 1 }
          await writeDocument(key, [entry, ...values.filter(item => item !== existing)].slice(0, 100))
          return
        }
        if (method === 'pinApp' || method === 'pinToSuperPanel') {
          const target = record(args[0])
          if (typeof target.path !== 'string' || typeof target.name !== 'string') throw new TypeError('固定指令无效')
          await writeDocument(key, [...values.filter(item => !(item.path === target.path && item.featureCode === target.featureCode && item.name === target.name)), target])
          return
        }
        if (method === 'unpinApp' || method === 'unpinSuperPanelCommand' || method === 'removeFromHistory') {
          const [target, featureCode, name] = args
          if (typeof target !== 'string') throw new TypeError('指令路径无效')
          await writeDocument(key, values.filter(item => !(item.path === target && (featureCode === undefined || item.featureCode === featureCode) && (name === undefined || item.name === name))))
          return
        }
        if (method === 'updatePinnedOrder' || method === 'updateSuperPanelPinnedOrder') {
          if (!Array.isArray(args[0])) throw new TypeError('固定顺序无效')
          const requested = args[0].map(record)
          if (requested.length !== values.length || requested.some(item => !values.some(existing => existing.path === item.path && existing.featureCode === item.featureCode && existing.name === item.name))) throw new Error('固定顺序与当前列表不一致')
          await writeDocument(key, requested)
          return
        }
        throw new Error(`未知搜索业务方法：${method}`)
      })
      ctx.provide('launcher', {
        recordCommand(id: string) {
          const state = ctx.storage.read()
          ctx.storage.write({ ...state, recent: [id, ...state.recent.filter(item => item !== id)].slice(0, 50) })
        },
        setPinned(id: string, pinned: boolean) {
          identifier(id); boolean(pinned)
          if (!ctx.commands.has(id)) throw new Error(`Command unavailable: ${id}`)
          const state = ctx.storage.read()
          const pins = state.pinned.filter(item => item !== id)
          if (pinned) pins.push(id)
          ctx.storage.write({ ...state, pinned: pins })
        },
      })
      ctx.commands.register(ctx, { id: 'builtin-search.open', pluginId: 'builtin-search', title: '搜索', description: '搜索已安装应用和文件', icon: 'search', keywords: ['搜索', '文件', '应用', 'search'] }, () => ({ navigate: 'launcher' }))
      await ctx.plugin(everythingPlugin(everything)).await()
      await ctx.plugin(everythingSearchPlugin).await()
      if (applications) await ctx.plugin(applicationsPlugin(applications)).await()
    },
  }
}
