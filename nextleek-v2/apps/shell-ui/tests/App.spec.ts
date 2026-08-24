import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import App from '../src/App.vue'
import type { KernelApi, MarketPlugin, PluginManifest } from '../src/api'

const notes: PluginManifest = {
  id:'com.nextleek.notes', name:'Notes', version:'1.0.0', entry:'ui/index.html',
  description:'安全保存本地笔记', author:'NextLeek', minCreatorVersion:'0.1.0',
  capabilities:['notes.read'], permissions:['storage:local']
}
const remote: MarketPlugin = {
  id:'com.example.clock', name:'Clock', version:'1.0.0', description:'Clock plugin', author:'Community',
  packageUrl:'https://example.com/clock.nlplugin', sha256:'a'.repeat(64), minCreatorVersion:'0.1.0', permissions:[]
}

function createApi(): KernelApi {
  return {
    runtimeSummary: async () => ({ pluginCount:1, mode:'dual-trust', version:'0.1.0' }),
    listPlugins: async () => [{ manifest:notes, builtin:true, trusted:true }],
    createDraft: async () => undefined,
    writeDraftFile: async () => undefined,
    validateDraft: async () => ({ valid:true, errors:[] }),
    packageDraft: async () => ({ pluginId:'com.example.created', version:'0.1.0', path:'Data/creator-packages/demo.nlplugin', sha256:'b'.repeat(64), size:420, files:['manifest.json','ui/index.html','ui/main.js','ui/style.css'] }),
    refreshMarket: async () => ({ schemaVersion:1, updatedAt:'2026-08-24T00:00:00Z', plugins:[remote] }),
    installMarketPlugin: async plugin => ({ manifest:{...plugin, entry:'ui/index.html', capabilities:[]}, builtin:false, trusted:false }),
    installLocalPackage: async () => ({ manifest:notes, builtin:false, trusted:false }),
    uninstallPlugin: async () => undefined,
    readSettings: async () => ({ settings:{marketUrl:'https://example.com/index.json',trustedPlugins:[]},version:'0.1.0',dataDir:'Data' }),
    setMarketUrl: async () => ({ settings:{marketUrl:'https://example.com/index.json',trustedPlugins:[]},version:'0.1.0',dataDir:'Data' }),
    setPluginTrust: async () => ({ settings:{marketUrl:'https://example.com/index.json',trustedPlugins:[]},version:'0.1.0',dataDir:'Data' }),
    launchPlugin: async () => ({ token:'token-1', manifest:notes, entryHtml:'<main><h1>Notes runtime</h1></main>', textAssets:{}, trusted:true }),
    pluginSdkCall: async () => null,
    closePlugin: async () => undefined
  }
}

async function flush(){ await new Promise(resolve => setTimeout(resolve,0)) }

describe('desktop shell', () => {
  it('shows only the approved navigation and footer controls', async () => {
    const wrapper = mount(App, { props:{ api:createApi() } })
    await flush()
    expect(wrapper.findAll('nav button').map(button => button.text())).toEqual(['首页','创造模式','插件市场'])
    expect(wrapper.get('[data-test="version"]').text()).toContain('0.1.0')
    expect(wrapper.get('[data-test="settings"]').text()).toContain('设置')
  })

  it('creates validates and packages editable HTML CSS and JavaScript', async () => {
    const api = createApi()
    const write = vi.spyOn(api,'writeDraftFile')
    const wrapper = mount(App,{props:{api}})
    await wrapper.get('[data-page="创造模式"]').trigger('click')
    await wrapper.get('[data-test="create"]').trigger('click')
    await wrapper.get('[data-test="package"]').trigger('click')
    await flush()
    expect(write).toHaveBeenCalledTimes(3)
    expect(wrapper.text()).toContain('demo.nlplugin')
    expect(wrapper.text()).toContain('SHA-256')
  })

  it('installs opens and uninstalls from the marketplace', async () => {
    const api = createApi()
    const install = vi.spyOn(api,'installMarketPlugin')
    const uninstall = vi.spyOn(api,'uninstallPlugin')
    const wrapper = mount(App,{props:{api}})
    await wrapper.get('[data-page="插件市场"]').trigger('click')
    await flush()
    await wrapper.get('[data-test="install-com.example.clock"]').trigger('click')
    await flush()
    expect(install).toHaveBeenCalledWith(remote)
    expect(wrapper.find('[data-test="open-com.example.clock"]').exists()).toBe(true)
    await wrapper.get('[data-test="open-com.example.clock"]').trigger('click')
    await flush()
    expect(wrapper.text()).toContain('返回插件市场')
    await wrapper.get('[data-test="runtime-back"]').trigger('click')
    await wrapper.get('[data-test="uninstall-com.example.clock"]').trigger('click')
    expect(uninstall).toHaveBeenCalledWith('com.example.clock')
  })
})
