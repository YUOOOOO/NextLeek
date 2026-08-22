import { describe, expect, it } from 'vitest'
import { createMemoryApi } from '../src/api'

describe('memory adapter', () => {
  it('keeps creator drafts isolated from installed plugins', async () => {
    const api = createMemoryApi([])
    await api.createDraft('safe', { id:'com.example.safe',name:'Safe',version:'0.1.0',entry:'ui/index.html',capabilities:[],permissions:[] })
    expect((await api.validateDraft('safe')).valid).toBe(true)
    expect(await api.listPlugins()).toEqual([])
  })
})
