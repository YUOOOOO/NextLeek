<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, shallowRef, watch } from 'vue'
import type { KernelApi, MarketCatalog, PluginState, RuntimeLaunch, SettingsView } from './api'
import { searchHits, type SearchHit } from './search'
import type { Update } from '@tauri-apps/plugin-updater'

const props = defineProps<{ api: KernelApi }>()
const query = ref('')
const selected = ref(0)
const plugins = ref<PluginState[]>([])
const market = ref<MarketCatalog | null>(null)
const runtime = ref<RuntimeLaunch | null>(null)
const panel = ref<'market' | 'settings' | null>(null)
const settings = ref<SettingsView | null>(null)
const status = ref('')
const error = ref('')
const loading = ref(false)
const searchInput = ref<HTMLInputElement | null>(null)
const availableUpdate = shallowRef<Update | null>(null)
const updateState = ref<'idle' | 'checking' | 'current' | 'available' | 'failed'>('idle')
const updating = ref(false)
const updateError = ref('')
const hits = computed(() => panel.value || runtime.value ? [] : searchHits(query.value, plugins.value))
const installedById = computed(() => Object.fromEntries(plugins.value.map(plugin => [plugin.manifest.id, plugin])))

const SEARCH_HEIGHT = 72
const LIST_HEIGHT = 420
const PANEL_HEIGHT = 640
const WINDOW_WIDTH = 680

function isTauriWindow() {
  const internals = (window as Window & { __TAURI_INTERNALS__?: { metadata?: { currentWindow?: unknown } } }).__TAURI_INTERNALS__
  return Boolean(internals?.metadata?.currentWindow)
}

async function withTauriWindow<T>(run: (api: typeof import('@tauri-apps/api/window')) => Promise<T>): Promise<T | undefined> {
  if (!isTauriWindow()) return
  const api = await import('@tauri-apps/api/window')
  return run(api)
}

async function fitWindow() {
  const height = runtime.value || panel.value ? PANEL_HEIGHT : query.value || hits.value.length ? LIST_HEIGHT : SEARCH_HEIGHT
  await withTauriWindow(async ({ getCurrentWindow, LogicalSize }) => {
    await getCurrentWindow().setSize(new LogicalSize(WINDOW_WIDTH, height))
  })
}

async function hideLauncher() {
  await closeRuntime()
  panel.value = null
  query.value = ''
  selected.value = 0
  await withTauriWindow(async ({ getCurrentWindow }) => {
    await getCurrentWindow().hide()
  })
}

async function closeRuntime() {
  const active = runtime.value
  runtime.value = null
  if (active) await props.api.closePlugin(active.token)
}

async function loadPlugins() {
  plugins.value = await props.api.listPlugins()
}

async function loadMarket() {
  loading.value = true
  error.value = ''
  try { market.value = await props.api.refreshMarket() } catch (cause) { error.value = String(cause) } finally { loading.value = false }
}

async function activate(hit: SearchHit) {
  error.value = ''
  status.value = ''
  selected.value = Math.max(0, hits.value.findIndex(item => item.id === hit.id))
  if (hit.kind === 'host' && hit.code === 'market') {
    await closeRuntime()
    panel.value = 'market'
    if (!market.value) await loadMarket()
    return
  }
  if (hit.kind === 'host' && hit.code === 'settings') {
    await closeRuntime()
    panel.value = 'settings'
    if (!settings.value) settings.value = await props.api.readSettings()
    return
  }
  if (hit.pluginId) {
    panel.value = null
    runtime.value = await props.api.launchPlugin(hit.pluginId)
  }
}

async function onSearchKey(event: KeyboardEvent) {
  if (event.key === 'ArrowDown') {
    event.preventDefault()
    selected.value = Math.min(hits.value.length - 1, selected.value + 1)
  } else if (event.key === 'ArrowUp') {
    event.preventDefault()
    selected.value = Math.max(0, selected.value - 1)
  } else if (event.key === 'Enter' && hits.value[selected.value]) {
    event.preventDefault()
    await activate(hits.value[selected.value])
  } else if (event.key === 'Escape') {
    event.preventDefault()
    if (runtime.value || panel.value) {
      await closeRuntime()
      panel.value = null
    } else {
      await hideLauncher()
    }
  }
}

async function install(plugin: NonNullable<MarketCatalog['plugins']>[number]) {
  error.value = ''
  const value = {
    id: plugin.id, name: plugin.name, version: plugin.version, description: plugin.description, author: plugin.author,
    packageUrl: plugin.packageUrl, sha256: plugin.sha256, minCreatorVersion: plugin.minCreatorVersion,
    permissions: [...plugin.permissions], ...(plugin.iconUrl ? { iconUrl: plugin.iconUrl } : {}),
  }
  try {
    const installed = await props.api.installMarketPlugin(value)
    plugins.value = [...plugins.value.filter(item => item.manifest.id !== installed.manifest.id), installed]
    status.value = `已安装 ${installed.manifest.name}`
  } catch (cause) { error.value = String(cause) }
}

async function uninstall(id: string) {
  error.value = ''
  try {
    await props.api.uninstallPlugin(id)
    status.value = '插件已卸载'
  } catch (cause) {
    const message = String(cause)
    error.value = `卸载失败：${message.includes('built-in plugins cannot be uninstalled') ? '内置插件不能卸载' : message}`
  } finally {
    try { await loadPlugins() } catch (cause) { error.value = `刷新插件列表失败：${String(cause)}` }
  }
}

async function openInstalled(id: string) {
  panel.value = null
  runtime.value = await props.api.launchPlugin(id)
}

async function saveSettings() {
  if (!settings.value) return
  try {
    settings.value = await props.api.setMarketUrl(settings.value.settings.marketUrl)
    status.value = '设置已保存'
  } catch (cause) { error.value = String(cause) }
}

async function revokeTrust(id: string) {
  try {
    settings.value = await props.api.setPluginTrust(id, false)
    await loadPlugins()
  } catch (cause) { error.value = String(cause) }
}

async function checkForUpdates(retry = true) {
  if (!('__TAURI_INTERNALS__' in window)) return
  updateState.value = 'checking'
  updateError.value = ''
  try {
    const { check } = await import('@tauri-apps/plugin-updater')
    const update = await check({ timeout: 30000 })
    availableUpdate.value = update
    updateState.value = update ? 'available' : 'current'
  } catch (cause) {
    if (retry) {
      window.setTimeout(() => void checkForUpdates(false), 10000)
      return
    }
    updateState.value = 'failed'
    updateError.value = `检查更新失败：${String(cause)}`
  }
}

async function installUpdate() {
  if (!availableUpdate.value || updating.value) return
  updating.value = true
  try {
    status.value = '正在下载更新…'
    await availableUpdate.value.downloadAndInstall()
    status.value = '更新安装完成，正在重启…'
    const { relaunch } = await import('@tauri-apps/plugin-process')
    await relaunch()
  } catch (cause) {
    updateError.value = `更新失败：${String(cause)}`
    error.value = updateError.value
  } finally { updating.value = false }
}

function runtimeAsset(path: string, launch: RuntimeLaunch) {
  return launch.textAssets[path] ?? ''
}

function runtimeSrcdoc(launch: RuntimeLaunch) {
  let html = launch.entryHtml
  const css = runtimeAsset('ui/style.css', launch)
  const js = runtimeAsset('ui/main.js', launch)
  const summary = JSON.stringify({ pluginCount: plugins.value.length, mode: 'dual-trust', version: settings.value?.version ?? '0.1.0' })
  const bridge = `<script>window.nextleek={runtimeSummary:()=>Promise.resolve(${summary}),call:(method,params)=>new Promise((resolve,reject)=>{const id=Math.random().toString(36).slice(2);const onMessage=event=>{const data=event.data;if(!data||data.type!=='nl-sdk-result'||data.id!==id)return;window.removeEventListener('message',onMessage);if(data.error)reject(new Error(data.error));else resolve(data.result)};window.addEventListener('message',onMessage);parent.postMessage({type:'nl-sdk',id,method,params:params||{}},'*')})}}<\/script>`
  html = html.replace(/<link[^>]+href=["']style\.css["'][^>]*>/i, `<style>${css}</style>`)
  html = html.replace(/<script[^>]+src=["']main\.js["'][^>]*><\/script>/i, `${bridge}<script>${js}<\/script>`)
  return html
}

function onSdkMessage(event: MessageEvent) {
  const data = event.data
  if (!data || data.type !== 'nl-sdk' || !runtime.value || !event.source) return
  const source = event.source as Window
  props.api.pluginSdkCall(runtime.value.token, data.method, data.params).then(
    result => source.postMessage({ type: 'nl-sdk-result', id: data.id, result }, '*'),
    err => source.postMessage({ type: 'nl-sdk-result', id: data.id, error: String(err) }, '*'),
  )
}

watch([query, hits, panel, runtime], async () => {
  if (selected.value >= hits.value.length) selected.value = 0
  await fitWindow()
})

watch(query, async () => {
  if (runtime.value) await closeRuntime()
  panel.value = null
})

onMounted(() => {
  window.addEventListener('message', onSdkMessage)
  void loadPlugins().catch(cause => { error.value = String(cause) })
  void props.api.readSettings().then(value => { settings.value = value }).catch(cause => { error.value = String(cause) })
  void checkForUpdates()
  void nextTick(() => searchInput.value?.focus())
})
onUnmounted(() => window.removeEventListener('message', onSdkMessage))
</script>

<template>
  <div class="launcher" @keydown="onSearchKey">
    <header class="search-bar" data-tauri-drag-region>
      <input
        ref="searchInput"
        data-test="search"
        v-model="query"
        type="search"
        placeholder="搜索插件与命令"
        autofocus
        @keydown="onSearchKey"
      >
      <button class="ghost" data-test="hide" title="隐藏" @click="hideLauncher">Esc</button>
    </header>
    <p v-if="error" class="error">{{ error }}</p>
    <p v-else-if="status" class="success">{{ status }}</p>
    <ul v-if="!panel && !runtime" class="hits" data-test="hits">
      <li
        v-for="(hit, index) in hits"
        :key="hit.id"
        :data-test="`hit-${hit.id}`"
        :class="{ active: index === selected }"
        @mousedown.prevent="activate(hit)"
      >
        <strong>{{ hit.label }}</strong>
        <span>{{ hit.subtitle }}</span>
      </li>
      <li v-if="!hits.length" class="empty">没有匹配的命令</li>
    </ul>
    <section v-if="runtime" class="runtime-view">
      <div class="runtime-frame" :data-trusted="runtime.trusted">
        <iframe :title="runtime.manifest.name" sandbox="allow-scripts" :srcdoc="runtimeSrcdoc(runtime)" />
      </div>
    </section>
    <section v-else-if="panel === 'market'" class="panel" data-test="market-panel">
      <header class="panel-head">
        <h1>插件市场</h1>
        <button class="ghost" :disabled="loading" @click="loadMarket">刷新</button>
      </header>
      <div v-if="plugins.length" class="installed-strip">
        <span v-for="plugin in plugins" :key="plugin.manifest.id" class="pill">{{ plugin.manifest.name }} · {{ plugin.manifest.version }}</span>
      </div>
      <div v-if="!market" class="empty">从 GitHub 加载官方和社区插件。</div>
      <div v-else class="cards">
        <article v-for="plugin in market.plugins" :key="plugin.id" class="card">
          <h2>{{ plugin.name }}</h2>
          <p>{{ plugin.description }}</p>
          <div class="button-row">
            <button class="btn primary" :data-test="`install-${plugin.id}`" @click="install(plugin)">安装</button>
            <button v-if="installedById[plugin.id]" class="btn" :data-test="`open-${plugin.id}`" @click="openInstalled(plugin.id)">打开</button>
            <button v-if="installedById[plugin.id] && !installedById[plugin.id].builtin" class="btn" :data-test="`uninstall-${plugin.id}`" @click="uninstall(plugin.id)">卸载</button>
          </div>
        </article>
      </div>
    </section>
    <section v-else-if="panel === 'settings'" class="panel" data-test="settings-panel">
      <header class="panel-head"><h1>设置</h1></header>
      <div v-if="settings" class="settings-grid">
        <article class="card">
          <h2>版本更新</h2>
          <p>当前版本 v{{ settings.version }}</p>
          <p v-if="updateState === 'available'">发现新版本 v{{ availableUpdate?.version }}</p>
          <p v-else-if="updateState === 'current'">当前已是最新版本</p>
          <p v-else-if="updateState === 'failed'" class="error">{{ updateError }}</p>
          <div class="button-row">
            <button class="btn" :disabled="updateState === 'checking' || updating" @click="checkForUpdates(false)">重新检查</button>
            <button v-if="availableUpdate" class="btn primary" data-test="install-update" :disabled="updating" @click="installUpdate">下载并安装</button>
          </div>
        </article>
        <article class="card">
          <h2>插件市场</h2>
          <label>市场索引地址<input v-model="settings.settings.marketUrl"></label>
          <button class="btn primary" data-test="save-market-settings" @click="saveSettings">保存市场地址</button>
        </article>
        <article class="card">
          <h2>可信插件</h2>
          <p v-if="!settings.settings.trustedPlugins.length" class="muted">暂无可信插件</p>
          <div v-for="id in settings.settings.trustedPlugins" :key="id" class="trust-row">
            <code>{{ id }}</code>
            <button class="btn" :data-test="`revoke-${id}`" @click="revokeTrust(id)">撤销</button>
          </div>
        </article>
      </div>
    </section>
    <footer class="hint">Alt+Space 唤出 · Esc 隐藏 · 托盘常驻</footer>
  </div>
</template>

<style src="./style.css"></style>
