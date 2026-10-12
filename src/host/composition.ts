import type { Context, Fiber, Plugin } from '@deepseek-ai/cordis'
import { parse } from 'yaml'
import { dirname, join } from 'node:path'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { storagePlugin } from './services/storage'
import { commandsPlugin } from './services/commands'
import { searchPlugin } from './services/search'
import { pluginEndpointsPlugin } from './services/plugin-endpoints'
import { themePlugin } from '../../plugins/theme/host'
import { launcherPlugin } from '../../plugins/launcher/host'
import { settingsPlugin } from '../../plugins/settings/host'
import type { EverythingEnvironment } from './services/everything'
import type { ApplicationsEnvironment } from '../../plugins/applications/host'
import { marketPlugin } from '../../plugins/plugin-market/host'
import { commandShortcutsPlugin } from '../../plugins/command-shortcuts/host'
import type { DesktopService } from './services/contracts'
import type { CommandResult } from '../shared/contracts'
import { contributionsPlugin } from './services/contributions'
import { clientModulesPlugin } from './services/client-modules'
import { loadTrustedPlugin } from './trusted-plugin'

export interface PluginEntry {
  id: string
  name: string
  protected: boolean
  plugin: Plugin
  config?: unknown
  fiber?: Fiber
}
export interface CompositionEnvironment {
  path: string
  version: string
  desktop: DesktopService
  everything?: EverythingEnvironment
  applications?: ApplicationsEnvironment
  executeCommand(id: string): Promise<CommandResult>
}

// 核心适配器只注入原生环境；插件启用顺序与身份来自声明式配置。
export async function composePlugins(environment: CompositionEnvironment): Promise<PluginEntry[]> {
  const factories: Record<string, () => Plugin> = {
    'nexttools/storage': () => storagePlugin(environment.path),
    'nexttools/commands': () => commandsPlugin,
    'nexttools/plugin-endpoints': () => pluginEndpointsPlugin,
    'nexttools/search': () => searchPlugin,
    'nexttools/desktop': () => ({ name: 'desktop', apply(ctx: Context) { ctx.provide('desktop', environment.desktop) } }),
    'nexttools/contributions': () => contributionsPlugin,
    'nexttools/client-modules': () => clientModulesPlugin,
    'nexttools/settings': () => settingsPlugin,
    'nexttools/theme': () => themePlugin,
    'nexttools/plugin-market': () => marketPlugin({ directory: join(dirname(environment.path), 'plugins'), version: environment.version }),
    'nexttools/command-shortcuts': () => commandShortcutsPlugin(environment.executeCommand),
    'nexttools/builtin-search': () => launcherPlugin(environment.everything, environment.applications),
  }
  const require = createRequire(import.meta.url)
  const patchPath = require.resolve('nexttools/cordis.patch.yml')
  const document: unknown = parse(readFileSync(patchPath, 'utf8'))
  if (!Array.isArray(document) || document.some(item => !item || typeof item !== 'object' || !Array.isArray(item.insert))) throw new Error('Cordis patch requires insert arrays')
  const declarations: unknown[] = document.flatMap(item => item.insert)
  const ids = new Set<string>()
  return Promise.all(declarations.map(async (entry: unknown) => {
    if (!entry || typeof entry !== 'object') throw new Error('Invalid Cordis composition entry')
    const input = entry as Record<string, unknown>
    if (typeof input.id !== 'string' || !/^[a-zA-Z0-9_.-]+$/.test(input.id) || ids.has(input.id)) throw new Error('Cordis composition requires unique explicit IDs')
    if (typeof input.name !== 'string' || !input.name || (input.protected !== undefined && typeof input.protected !== 'boolean')) throw new Error(`Invalid Cordis plugin metadata: ${input.id}`)
    ids.add(input.id)
    const factory = factories[input.name]
    // 外部插件由部署配置选择，不能在核心中静态导入。
    const plugin = factory ? factory() : await loadTrustedPlugin(input.name, dirname(patchPath), environment.version, input.id)
    if (!plugin || (typeof plugin !== 'function' && typeof plugin !== 'object')) throw new Error(`Invalid Cordis module: ${input.name}`)
    return { id: input.id, name: typeof input.label === 'string' ? input.label : input.id, protected: input.protected === true, plugin: plugin, config: input.config }
  }))
}
