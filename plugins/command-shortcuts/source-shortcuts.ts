import { createHash } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import { commandAccelerator } from './host'

// 原版快捷键 target 保留，底层注册统一落到现有命令快捷键事务。
export function installSourceShortcuts(ctx: Context) {
  const flags = new Map<string, { autoCopy: boolean; preScreenshotOptimization: boolean }>()
  async function resolveTarget(target: string): Promise<string> {
    const commands = ctx.commands.list()
    const command = commands.find(item => item.id === target || `${item.pluginId}/${item.title}` === target || item.title === target || item.keywords.some(word => `${item.pluginId}/${word}` === target))
    if (command) return command.id
    const locals = ctx.settings.getDocument('local-shortcuts')
    const local = Array.isArray(locals) && locals.find(item => item && typeof item === 'object' && (item.path === target || item.name === target || item.alias === target))
    const apps = await ctx.pluginEndpoints.invoke('applications', 'getApps', null)
    const app = Array.isArray(apps) && apps.find(item => item && typeof item === 'object' && (item.path === target || item.name === target))
    const setting = ctx.desktop.settingsNative?.getSystemSettings().find(item => item.uri === target || item.name === target)
    if (!local && !app && !setting) throw new Error(`快捷键目标不可用：${target}`)
    const id = `source-target.${createHash('sha256').update(target).digest('hex').slice(0, 20)}`
    if (!ctx.commands.has(id)) ctx.commands.register(ctx, { id, title: target, description: '用户授权的直接启动快捷键', keywords: [], icon: 'settings', pluginId: 'command-shortcuts' }, async () => {
      if (local) await ctx.pluginEndpoints.invoke('settings', 'openLocalShortcut', { path: local.path })
      else if (app) await ctx.pluginEndpoints.invoke('applications', 'launch', { path: app.path })
      else if (setting) await ctx.desktop.settingsNative!.launchSystemSetting(setting.uri)
      return {}
    })
    return id
  }
  async function beforeExecute(commandId: string) {
    const binding = ctx.storage.readShortcuts().find(item => item.commandId === commandId)
    const stored = ctx.settings.getDocument('global-shortcuts')
    const config = Array.isArray(stored) && stored.find(item => item && typeof item === 'object' && typeof item.shortcut === 'string' && commandAccelerator(item.shortcut) === binding?.global)
    const selected = flags.get(commandId) ?? (config ? { autoCopy: config.autoCopy === true, preScreenshotOptimization: config.preScreenshotOptimization === true } : undefined)
    if (!selected || (!selected.autoCopy && !selected.preScreenshotOptimization)) return
    const prepare = ctx.desktop.settingsNative?.prepareShortcut
    if (!prepare) throw new Error('Native shortcut preprocessing unavailable')
    await prepare(selected)
  }
  async function invoke(method: string, args: unknown[]): Promise<unknown> {
    if (method === 'beforeExecute') { if (typeof args[0] !== 'string') throw new TypeError('Command id required'); await beforeExecute(args[0]); return { success: true } }
    const accelerator = commandAccelerator(args[0])
    if (!accelerator) throw new TypeError('Shortcut accelerator required')
    const bindings = await ctx.pluginEndpoints.invoke('command-shortcuts', 'list', null) as Array<{commandId: string; global: string | null; application: string | null}>
    const global = method.includes('Global')
    if (method.startsWith('unregister')) {
      const binding = bindings.find(item => item[global ? 'global' : 'application'] === accelerator)
      if (binding) await ctx.pluginEndpoints.invoke('command-shortcuts', 'set', { ...binding, [global ? 'global' : 'application']: null })
      return { success: true }
    }
    let id: string
    let nextFlags = { autoCopy: args[2] === true, preScreenshotOptimization: args[3] === true }
    if (method === 'updateGlobalShortcutConfig') {
      const binding = bindings.find(item => item.global === accelerator)
      if (!binding) throw new Error('全局快捷键未注册')
      id = binding.commandId
      const config = args[1]
      if (!config || typeof config !== 'object' || !('autoCopy' in config) || !('preScreenshotOptimization' in config)) throw new TypeError('Invalid shortcut configuration')
      nextFlags = { autoCopy: config.autoCopy === true, preScreenshotOptimization: config.preScreenshotOptimization === true }
    } else {
      if (typeof args[1] !== 'string') throw new TypeError('Shortcut target required')
      id = await resolveTarget(args[1])
    }
    if ((nextFlags.autoCopy || nextFlags.preScreenshotOptimization) && !ctx.desktop.settingsNative?.prepareShortcut) throw new Error('Native shortcut preprocessing unavailable')
    const existing = bindings.find(item => item.commandId === id) ?? { commandId: id, global: null, application: null }
    await ctx.pluginEndpoints.invoke('command-shortcuts', 'set', { ...existing, [global ? 'global' : 'application']: accelerator })
    if (global) flags.set(id, nextFlags)
    return { success: true }
  }
  let restoring = false
  async function restoreTargets() {
    if (restoring) return
    restoring = true
    try {
      for (const key of ['global-shortcuts', 'app-shortcuts']) {
        const records = ctx.settings.getDocument(key)
        if (!Array.isArray(records)) continue
        for (const record of records) {
          if (!record || typeof record !== 'object' || typeof record.target !== 'string') continue
          // 已保存绑定以稳定命令 ID 恢复；无需再按可能改名的显示文本重建目标。
          const scope = key === 'global-shortcuts' ? 'global' : 'application'
          const binding = typeof record.shortcut === 'string' && ctx.storage.readShortcuts().find(item => item[scope] === commandAccelerator(record.shortcut))
          if (binding && ctx.commands.has(binding.commandId)) continue
          try { await resolveTarget(record.target) }
          catch (error) { console.error('恢复快捷键目标失败:', record.target, error) }
        }
      }
    } finally { restoring = false }
  }
  ctx.commands.subscribe(ctx, () => { void restoreTargets() })
  ctx.settings.subscribe(ctx, key => { if (key === 'global-shortcuts' || key === 'app-shortcuts') void restoreTargets() })
  void restoreTargets()
  return { invoke, beforeExecute }
}
