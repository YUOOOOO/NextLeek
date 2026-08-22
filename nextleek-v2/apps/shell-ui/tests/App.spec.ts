import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import App from '../src/App.vue'
import type { KernelApi } from '../src/api'

const api: KernelApi = {
  runtimeSummary: async () => ({ pluginCount: 2, mode: 'declarative-only' }),
  listPlugins: async () => [
    { id:'com.nextleek.notes', name:'Notes', version:'1.0.0', entry:'ui/index.html', capabilities:['notes.read'], permissions:['storage:local'] },
    { id:'com.nextleek.stocks', name:'Stocks', version:'1.0.0', entry:'ui/index.html', capabilities:['stocks.quote.read'], permissions:['network:https'] }
  ],
  createDraft: async () => undefined,
  validateDraft: async () => ({ valid:true, errors:[] }),
  packageDraft: async () => ({ pluginId:'com.example.created', version:'0.1.0', files:['manifest.json'] })
}

describe('desktop shell', () => {
  it('navigates between home plugins creator and runtime', async () => {
    const wrapper = mount(App, { props: { api } })
    expect(wrapper.text()).toContain('欢迎使用 NextLeek Creator')
    for (const page of ['插件', '创造模式', '运行时']) {
      await wrapper.get(`[data-page="${page}"]`).trigger('click')
      expect(wrapper.get('h1').text()).toContain(page)
    }
  })

  it('shows builtin plugins through the API adapter', async () => {
    const wrapper = mount(App, { props: { api } })
    await wrapper.get('[data-page="插件"]').trigger('click')
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(wrapper.text()).toContain('Notes')
    expect(wrapper.text()).toContain('Stocks')
  })

  it('creates validates and packages a declarative draft', async () => {
    const wrapper = mount(App, { props: { api } })
    await wrapper.get('[data-page="创造模式"]').trigger('click')
    await wrapper.get('[data-test="create"]').trigger('click')
    expect(wrapper.text()).toContain('验证通过')
    await wrapper.get('[data-test="package"]').trigger('click')
    expect(wrapper.text()).toContain('manifest.json')
  })
})
