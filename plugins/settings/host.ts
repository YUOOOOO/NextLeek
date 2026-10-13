import type { Context } from '@deepseek-ai/cordis'
import type { Settings } from '../../src/shared/contracts'
import { settingsPatch } from '../../src/shared/validation'
import { commandAccelerator } from '../command-shortcuts/host'
import type { Dialog } from 'electron'
import { SettingsDocuments } from './documents'
import { installSettingsEndpoints } from './service'


export interface SettingsService {
  update(patch: Partial<Settings>): Promise<void>
  getDocument(key: string): unknown
  subscribe(owner: Context, callback: (key: string, value: unknown) => void): void
}

declare module '@deepseek-ai/cordis' {
  interface Context { settings: SettingsService }
}

// 设置插件拥有校验、快捷键冲突与持久化事务，宿主只执行原生设置。
export interface SettingsPluginOptions {
  documentsPath: string
  dialogs?: Dialog
  version?: string
  fileIcon?: (path: string) => Promise<string>
  openPath?: (path: string) => Promise<string>
  registerStartup?: (callback: () => Promise<void>) => void
}
export function createSettingsPlugin(options: SettingsPluginOptions) {
return {
  name: 'settings', inject: ['storage', 'desktop', 'commands', 'pluginEndpoints'],
  apply(ctx: Context) {
    const documents = new SettingsDocuments(options.documentsPath)
    const listeners = new Set<(key: string, value: unknown) => void>()
    ctx.provide('settings', {
      async update(patch: Partial<Settings>) {
        const validated = settingsPatch(patch)
        const state = ctx.storage.read()
        const next = { ...state.settings, ...validated }
        if (validated.hotkey !== undefined) {
          const wake = commandAccelerator(next.hotkey)
          const conflict = ctx.storage.readShortcuts().find(item => commandAccelerator(item.global) === wake || commandAccelerator(item.application) === wake)
          if (conflict) throw new Error(`唤醒快捷键已绑定命令 ${conflict.commandId}，请先清除命令快捷键`)
        }
        await ctx.desktop.applySettings(next, state.settings)
        try { ctx.storage.write({ ...state, settings: next }) }
        catch (error) { await ctx.desktop.applySettings(state.settings, next); throw error }
      },
      getDocument(key: string) { return documents.get(key) },
      subscribe(owner: Context, callback: (key: string, value: unknown) => void) {
        owner.effect(() => { listeners.add(callback); return () => listeners.delete(callback) }, 'settings document subscription')
      },
    })
    const startup = installSettingsEndpoints(ctx, documents, (key, value) => {
      for (const callback of listeners) callback(key, value)
      ctx.desktop.emit({ type: 'source-event', name: 'settings-document-changed', payload: { key, value } })
      if (key === 'local-shortcuts') ctx.desktop.emit({ type: 'source-event', name: 'local-shortcuts-changed', payload: value })
    }, options)
    if (options.registerStartup) options.registerStartup(startup)
    else ctx.effect(() => {
      const pendingStartup = startup().catch(error => console.error('Settings startup failed', error))
      // 卸载时等待启动任务结束，避免启动工作脱离插件生命周期。
      return () => pendingStartup
    }, 'settings startup')
    ctx.commands.register(ctx, { id: 'settings.open', title: '设置', description: '快捷键、外观与启动偏好', icon: 'settings', keywords: ['settings', '设置', 'shezhi'], pluginId: 'settings' }, () => ({ navigate: 'settings' }))
    ctx.commands.register(ctx, { id: 'plugins.open', title: '插件管理', description: '查看真实插件状态和管理本地插件', icon: 'blocks', keywords: ['plugins', '插件', 'chajian'], pluginId: 'settings' }, () => ({ navigate: 'plugins' }))
  },
}
}
