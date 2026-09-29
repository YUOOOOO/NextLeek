import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import App from '../src/App.vue'
import type { KernelApi, MarketPlugin, PluginManifest } from '../src/api'

const updaterMocks = vi.hoisted(() => ({
  downloadAndInstall: vi.fn().mockResolvedValue(undefined),
  relaunch: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@tauri-apps/plugin-updater', () => ({
  check: vi.fn().mockResolvedValue({ version: '0.1.27', downloadAndInstall: updaterMocks.downloadAndInstall }),
}))
vi.mock('@tauri-apps/plugin-process', () => ({ relaunch: updaterMocks.relaunch }))

const dashboard: PluginManifest = {
  id: 'com.nextleek.dashboard',
  name: '仪表盘',
  version: '1.0.0',
  entry: 'ui/index.html',
  description: '基础运行仪表盘',
  author: 'NextLeek',
  minCreatorVersion: '0.1.0',
  capabilities: [],
  permissions: [],
  cmds: [{ code: 'open', label: '仪表盘', matches: ['dashboard'] }],
}
const remote: MarketPlugin = {
  id: 'com.example.clock',
  name: 'Clock',
  version: '1.0.0',
  description: 'Clock plugin',
  author: 'Community',
  packageUrl: 'https://example.com/clock.nlplugin',
  sha256: 'a'.repeat(64),
  minCreatorVersion: '0.1.0',
  permissions: [],
}

function createApi(): KernelApi {
  return {
    runtimeSummary: async () => ({ pluginCount: 1, mode: 'dual-trust', version: '0.1.0' }),
    listPlugins: async () => [{ manifest: dashboard, builtin: true, trusted: true }],
    refreshMarket: async () => ({ schemaVersion: 1, updatedAt: '2026-08-24T00:00:00Z', plugins: [remote] }),
    installMarketPlugin: async plugin => ({ manifest: { ...plugin, entry: 'ui/index.html', capabilities: [] }, builtin: false, trusted: false }),
    uninstallPlugin: async () => undefined,
    readSettings: async () => ({ settings: { marketUrl: 'https://example.com/index.json', trustedPlugins: [] }, version: '0.1.0', dataDir: 'Data' }),
    setMarketUrl: async () => ({ settings: { marketUrl: 'https://example.com/index.json', trustedPlugins: [] }, version: '0.1.0', dataDir: 'Data' }),
    setPluginTrust: async () => ({ settings: { marketUrl: 'https://example.com/index.json', trustedPlugins: [] }, version: '0.1.0', dataDir: 'Data' }),
    launchPlugin: async () => ({ token: 'token-1', manifest: dashboard, entryHtml: '<main><h1>仪表盘</h1></main>', textAssets: {}, trusted: true }),
    pluginSdkCall: async () => null,
    closePlugin: async () => undefined,
  }
}

async function flush() {
  const { promise, resolve } = Promise.withResolvers<void>()
  setTimeout(resolve, 10)
  await promise
}

async function waitUntil(predicate: () => boolean) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (predicate()) return
    await flush()
  }
}

describe('launcher shell', () => {
  it('shows plugin and host commands as square tiles', async () => {
    const wrapper = mount(App, { props: { api: createApi() } })
    await flush()
    expect(wrapper.find('[data-test="search"]').exists()).toBe(true)
    expect(wrapper.get('[data-test="hit-com.nextleek.dashboard:open"]').text()).toContain('仪表盘')
    expect(wrapper.get('[data-test="hit-com.nextleek.dashboard:open"]').find('.plugin-icon').exists()).toBe(true)
    expect(wrapper.get('[data-test="hit-host:market"]').text()).toContain('插件市场')
    expect(wrapper.get('[data-test="hit-host:settings"]').text()).toContain('设置')
    expect(wrapper.find('.plugin-grid').exists()).toBe(true)
    expect(wrapper.text()).not.toContain('创造模式')
  })

  it('hides panels on Escape', async () => {
    const wrapper = mount(App, { props: { api: createApi() } })
    await flush()
    await wrapper.get('[data-test="hit-host:market"]').trigger('mousedown')
    await flush()
    expect(wrapper.find('[data-test="market-panel"]').exists()).toBe(true)
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await flush()
    expect(wrapper.find('[data-test="market-panel"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="hits"]').exists()).toBe(true)
  })

  it('opens the marketplace from search and installs a plugin', async () => {
    const api = createApi()
    const install = vi.spyOn(api, 'installMarketPlugin')
    const uninstall = vi.spyOn(api, 'uninstallPlugin')
    const wrapper = mount(App, { props: { api } })
    await flush()
    await wrapper.get('[data-test="hit-host:market"]').trigger('mousedown')
    await flush()
    expect(wrapper.find('[data-test="market-panel"]').exists()).toBe(true)
    await wrapper.get('[data-test="install-com.example.clock"]').trigger('click')
    await flush()
    expect(install).toHaveBeenCalledWith(remote)
    await wrapper.get('[data-test="open-com.example.clock"]').trigger('click')
    await flush()
    expect(wrapper.find('.runtime-frame iframe').exists()).toBe(true)
    await wrapper.get('[data-test="search"]').setValue('市场')
    await wrapper.get('[data-test="hit-host:market"]').trigger('mousedown')
    await flush()
    await wrapper.get('[data-test="uninstall-com.example.clock"]').trigger('click')
    expect(uninstall).toHaveBeenCalledWith('com.example.clock')
  })

  it('opens settings from search and saves the marketplace URL', async () => {
    const api = createApi()
    const saveMarket = vi.spyOn(api, 'setMarketUrl')
    const wrapper = mount(App, { props: { api } })
    await flush()
    await wrapper.get('[data-test="hit-host:settings"]').trigger('mousedown')
    await flush()
    expect(wrapper.find('[data-test="settings-panel"]').exists()).toBe(true)
    await wrapper.get('[data-test="save-market-settings"]').trigger('click')
    expect(saveMarket).toHaveBeenCalledWith('https://example.com/index.json')
  })

  it('downloads installs and relaunches when an update is available', async () => {
    Object.defineProperty(window, '__TAURI_INTERNALS__', { value: {}, configurable: true })
    const wrapper = mount(App, { props: { api: createApi() } })
    await flush()
    await wrapper.get('[data-test="hit-host:settings"]').trigger('mousedown')
    await waitUntil(() => wrapper.find('[data-test="install-update"]').exists())
    await wrapper.get('[data-test="install-update"]').trigger('click')
    await flush()
    expect(updaterMocks.downloadAndInstall).toHaveBeenCalledOnce()
    expect(updaterMocks.relaunch).toHaveBeenCalledOnce()
    delete (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__
  })
})
