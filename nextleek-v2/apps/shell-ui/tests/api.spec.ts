import { describe, expect, it } from 'vitest'
import { createMemoryApi } from '../src/api'

describe('memory adapter', () => {
  it('installs market plugins into the local list', async () => {
    const api = createMemoryApi([])
    expect(await api.listPlugins()).toEqual([])
    const catalog = await api.refreshMarket()
    const installed = await api.installMarketPlugin(catalog.plugins[0])
    expect(installed.manifest.id).toBe('com.example.clock')
    expect((await api.listPlugins()).map(plugin => plugin.manifest.id)).toEqual(['com.example.clock'])
  })

  it('persists marketplace URL without AI settings', async () => {
    const api = createMemoryApi([])
    const saved = await api.setMarketUrl('https://example.com/index.json')
    expect(saved.settings.marketUrl).toBe('https://example.com/index.json')
    expect(saved.settings).not.toHaveProperty('ai')
  })
})
