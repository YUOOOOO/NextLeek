import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import App from '../src/App.vue'
import type { KernelApi, MarketPlugin, PluginManifest } from '../src/api'
const updaterMocks = vi.hoisted(() => ({
  downloadAndInstall: vi.fn().mockResolvedValue(undefined),
  relaunch: vi.fn().mockResolvedValue(undefined)
}))

vi.mock('@tauri-apps/plugin-updater', () => ({
  check: vi.fn().mockResolvedValue({version:'0.1.27', downloadAndInstall:updaterMocks.downloadAndInstall})
}))
vi.mock('@tauri-apps/plugin-process', () => ({relaunch:updaterMocks.relaunch}))

const dashboard: PluginManifest = {
  id:'com.nextleek.dashboard', name:'仪表盘', version:'1.0.0', entry:'ui/index.html',
  description:'基础运行仪表盘', author:'NextLeek', minCreatorVersion:'0.1.0',
  capabilities:[], permissions:[], navigation:{enabled:true,label:'仪表盘',order:10}
}
const remote: MarketPlugin = {
  id:'com.example.clock', name:'Clock', version:'1.0.0', description:'Clock plugin', author:'Community',
  packageUrl:'https://example.com/clock.nlplugin', sha256:'a'.repeat(64), minCreatorVersion:'0.1.0', permissions:[]
}

function createApi(): KernelApi {
  const ai = { enabled:true, baseUrl:'https://api.openai.com/v1', apiKey:'', model:'gpt-4.1-mini', temperature:0.2 }
  return {
    runtimeSummary: async () => ({ pluginCount:1, mode:'dual-trust', version:'0.1.0' }),
    listPlugins: async () => [{ manifest:dashboard, builtin:true, trusted:true }],
    createDraft: async () => undefined,
    writeDraftFile: async () => undefined,
    validateDraft: async () => ({ valid:true, errors:[] }),
    packageDraft: async () => ({ pluginId:'com.example.created', version:'0.1.0', path:'Data/creator-packages/demo.nlplugin', sha256:'b'.repeat(64), size:420, files:['manifest.json','ui/index.html','ui/main.js','ui/style.css'] }),
    refreshMarket: async () => ({ schemaVersion:1, updatedAt:'2026-08-24T00:00:00Z', plugins:[remote] }),
    installMarketPlugin: async plugin => ({ manifest:{...plugin, entry:'ui/index.html', capabilities:[]}, builtin:false, trusted:false }),
    installLocalPackage: async () => ({ manifest:dashboard, builtin:false, trusted:false }),
    uninstallPlugin: async () => undefined,
    readSettings: async () => ({ settings:{marketUrl:'https://example.com/index.json',trustedPlugins:[],ai},version:'0.1.0',dataDir:'Data' }),
    setMarketUrl: async () => ({ settings:{marketUrl:'https://example.com/index.json',trustedPlugins:[],ai},version:'0.1.0',dataDir:'Data' }),
    setAiSettings: async value => ({ settings:{marketUrl:'https://example.com/index.json',trustedPlugins:[],ai:value},version:'0.1.0',dataDir:'Data' }),
    setPluginTrust: async () => ({ settings:{marketUrl:'https://example.com/index.json',trustedPlugins:[],ai},version:'0.1.0',dataDir:'Data' }),
    launchPlugin: async () => ({ token:'token-1', manifest:dashboard, entryHtml:'<main><h1>仪表盘</h1></main>', textAssets:{}, trusted:true }),
    pluginSdkCall: async () => null,
    closePlugin: async () => undefined,
    generatePlugin: async request => ({ manifest:request.currentDraft.manifest, files:request.currentDraft.files, explanation:'generated' })
  }
}

async function flush(){ await new Promise(resolve => setTimeout(resolve,10)) }

async function waitUntil(predicate:()=>boolean){ for(let attempt=0; attempt<20; attempt+=1){ if(predicate()) return; await flush() } }
describe('desktop shell', () => {
  it('shows core navigation and installed plugin menu', async () => {
    const wrapper = mount(App, { props:{ api:createApi() } })
    await flush()
    expect(wrapper.findAll('nav button').map(button => button.text())).toEqual(['仪表盘','创造模式','插件市场'])
    expect(wrapper.get('[data-test="version"]').text()).toContain('0.1.0')
    expect(wrapper.get('[data-test="settings"]').attributes('aria-label')).toBe('设置')
  })

  it('creates validates and packages editable HTML CSS and JavaScript', async () => {
    const api = createApi()
    const write = vi.spyOn(api,'writeDraftFile')
    const wrapper = mount(App,{props:{api}})
    await wrapper.get('[data-page="创造模式"]').trigger('click')
    await flush()
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
    expect(wrapper.find('.runtime-frame iframe').exists()).toBe(true)
    await wrapper.get('[data-page="插件市场"]').trigger('click')
    await wrapper.get('[data-test="uninstall-com.example.clock"]').trigger('click')
    expect(uninstall).toHaveBeenCalledWith('com.example.clock')
  })
  it('imports a local nlplugin file and refreshes installed plugins', async () => {
    const api = createApi()
    const install = vi.spyOn(api, 'installLocalPackage')
    const wrapper = mount(App, {props:{api}})
    await wrapper.get('[data-page="插件市场"]').trigger('click')
    await flush()
    const input = wrapper.get('[data-test="import-local-plugin"]')
    const file = new File([], 'demo.nlplugin', {type:'application/octet-stream'})
    Object.defineProperty(file, 'arrayBuffer', {value:async()=>new Uint8Array([1, 2, 3]).buffer})
    Object.defineProperty(input.element, 'files', {value:[file]})
    await input.trigger('change')
    await flush()
    expect(install).toHaveBeenCalledWith([1, 2, 3])
  })

  it('opens settings as an in-page view and saves marketplace settings', async () => {
    const api = createApi()
    const saveMarket = vi.spyOn(api, 'setMarketUrl')
    const wrapper = mount(App, {props:{api}})
    await wrapper.get('[data-test="settings"]').trigger('click')
    await flush()
    expect(wrapper.find('.modal').exists()).toBe(false)
    expect(wrapper.text()).toContain('CREATOR CONFIGURATION')
    await wrapper.get('[data-test="save-market-settings"]').trigger('click')
    expect(saveMarket).toHaveBeenCalledWith('https://example.com/index.json')
  })
  it('applies generated content directly to the editor', async () => {
    const api = createApi()
    vi.spyOn(api, 'generatePlugin').mockResolvedValue({
      manifest: {...dashboard, id:'com.example.generated', name:'Generated'},
      files: {'ui/index.html':'<main>Generated</main>', 'ui/main.js':'console.log(1)', 'ui/style.css':'main{color:red}'},
      explanation:'generated safely'
    })
    const wrapper = mount(App, {props:{api}})
    await wrapper.get('[data-page="创造模式"]').trigger('click')
    await flush()
    await wrapper.find('aside.ai-panel textarea').setValue('生成一个插件')
    await wrapper.get('[data-test="ai-generate"]').trigger('click')
    await flush()
    expect(wrapper.get('textarea').element.value).toContain('Generated')
  })

  it('preserves the editor when AI generation fails', async () => {
    const api = createApi()
    vi.spyOn(api, 'generatePlugin').mockRejectedValue(new Error('AI_REQUEST_FAILED'))
    const wrapper = mount(App, {props:{api}})
    await wrapper.get('[data-page="创造模式"]').trigger('click')
    await flush()
    await wrapper.find('aside.ai-panel textarea').setValue('生成一个插件')
    await wrapper.get('[data-test="ai-generate"]').trigger('click')
    await flush()
    expect(wrapper.get('textarea').element.value).toContain('Hello NextLeek')
    expect(wrapper.text()).toContain('AI_REQUEST_FAILED')
  })
  it('downloads installs and relaunches when an update is available', async () => {
    Object.defineProperty(window, '__TAURI_INTERNALS__', {value:{}, configurable:true})
    const wrapper = mount(App, {props:{api:createApi()}})
    await wrapper.get('[data-test="settings"]').trigger('click')
    await waitUntil(() => wrapper.find('[data-test="install-update"]').exists())
    expect(wrapper.find('[data-test="install-update"]').exists()).toBe(true)
    await wrapper.get('[data-test="install-update"]').trigger('click')
    await flush()
    expect(updaterMocks.downloadAndInstall).toHaveBeenCalledOnce()
    expect(updaterMocks.relaunch).toHaveBeenCalledOnce()
    delete (window as Window & {__TAURI_INTERNALS__?:unknown}).__TAURI_INTERNALS__
  })

})
