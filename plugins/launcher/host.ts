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
    name: 'builtin-search', inject: ['search', 'commands', 'storage'],
    async apply(ctx: Context) {
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
