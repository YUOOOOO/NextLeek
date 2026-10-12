import type { Context } from '@deepseek-ai/cordis'
import type { CommandResult } from '../../shared/contracts'
import { identifier } from '../../shared/validation'
import type { CommandShortcut } from '../services/contracts'

// 统一键名和修饰键顺序，避免 Ctrl/Control 或大小写绕过冲突检测。
export function commandAccelerator(value: unknown): string | null {
  if (value === null) return null
  if (typeof value !== 'string' || value.length > 80) throw new TypeError('快捷键必须是有效的按键组合或 null')
  const parts = value.split('+')
  const key = parts.pop()!.toLowerCase()
  const modifiers = new Set<string>()
  const aliases: Record<string, string> = { ctrl: 'Control', control: 'Control', alt: 'Alt', option: 'Alt', shift: 'Shift', meta: 'Meta', super: 'Meta', command: 'Meta', cmd: 'Meta', commandorcontrol: process.platform === 'darwin' ? 'Meta' : 'Control', cmdorctrl: process.platform === 'darwin' ? 'Meta' : 'Control' }
  for (const part of parts) {
    const modifier = aliases[part.toLowerCase()]
    if (!modifier || modifiers.has(modifier)) throw new TypeError('快捷键包含无效或重复修饰键')
    modifiers.add(modifier)
  }
  const keys: Record<string, string> = { space: 'Space', tab: 'Tab', enter: 'Enter', up: 'Up', down: 'Down', left: 'Left', right: 'Right', arrowup: 'Up', arrowdown: 'Down', arrowleft: 'Left', arrowright: 'Right', backspace: 'Backspace', delete: 'Delete', home: 'Home', end: 'End', pageup: 'PageUp', pagedown: 'PageDown' }
  const normalizedKey = /^[a-z0-9]$/.test(key) || /^f(?:[1-9]|1[0-9]|2[0-4])$/.test(key) ? key.toUpperCase() : keys[key]
  if (!normalizedKey || (!modifiers.size && !/^F/.test(normalizedKey))) throw new TypeError('快捷键需要修饰键，或使用 F1–F24 功能键；Esc 保留用于返回')
  return [...['Control', 'Alt', 'Shift', 'Meta'].filter(item => modifiers.has(item)), normalizedKey].join('+')
}

export function commandShortcutsPlugin(execute: (id: string) => Promise<CommandResult>) {
  return {
    name: 'command-shortcuts', inject: ['storage', 'commands', 'pluginEndpoints', 'desktop'],
    apply(ctx: Context) {
      const bindings = new Map<string, CommandShortcut>()
      const registrations = new Map<string, { accelerator: string; dispose: () => void }>()
      const failures = new Map<string, string>()
      for (const saved of ctx.storage.readShortcuts()) {
        const commandId = identifier(saved.commandId)
        if (bindings.has(commandId)) throw new Error(`重复命令快捷键配置：${commandId}`)
        bindings.set(commandId, { commandId, global: commandAccelerator(saved.global), application: commandAccelerator(saved.application) })
      }
      // 不可用命令保留配置，但绝不保留系统注册；重启时注册失败可在列表查看。
      function reconcile(): void {
        for (const [id, registration] of registrations) {
          if (ctx.commands.has(id) && bindings.get(id)?.global === registration.accelerator) continue
          registration.dispose()
          registrations.delete(id)
          failures.delete(id)
        }
        for (const binding of bindings.values()) {
          if (!binding.global || !ctx.commands.has(binding.commandId) || registrations.has(binding.commandId)) continue
          try {
            if (!ctx.desktop.registerCommandShortcut) throw new Error('当前宿主不支持全局快捷键')
            const dispose = ctx.desktop.registerCommandShortcut(binding.global, binding.commandId)
            registrations.set(binding.commandId, { accelerator: binding.global, dispose })
            failures.delete(binding.commandId)
          } catch (error) { failures.set(binding.commandId, error instanceof Error ? error.message : String(error)) }
        }
      }
      ctx.effect(() => () => {
        for (const registration of registrations.values()) registration.dispose()
        registrations.clear()
      }, 'command global shortcuts')
      ctx.commands.subscribe(ctx, reconcile)
      reconcile()
      ctx.pluginEndpoints.register(ctx, 'command-shortcuts', async (method, args) => {
        if (method === 'list') {
          if (args !== null) throw new TypeError('list takes null')
          const ids = new Set([...ctx.commands.list().map(command => command.id), ...bindings.keys()])
          return [...ids].map(commandId => ({ ...(bindings.get(commandId) ?? { commandId, global: null, application: null }), ...(failures.has(commandId) ? { error: failures.get(commandId) } : {}) }))
        }
        if (!args || typeof args !== 'object' || Array.isArray(args)) throw new TypeError('Expected shortcut arguments')
        const input = args as Record<string, unknown>
        if (method === 'dispatch') {
          const accelerator = commandAccelerator(input.accelerator)
          const binding = [...bindings.values()].find(item => item.application === accelerator && accelerator !== null && ctx.commands.has(item.commandId))
          return binding ? execute(binding.commandId) : null
        }
        if (method !== 'set') throw new Error(`Unknown shortcut method: ${method}`)
        const commandId = identifier(input.commandId)
        const next = { commandId, global: commandAccelerator(input.global), application: commandAccelerator(input.application) }
        if (!ctx.commands.has(commandId) && (next.global || next.application)) throw new Error(`命令不可用，请启用或安装对应插件：${commandId}`)
        const wake = commandAccelerator(ctx.storage.read().settings.hotkey)
        for (const scope of ['global', 'application'] as const) {
          if (!next[scope]) continue
          if (next[scope] === wake) throw new Error('该快捷键已用于唤醒启动器，请先修改唤醒快捷键')
          const conflict = [...bindings.values()].find(item => item.commandId !== commandId && item[scope] === next[scope])
          if (conflict) throw new Error(`快捷键 ${next[scope]} 已绑定命令 ${conflict.commandId}，请先清除该绑定`)
        }
        const previous = registrations.get(commandId)
        let acquired: { accelerator: string; dispose: () => void } | undefined
        // 先获得新系统注册，再提交持久化；任何失败都不破坏旧绑定。
        if (next.global && previous?.accelerator !== next.global) {
          if (!ctx.desktop.registerCommandShortcut) throw new Error('当前宿主不支持全局快捷键，无法保存此配置')
          acquired = { accelerator: next.global, dispose: ctx.desktop.registerCommandShortcut(next.global, commandId) }
        }
        const updated = [...bindings.values()].filter(item => item.commandId !== commandId)
        if (next.global || next.application) updated.push(next)
        try { ctx.storage.writeShortcuts(updated) } catch (error) { acquired?.dispose(); throw error }
        if (previous && previous.accelerator !== next.global) { previous.dispose(); registrations.delete(commandId) }
        if (acquired) registrations.set(commandId, acquired)
        if (next.global || next.application) bindings.set(commandId, next)
        else bindings.delete(commandId)
        failures.delete(commandId)
        return next
      })
      ctx.commands.register(ctx, { id: 'command-shortcuts.open', pluginId: 'command-shortcuts', title: '命令快捷键', description: '配置插件命令的全局与应用内快捷键', icon: 'settings', keywords: ['快捷键', 'shortcuts', 'hotkey'] }, () => ({ navigate: 'settings' }))
    },
  }
}
