import { computed } from 'vue'
import { defineStore } from 'pinia'
import { useDesktopStore } from '../../../../../src/client/store'
import type { Command as DesktopCommand, LauncherSearchItem } from '../../../../../src/shared/contracts'

export interface Command {
  id: string
  name: string
  path: string
  icon?: string
  type: 'direct' | 'plugin' | 'builtin'
  subType?: 'app' | 'system-setting' | 'local-shortcut'
  featureCode?: string
  pluginName?: string
  pluginExplain?: string
  matches?: Array<{ indices: Array<[number, number]>; key: string; value: string }>
  matchType?: 'acronym' | 'name' | 'pinyin' | 'pinyinAbbr'
  providerId?: string
  searchItem?: LauncherSearchItem
  command?: DesktopCommand
}

// 将安全宿主指令映射到原版组件的展示结构，不按路径执行外部程序。
export function toSourceCommand(command: DesktopCommand): Command {
  return { id: command.id, name: command.title, path: command.id,
    icon: /^(data:image\/|https?:\/\/|desktop-icon:)/.test(command.icon) ? command.icon : undefined,
    type: command.pluginId ? 'plugin' : 'builtin', pluginName: command.pluginId,
    pluginExplain: command.description, command }
}

// 将提供者结果保留为原始授权动作，以供列表和键盘统一执行。
export function toSourceSearchItem(providerId: string, item: LauncherSearchItem): Command {
  return { id: `${providerId}:${item.id}`, name: item.name, path: item.path,
    icon: item.iconUrl, type: 'direct', subType: 'app', providerId, searchItem: item }
}

export const useCommandDataStore = defineStore('ztools-launcher-commands', () => {
  const desktop = useDesktopStore()
  // 查询排序、最近使用和固定状态均由共享桌面契约提供。
  const results = computed(() => desktop.results.map(toSourceCommand))
  const recent = computed(() => desktop.recentCommands.map(toSourceCommand))
  const pinned = computed(() => desktop.pinnedCommands.map(toSourceCommand))
  const all = computed(() => desktop.commands.map(toSourceCommand))
  const groups = computed(() => desktop.searchGroups.map(group => ({ ...group,
    items: group.items.map(item => toSourceSearchItem(group.providerId, item)) })))
  // 仅执行当前提供者公开的首个动作或注册指令。
  async function run(item: Command): Promise<void> {
    if (item.command) await desktop.run(item.command)
    else if (item.providerId && item.searchItem && item.searchItem.actions[0]) {
      await desktop.performSearchAction(item.providerId, item.searchItem, item.searchItem.actions[0].id)
    }
  }
  // 固定操作只接受宿主注册指令，文件提供者不支持固定。
  async function togglePin(item: Command): Promise<void> {
    if (item.command) await desktop.pin(item.command)
  }
  return { results, recent, pinned, all, groups, run, togglePin }
})
