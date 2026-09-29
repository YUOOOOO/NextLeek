import type { PluginManifest, PluginState } from './api'

export type PluginCmd = { code: string; label: string; matches?: string[] }

export type SearchHit = {
  id: string
  kind: 'plugin' | 'host'
  pluginId?: string
  code: string
  label: string
  subtitle: string
  score: number
}

export const HOST_COMMANDS: SearchHit[] = [
  { id: 'host:market', kind: 'host', code: 'market', label: '插件市场', subtitle: '安装与管理插件', score: 0 },
  { id: 'host:settings', kind: 'host', code: 'settings', label: '设置', subtitle: '市场地址、信任与更新', score: 0 },
]

export function commandsOf(manifest: PluginManifest): PluginCmd[] {
  if (manifest.cmds?.length) return manifest.cmds
  return [{ code: 'open', label: manifest.name, matches: [manifest.name] }]
}

function scoreText(query: string, values: string[]): number {
  const q = query.trim().toLowerCase()
  if (!q) return 1
  let best = 0
  for (const raw of values) {
    const value = raw.toLowerCase()
    if (value === q) best = Math.max(best, 100)
    else if (value.startsWith(q)) best = Math.max(best, 80)
    else if (value.includes(q)) best = Math.max(best, 50)
  }
  return best
}

export function searchHits(query: string, plugins: PluginState[]): SearchHit[] {
  const pluginHits = plugins.flatMap(plugin =>
    commandsOf(plugin.manifest).map(cmd => ({
      id: `${plugin.manifest.id}:${cmd.code}`,
      kind: 'plugin' as const,
      pluginId: plugin.manifest.id,
      code: cmd.code,
      label: cmd.label,
      subtitle: plugin.manifest.name,
      score: scoreText(query, [cmd.label, plugin.manifest.name, ...(cmd.matches ?? [])]),
    })),
  )
  const hostHits = HOST_COMMANDS.map(hit => ({
    ...hit,
    score: scoreText(query, [hit.label, hit.code]),
  }))
  return [...pluginHits, ...hostHits]
    .filter(hit => hit.score > 0)
    .sort((left, right) => right.score - left.score || left.label.localeCompare(right.label, 'zh'))
}
