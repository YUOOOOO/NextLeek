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
  glyph: string
  tone: string
}

const TILE_TONES = ['#4c8dff', '#6d7cff', '#38bdf8', '#a78bfa', '#f59e0b', '#fb7185', '#818cf8']

export function tileTone(id: string): string {
  let hash = 2166136261
  for (let i = 0; i < id.length; i += 1) hash = Math.imul(hash ^ id.charCodeAt(i), 16777619)
  return TILE_TONES[(hash >>> 0) % TILE_TONES.length]
}


export const HOST_COMMANDS: SearchHit[] = [
  { id: 'host:market', kind: 'host', code: 'market', label: '插件市场', subtitle: '安装与管理插件', score: 0, glyph: '市', tone: tileTone('host:market') },
  { id: 'host:settings', kind: 'host', code: 'settings', label: '设置', subtitle: '市场地址、信任与更新', score: 0, glyph: '设', tone: tileTone('host:settings') },
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
    commandsOf(plugin.manifest).map(cmd => {
      const id = `${plugin.manifest.id}:${cmd.code}`
      const label = cmd.label
      return {
        id,
        kind: 'plugin' as const,
        pluginId: plugin.manifest.id,
        code: cmd.code,
        label,
        subtitle: plugin.manifest.name,
        score: scoreText(query, [label, plugin.manifest.name, ...(cmd.matches ?? [])]),
        glyph: Array.from((label || plugin.manifest.name).trim())[0] ?? '?',
        tone: tileTone(id),
      }
    }),
  )
  const hostHits = HOST_COMMANDS.map(hit => ({
    ...hit,
    score: scoreText(query, [hit.label, hit.code]),
  }))
  return [...pluginHits, ...hostHits]
    .filter(hit => hit.score > 0)
    .sort((left, right) => right.score - left.score || left.label.localeCompare(right.label, 'zh'))
}
