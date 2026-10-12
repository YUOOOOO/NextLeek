import type { Context } from '@deepseek-ai/cordis'
import type { Command, CommandResult } from '../../shared/contracts'
import type { CommandsService } from './contracts'

export const commandsPlugin = {
  name: 'commands',
  apply(ctx: Context) {
    const entries = new Map<string, { command: Command; execute: () => Promise<CommandResult> | CommandResult }>()
    const listeners = new Set<() => void>()
    // 注册与卸载都通知订阅方，快捷键和启动器共享同一份真实命令状态。
    const notify = () => { for (const callback of listeners) callback() }
    ctx.provide('commands', {
      register(owner, command, execute) {
        let remove = () => {}
        owner.effect(() => {
          if (entries.has(command.id)) throw new Error(`Duplicate command: ${command.id}`)
          const entry = { command: { ...command, keywords: [...command.keywords] }, execute }
          entries.set(command.id, entry)
          remove = () => {
            if (entries.get(command.id) !== entry) return
            entries.delete(command.id)
            notify()
          }
          notify()
          return remove
        }, `command ${command.id}`)
        return () => remove()
      },
      subscribe(owner, callback) {
        owner.effect(() => {
          listeners.add(callback)
          return () => { listeners.delete(callback) }
        }, 'command registry subscription')
      },
      list: () => [...entries.values()].map(({ command }) => ({ ...command, keywords: [...command.keywords] })),
      has: (id) => entries.has(id),
      async run(id) {
        const entry = entries.get(id)
        if (!entry) throw new Error(`Command unavailable: ${id}`)
        return { ...await entry.execute(), commandId: id }
      },
    } satisfies CommandsService)
  },
}
