import { describe, expect, it } from 'vitest'
import type { PluginState } from '../src/api'
import { searchHits } from '../src/search'

const dashboard: PluginState = {
  builtin: true,
  trusted: true,
  manifest: {
    id: 'com.nextleek.dashboard',
    name: '仪表盘',
    version: '1.0.0',
    entry: 'ui/index.html',
    capabilities: [],
    permissions: [],
    cmds: [{ code: 'open', label: '仪表盘', matches: ['dashboard'] }],
  },
}

describe('searchHits', () => {
  it('lists plugin and host commands when the query is empty', () => {
    const labels = searchHits('', [dashboard]).map(hit => hit.label)
    expect(labels).toEqual(expect.arrayContaining(['仪表盘', '插件市场', '设置']))
  })

  it('ranks market above settings for 市场', () => {
    const hits = searchHits('市场', [dashboard])
    expect(hits[0]?.id).toBe('host:market')
    expect(hits.some(hit => hit.id === 'host:settings')).toBe(false)
  })

  it('matches plugin aliases', () => {
    expect(searchHits('dashboard', [dashboard])[0]?.pluginId).toBe('com.nextleek.dashboard')
  })
})
