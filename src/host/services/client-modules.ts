import type { Context, Fiber } from '@deepseek-ai/cordis'
import { randomUUID } from 'node:crypto'
import type { InstalledPlugin, OpenPlugin } from '../../../plugins/plugin-market/shared'
import type { PluginViewHandle, PluginViewBounds } from './contracts'

export interface ClientModuleDefinition {
  metadata: InstalledPlugin
  html: string
  invoke(method: 'runtimeSummary' | 'invokeCapability', args: unknown): Promise<unknown>
}
export interface ClientModulesService {
  register(owner: Context, definition: ClientModuleDefinition): void
  list(): InstalledPlugin[]
  has(id: string): boolean
  ownsSession(session: string): boolean
  invoke(method: string, args: Record<string, unknown>): Promise<unknown>
}

// 可信双面插件与市场包共享原生视图桥，但拥有独立的能力授权与 Fiber。
export const clientModulesPlugin = {
  name: 'client-modules', inject: ['desktop', 'commands'],
  apply(ctx: Context) {
    const definitions = new Map<string, { owner: Context; definition: ClientModuleDefinition }>()
    const sessions = new Map<string, { fiber: Fiber; view?: PluginViewHandle }>()
    ctx.provide('clientModules', {
      register(owner, definition) {
        const id = definition.metadata.id
        owner.effect(() => {
          if (definitions.has(id)) throw new Error(`Duplicate browser module: ${id}`)
          definitions.set(id, { owner, definition })
          return () => { definitions.delete(id) }
        })
        const commandId = `client.${id.replace('/', '.')}.open`
        ctx.commands.register(owner, { id: commandId, pluginId: id, title: definition.metadata.name, description: definition.metadata.description, icon: 'blocks', keywords: [id, definition.metadata.name] }, () => ({ navigate: 'plugin-market', pluginId: id, commandId }))
      },
      list() { return [...definitions.values()].map(({ definition }) => ({ ...definition.metadata })) },
      has(id) { return definitions.has(id) },
      ownsSession(session) { return sessions.has(session) },
      async invoke(method, args) {
        if (method === 'open') {
          const record = definitions.get(String(args.id))
          if (!record) throw new Error('Trusted browser module is unavailable')
          const session = randomUUID()
          let fiber!: Fiber
          fiber = record.owner.plugin({ name: `client-session-${session}`, async apply(owner: Context) {
            owner.effect(() => { sessions.set(session, { fiber }); return () => { sessions.delete(session) } })
            const view = await ctx.desktop.openPluginView?.(owner, { session, html: record.definition.html, invoke: record.definition.invoke, closed: () => { void fiber.dispose() } })
            if (!view) throw new Error('Native plugin view is unavailable')
            const entry = sessions.get(session)
            if (entry) entry.view = view
          } })
          try { await fiber.await() } catch (error) { await fiber.dispose(); throw error }
          return { id: record.definition.metadata.id, name: record.definition.metadata.name, session, html: record.definition.html, commandId: args.commandId } as OpenPlugin
        }
        const session = sessions.get(String(args.session))
        if (!session) throw new Error('Trusted plugin session is closed')
        if (method === 'close') { await session.fiber.dispose(); return }
        if (method === 'viewVisible') {
          if (typeof args.visible !== 'boolean') throw new TypeError('Invalid view visibility')
          session.view?.visible(args.visible); return
        }
        if (method === 'viewBounds') {
          for (const key of ['x', 'y', 'width', 'height']) if (typeof args[key] !== 'number' || !Number.isFinite(args[key]) || Math.abs(args[key] as number) > 100000) throw new TypeError('Invalid view bounds')
          if ((args.width as number) < 0 || (args.height as number) < 0) throw new TypeError('Invalid view bounds')
          session.view?.bounds(args as unknown as PluginViewBounds); return
        }
        throw new Error(`Unsupported trusted client action: ${method}`)
      },
    } satisfies ClientModulesService)
  },
}

declare module '@deepseek-ai/cordis' {
  interface Context { clientModules: ClientModulesService }
}
