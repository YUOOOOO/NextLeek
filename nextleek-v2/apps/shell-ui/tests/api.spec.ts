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
  it('round-trips AI settings and returns a draft-only generation result', async () => {
    const api = createMemoryApi([])
    const settings = {enabled:true, baseUrl:'https://example.com/v1', apiKey:'secret', model:'demo', temperature:0.3}
    await api.setAiSettings(settings)
    expect((await api.readSettings()).settings.ai).toEqual(settings)
    const result = await api.generatePlugin({instruction:'生成时钟', currentDraft:{manifest:{id:'com.example.clock',name:'Clock',version:'1.0.0',entry:'ui/index.html',capabilities:[],permissions:[]}, files:{'ui/index.html':'old','ui/main.js':'','ui/style.css':''}}})
    expect(result.files['ui/index.html']).toBe('old')
    expect(result.explanation).toContain('生成')
  })
