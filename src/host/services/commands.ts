import type { Context } from '@deepseek-ai/cordis'
import type { Command, CommandResult } from '../../shared/contracts'
import type { CommandsService } from './contracts'

export const commandsPlugin = {
  name: 'commands',
  apply(ctx: Context) {
    const entries = new Map<string, { command: Command; execute: () => Promise<CommandResult> | CommandResult }>()
    ctx.provide('commands', {
      register(owner, command, execute) {
        owner.effect(() => {
          if (entries.has(command.id)) throw new Error(`Duplicate command: ${command.id}`)
          entries.set(command.id, { command, execute })
          return () => { entries.delete(command.id) }
        }, `command ${command.id}`)
      },
      list: () => [...entries.values()].map(({ command }) => ({ ...command, keywords: [...command.keywords] })),
      has: (id) => entries.has(id),
      async run(id) {
        const entry = entries.get(id)
        if (!entry) throw new Error(`Command unavailable: ${id}`)
        return entry.execute()
      },
    } satisfies CommandsService)
  },
}
