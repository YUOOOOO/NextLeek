import type { Context } from '@deepseek-ai/cordis'

export interface ToolDefinition {
  description: string
  parameters: Record<string, unknown>
  execute(args: Record<string, unknown>): unknown | Promise<unknown>
}
export interface ContributionsService {
  register(owner: Context, name: string, definition: ToolDefinition | string): void
  has(name: string, owner?: Context): boolean
  invoke(name: string, args: Record<string, unknown>): Promise<unknown>
}

// 注册必须传入调用插件作用域，工具与技能随该 Fiber 卸载而撤销。
export const contributionsPlugin = {
  name: 'contributions',
  apply(ctx: Context) {
    for (const serviceName of ['tools', 'skills'] as const) {
      const entries = new Map<string, { owner: Context; definition: ToolDefinition | string }>()
      ctx.provide(serviceName, {
        register(owner: Context, name: string, definition: ToolDefinition | string) {
          if (!name || entries.has(name)) throw new Error(`Duplicate or empty ${serviceName} contribution: ${name}`)
          if (serviceName === 'tools' && (!definition || typeof definition !== 'object' || typeof definition.execute !== 'function')) throw new TypeError('Tool requires an execute function')
          if (serviceName === 'skills' && typeof definition !== 'string') throw new TypeError('Skill requires content')
          const entry = { owner, definition }
          owner.effect(() => { entries.set(name, entry); return () => { if (entries.get(name) === entry) entries.delete(name) } })
        },
        has(name: string, owner?: Context) {
          const entry = entries.get(name)
          if (!entry) return false
          if (!owner) return true
          // 声明可由插件自身或其子 Fiber 注册，不能借用其他插件的贡献。
          let fiber = entry.owner.fiber
          for (;;) {
            if (fiber === owner.fiber) return true
            if (fiber === fiber.parent.fiber) return false
            fiber = fiber.parent.fiber
          }
        },
        async invoke(name: string, args: Record<string, unknown>) {
          const entry = entries.get(name)
          if (!entry) throw new Error(`Unavailable ${serviceName} contribution: ${name}`)
          return typeof entry.definition === 'string' ? entry.definition : entry.definition.execute(args)
        },
      } satisfies ContributionsService)
    }
  },
}

declare module '@deepseek-ai/cordis' {
  interface Context { tools: ContributionsService; skills: ContributionsService }
}
