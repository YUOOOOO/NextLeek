import type { Context, Fiber } from '@deepseek-ai/cordis'
import type { KeyboardInputEvent } from 'electron'
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
    const sessions = new Map<string, { id: string; fiber: Fiber; view?: PluginViewHandle }>()
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
        if (method === 'getPluginMemoryInfo') {
          if (Object.keys(args).some(key => key !== 'id') || typeof args.id !== 'string' || !definitions.has(args.id)) throw new TypeError('Invalid trusted plugin identifier')
          for (const entry of sessions.values()) if (entry.id === args.id) return { success: true, data: entry.view?.memoryInfo() ?? null }
          return { success: true, data: null }
        }
        if (method === 'open') {
          const record = definitions.get(String(args.id))
          if (!record) throw new Error('Trusted browser module is unavailable')
          const session = randomUUID()
          let fiber!: Fiber
          fiber = record.owner.plugin({ name: `client-session-${session}`, async apply(owner: Context) {
            owner.effect(() => { sessions.set(session, { id: record.definition.metadata.id, fiber }); return () => { sessions.delete(session) } })
            const view = await ctx.desktop.openPluginView?.(owner, { session, html: record.definition.html, invoke: record.definition.invoke, closed: () => { void fiber.dispose() } })
            if (!view) throw new Error('Native plugin view is unavailable')
            const entry = sessions.get(session)
            if (entry) entry.view = view
          } })
          try { await fiber.await() } catch (error) { await fiber.dispose(); throw error }
          return { id: record.definition.metadata.id, name: record.definition.metadata.name, session, html: record.definition.html, commandId: args.commandId } as OpenPlugin
        }
        if (typeof args.session !== 'string' || !/^[a-f0-9-]{36}$/.test(args.session)) throw new TypeError('Invalid trusted plugin session')
        if (method === 'focus' || method === 'sendInputEvent' || method === 'detach' || method === 'openDevTools') {
          if (Object.keys(args).some(key => key !== 'session' && !(method === 'sendInputEvent' && key === 'event'))) throw new TypeError('Unexpected plugin view input field')
          const entry = sessions.get(args.session)
          if (!entry) throw new Error('Trusted plugin session is closed')
          if (!entry.view) throw new Error('Native plugin view is unavailable')
          if (method === 'focus') return entry.view.focus()
          if (method === 'detach') { entry.view.detach(); return { success: true } }
          if (method === 'openDevTools') { entry.view.openDevTools(); return { success: true } }
          if (!args.event || typeof args.event !== 'object' || Array.isArray(args.event)) throw new TypeError('Invalid keyboard event')
          const event = args.event as Record<string, unknown>
          if (Object.keys(event).some(key => !['type', 'keyCode', 'modifiers'].includes(key))) throw new TypeError('Unexpected keyboard event field')
          if (event.type !== 'keyDown' && event.type !== 'keyUp' && event.type !== 'char') throw new TypeError('Only keyboard input events are allowed')
          if (typeof event.keyCode !== 'string' || !event.keyCode || event.keyCode.length > 64 || /[\x00-\x1f]/.test(event.keyCode)) throw new TypeError('Invalid keyboard keyCode')
          const modifiers = event.modifiers
          const allowed = ['shift', 'control', 'ctrl', 'alt', 'meta', 'command', 'cmd', 'isKeypad', 'isAutoRepeat', 'capsLock', 'numLock'] as const
          if (modifiers !== undefined && (!Array.isArray(modifiers) || modifiers.length > allowed.length || !modifiers.every((value): value is typeof allowed[number] => typeof value === 'string' && allowed.some(allowedValue => allowedValue === value)) || new Set(modifiers).size !== modifiers.length)) throw new TypeError('Invalid keyboard modifiers')
          const keyboardEvent: KeyboardInputEvent = { type: event.type, keyCode: event.keyCode }
          if (modifiers !== undefined) keyboardEvent.modifiers = modifiers.map(value => value === 'isKeypad' ? 'iskeypad' : value === 'isAutoRepeat' ? 'isautorepeat' : value === 'capsLock' ? 'capslock' : value === 'numLock' ? 'numlock' : value)
          return entry.view.sendInputEvent(keyboardEvent)
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
