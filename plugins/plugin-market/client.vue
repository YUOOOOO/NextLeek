<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import AppIcon from '../../src/client/components/AppIcon.vue'
import type { InstalledPlugin, MarketEntry, MarketRuntimeSummary, OpenPlugin } from './shared'

const props = defineProps<{ active: boolean }>()
const emit = defineEmits<{ back: [] }>()
const tab = ref<'catalog' | 'installed'>('catalog')
const query = ref('')
const catalog = ref<MarketEntry[]>([])
const installed = ref<InstalledPlugin[]>([])
const loading = ref(false)
const catalogError = ref('')
const installedError = ref('')
const actionError = ref('')
const notice = ref('')
const busy = ref<string | null>(null)
const busyLabel = ref('')
const frame = ref<HTMLIFrameElement | null>(null)
const frameHtml = ref('')
const opened = ref<OpenPlugin | null>(null)
let runtimeSummary: MarketRuntimeSummary | null = null
const authentication = ref<{ pluginId: string; sourceId: string } | null>(null)
const password = ref('')
let frameGeneration = 0
let requestWindow = 0
let requestCount = 0
const pendingRequests = new Set<string>()
const recentRequests = new Set<string>()
let loaded = false
let disposed = false

function applyFrameNonce(html: string, nonce: string) {
  const parsed = new DOMParser().parseFromString(html, 'text/html')
  for (const script of parsed.querySelectorAll('script')) script.setAttribute('nonce', nonce)
  const policy = parsed.querySelector<HTMLMetaElement>('meta[http-equiv="Content-Security-Policy"]')
  if (policy) {
    const directives = policy.content.split(';').map(part => part.trim()).filter(Boolean)
    const index = directives.findIndex(part => part.startsWith('script-src'))
    const nonceToken = `'nonce-${nonce}'`
    if (index >= 0) {
      const values = directives[index].split(/\s+/).filter(value => value !== "'unsafe-inline'")
      if (!values.includes(nonceToken)) values.push(nonceToken)
      directives[index] = values.join(' ')
    } else directives.push(`script-src ${nonceToken}`)
    policy.content = directives.join('; ')
  }
  return parsed.documentElement.outerHTML
}

const filtered = computed(() => {
  const needle = query.value.trim().toLocaleLowerCase()
  return catalog.value.filter(item => !needle || `${item.name} ${item.id} ${item.description} ${item.author}`.toLocaleLowerCase().includes(needle))
})
const installedById = computed(() => new Map(installed.value.map(item => [item.id, item])))
const listError = computed(() => tab.value === 'catalog' ? catalogError.value : installedError.value)
const disabled = computed(() => loading.value || busy.value !== null)
function message(cause: unknown) { return cause instanceof Error ? cause.message : String(cause) }
async function invoke<T>(method: string, args: unknown = null): Promise<T> {
  if (!window.desktop?.invokePlugin) throw new Error('桌面插件接口不可用，请在 NextTools 桌面应用中打开。')
  return await window.desktop.invokePlugin('plugin-market', method, args) as T
}
async function load() {
  if (!props.active || loading.value || busy.value) return
  loading.value = true
  const results = await Promise.allSettled([invoke<MarketEntry[]>('catalog'), invoke<InstalledPlugin[]>('installed')])
  if (disposed) return
  const [nextCatalog, nextInstalled] = results
  if (nextCatalog.status === 'fulfilled') { catalog.value = nextCatalog.value; catalogError.value = '' }
  else catalogError.value = message(nextCatalog.reason)
  if (nextInstalled.status === 'fulfilled') { installed.value = nextInstalled.value; installedError.value = '' }
  else installedError.value = message(nextInstalled.reason)
  loaded = true; loading.value = false
}
async function refreshInstalled() {
  try {
    const result = await invoke<InstalledPlugin[]>('installed')
    if (!disposed) { installed.value = result; installedError.value = '' }
  } catch (cause) {
    if (!disposed) installedError.value = message(cause)
    throw cause
  }
}
function consumers(id: string) {
  return installed.value.filter(item => item.requires?.some(requirement => requirement.sourcePluginId === id))
}
function dependencyWarning(id: string) {
  const names = consumers(id).map(item => item.name)
  return names.length ? `\n依赖此插件的消费者：${names.join('、')}。停用或卸载后，这些插件的数据源调用将不可用。` : ''
}
function installPermissions(item: MarketEntry) {
  const lines = [`${item.name} v${item.version}`, `权限：${item.permissions.join('、') || '无'}`]
  for (const source of item.dataSources ?? []) {
    lines.push(`网络来源：${source.baseUrl}（${source.id} v${source.version}）`)
    for (const method of source.methods) lines.push(`  ${method.name}: ${method.method} ${method.path}`)
    if (source.authentication) lines.push(`  密码认证：POST ${source.authentication.path}（仅宿主使用，凭据不交给插件）`)
  }
  for (const requirement of item.requires ?? []) {
    lines.push(`消费数据源：${requirement.sourcePluginId}/${requirement.sourceId} ≥ ${requirement.minVersion}；方法：${requirement.methods.join('、')}`)
    const provider = installedById.value.get(requirement.sourcePluginId) ?? catalog.value.find(entry => entry.id === requirement.sourcePluginId)
    const source = provider?.dataSources?.find(entry => entry.id === requirement.sourceId)
    if (source) {
      lines.push(`  网络来源：${source.baseUrl}`)
      for (const method of source.methods.filter(entry => requirement.methods.includes(entry.name))) lines.push(`  ${method.name}: ${method.method} ${method.path}`)
    } else lines.push('  数据源尚未安装；安装数据源时需另行确认网络权限。')
  }
  return `${lines.join('\n')}\n\n插件将在独立沙箱中运行。确认安装或更新？`
}
function clearAuthentication() { password.value = ''; authentication.value = null }
function beginAuthentication(pluginId: string, sourceId: string) {
  clearAuthentication()
  authentication.value = { pluginId, sourceId }
}
async function configureSource() {
  const target = authentication.value
  if (!target || !password.value || disabled.value) return
  const credential = password.value
  clearAuthentication()
  await perform(target.pluginId, '正在登录数据源…', async () => {
    try {
      await invoke<void>('configureSource', { id: target.pluginId, sourceId: target.sourceId, password: credential })
      if (!disposed) notice.value = '数据源已登录；认证仅在当前运行会话有效，重启后需重新登录。'
    } finally { await refreshInstalled() }
  })
}
async function perform(id: string, label: string, action: () => Promise<void>) {
  if (disabled.value || !props.active) return
  busy.value = id; busyLabel.value = label; actionError.value = ''; notice.value = ''
  try { await action() }
  catch (cause) { if (!disposed) actionError.value = message(cause) }
  finally { busy.value = null; busyLabel.value = '' }
}
function installLabel(item: MarketEntry) {
  const current = installedById.value.get(item.id)
  return !current ? '安装' : current.version === item.version ? '已安装' : '更新'
}
async function install(item: MarketEntry) {
  if (disabled.value || !props.active || !window.confirm(installPermissions(item))) return
  await perform(item.id, installedById.value.has(item.id) ? '正在更新…' : '正在安装…', async () => {
    const result = await invoke<InstalledPlugin>('install', { id: item.id })
    await refreshInstalled()
    if (disposed) return
    notice.value = `已安装 ${result.name} v${result.version}`
  })
}
async function uninstall(item: InstalledPlugin) {
  if (disabled.value || !props.active || !window.confirm(`确定卸载“${item.name}”吗？已安装的插件文件将被删除。${dependencyWarning(item.id)}`)) return
  await perform(item.id, '正在卸载…', async () => {
    await invoke<void>('uninstall', { id: item.id })
    await refreshInstalled()
    if (disposed) return
    notice.value = `已卸载 ${item.name}`
  })
}
async function toggle(item: InstalledPlugin) {
  if (item.enabled && consumers(item.id).length && !window.confirm(`确定停用“${item.name}”吗？${dependencyWarning(item.id)}`)) return
  await perform(item.id, item.enabled ? '正在停用…' : '正在启用…', async () => {
    const result = await invoke<InstalledPlugin>('setEnabled', { id: item.id, enabled: !item.enabled })
    await refreshInstalled()
    if (disposed) return
    notice.value = `${result.name} 已${result.enabled ? '启用' : '停用'}`
  })
}
async function openPlugin(item: InstalledPlugin) {
  if (!item.enabled || item.dependencyErrors?.length) return
  await perform(item.id, '正在打开…', async () => {
    const generation = frameGeneration
    const [summary, nonce] = await Promise.all([
      invoke<MarketRuntimeSummary>('runtimeSummary'),
      window.desktop.getFrameNonce(),
    ])
    if (disposed || !props.active || generation !== frameGeneration) return
    const plugin = await invoke<OpenPlugin>('open', { id: item.id })
    if (disposed || !props.active || generation !== frameGeneration) { await revokeSession(plugin.session); return }
    try {
      frameHtml.value = applyFrameNonce(plugin.html, nonce)
      runtimeSummary = { version: summary.version, platform: summary.platform, mode: summary.mode, status: summary.status, installed: summary.installed, enabled: summary.enabled }
      requestWindow = 0; requestCount = 0; pendingRequests.clear(); recentRequests.clear()
      opened.value = plugin
    } catch (cause) { await revokeSession(plugin.session); throw cause }
  })
}
async function revokeSession(session: string) {
  try { await invoke<void>('close', { session }) }
  catch (cause) { if (!disposed && props.active) actionError.value = message(cause) }
}
function closePlugin() {
  const session = opened.value?.session
  frameGeneration++
  opened.value = null; frameHtml.value = ''; runtimeSummary = null
  pendingRequests.clear(); recentRequests.clear(); clearAuthentication()
  if (session) void revokeSession(session)
}
function back() { if (opened.value) closePlugin(); else emit('back') }
function onKey(event: KeyboardEvent) {
  if (event.key !== 'Escape' || !props.active) return
  event.preventDefault(); event.stopPropagation(); back()
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype
}
function validArguments(value: unknown) {
  let remaining = 4096
  function visit(item: unknown, depth: number): boolean {
    if (--remaining < 0 || depth > 12) return false
    if (item === null || typeof item === 'boolean') return true
    if (typeof item === 'number') return Number.isFinite(item)
    if (typeof item === 'string') return item.length <= 16384
    if (Array.isArray(item)) return item.length <= 256 && item.every(entry => visit(entry, depth + 1))
    if (!isRecord(item)) return false
    const entries = Object.entries(item)
    return entries.length <= 64 && entries.every(([key, entry]) => key.length <= 128 && visit(entry, depth + 1))
  }
  return isRecord(value) && visit(value, 0) && JSON.stringify(value).length <= 65536
}
async function onMessage(event: MessageEvent) {
  const source = frame.value?.contentWindow
  const plugin = opened.value
  if (!props.active || disposed || !plugin || !source || event.source !== source || event.origin !== 'null' || !runtimeSummary) return
  const request: unknown = event.data
  if (!isRecord(request) || request.type !== 'nextleek:runtime-request' || typeof request.id !== 'string' || !/^[a-zA-Z0-9_.:-]{1,64}$/.test(request.id)) return
  const now = Date.now()
  if (now - requestWindow >= 1000) { requestWindow = now; requestCount = 0 }
  if (++requestCount > 32 || pendingRequests.has(request.id) || recentRequests.has(request.id)) return
  if (request.method !== 'runtimeSummary' && request.method !== 'invokeCapability') return
  if (Object.keys(request).some(key => !['type', 'id', 'method', 'args'].includes(key))) return
  recentRequests.add(request.id)
  if (recentRequests.size > 2048) recentRequests.delete(recentRequests.values().next().value!)
  const generation = frameGeneration
  function reply(payload: { result: unknown } | { error: string }) {
    // Opaque sandbox origins require '*'; never deliver results to a replaced or closed frame.
    if (!disposed && props.active && opened.value === plugin && frameGeneration === generation && frame.value?.contentWindow === source) {
      source!.postMessage({ type: 'nextleek:runtime-response', id: (request as Record<string, unknown>).id, ...payload }, '*')
    }
  }
  if (request.method === 'runtimeSummary') { reply({ result: runtimeSummary }); return }
  const input = request.args
  if (!isRecord(input) || Object.keys(input).some(key => !['sourcePluginId', 'sourceId', 'method', 'args'].includes(key)) ||
    !['sourcePluginId', 'sourceId', 'method'].every(key => typeof input[key] === 'string' && /^[a-zA-Z0-9_.-]{1,128}$/.test(input[key] as string)) || !validArguments(input.args)) {
    reply({ error: '数据源调用参数无效' }); return
  }
  if (pendingRequests.size >= 8) { reply({ error: '数据源调用并发过多，请稍后重试' }); return }
  pendingRequests.add(request.id)
  try {
    const result = await invoke<unknown>('invokeCapability', { session: plugin.session, sourcePluginId: input.sourcePluginId, sourceId: input.sourceId, method: input.method, args: input.args })
    reply({ result })
  } catch (cause) { reply({ error: message(cause) }) }
  finally { if (frameGeneration === generation) pendingRequests.delete(request.id) }
}
watch(() => props.active, value => {
  if (!value) closePlugin()
  else if (!loaded) void load()
}, { immediate: true, flush: 'sync' })
watch(tab, clearAuthentication)
onMounted(() => window.addEventListener('message', onMessage))
onUnmounted(() => { disposed = true; closePlugin(); window.removeEventListener('message', onMessage) })
</script>

<template>
  <section class="plugin-market" data-testid="plugin-market" aria-label="插件市场" @keydown="onKey">
    <header class="plugin-market__header">
      <button class="back-button" data-testid="plugin-market-back" :aria-label="opened ? '返回插件列表' : '返回菜单列表'" @click="back"><AppIcon name="back" /></button>
      <div><h1>{{ opened ? opened.name : '插件市场' }}</h1><p>{{ opened ? '插件在独立沙箱中运行' : '发现插件，让 NextTools 更适合你' }}</p></div>
      <button v-if="!opened" class="text-button" data-testid="plugin-market-refresh" :disabled="disabled" @click="load">刷新</button>
      <button v-else class="text-button" data-testid="plugin-market-close" @click="closePlugin">返回列表</button>
    </header>
    <div v-if="actionError" class="plugin-market__feedback" data-testid="plugin-market-error" role="alert"><span>{{ actionError }}</span><button class="text-button" aria-label="关闭错误提示" @click="actionError = ''">关闭</button></div>
    <p v-if="busy" class="plugin-market__feedback" data-testid="plugin-market-busy" role="status">{{ busyLabel }}</p>
    <p v-else-if="notice" class="plugin-market__feedback" data-testid="plugin-market-notice" role="status">{{ notice }}</p>
    <div v-if="opened" class="plugin-market__viewer"><iframe :key="opened.session" ref="frame" data-testid="plugin-market-frame" sandbox="allow-scripts" :srcdoc="frameHtml" :title="opened.name" /></div>
    <template v-else>
      <nav class="plugin-market__tabs" aria-label="市场分类"><button data-testid="plugin-market-tab-catalog" :aria-pressed="tab === 'catalog'" @click="tab = 'catalog'">发现</button><button data-testid="plugin-market-tab-installed" :aria-pressed="tab === 'installed'" @click="tab = 'installed'">已安装 · {{ installed.length }}</button></nav>
      <div v-if="tab === 'catalog'" class="plugin-market__toolbar"><input v-model="query" data-testid="plugin-market-search" type="search" placeholder="搜索名称、作者或描述" aria-label="搜索插件" autocomplete="off" /></div>
      <div v-if="loading" class="plugin-market__state" data-testid="plugin-market-loading" role="status">正在读取插件市场…</div>
      <div v-else-if="listError" class="plugin-market__state" data-testid="plugin-market-list-error" role="alert"><h2>暂时无法读取{{ tab === 'catalog' ? '插件目录' : '已安装插件' }}</h2><p>{{ listError }}</p><button class="text-button" data-testid="plugin-market-retry" :disabled="disabled" @click="load">重新读取</button></div>
      <div v-else-if="tab === 'catalog'" class="plugin-market__list" data-testid="plugin-market-catalog">
        <article v-for="item in filtered" :key="item.id" class="plugin-market__row" data-testid="plugin-market-entry" :data-plugin-id="item.id">
          <div class="plugin-market__info">
            <h2>{{ item.name }} <span>v{{ item.version }}</span></h2><p>{{ item.description }}</p><small>{{ item.author }} · {{ item.id }}</small><small>需要 NextTools {{ item.minCreatorVersion }}<template v-if="item.permissions.length"> · 权限：{{ item.permissions.join('、') }}</template></small><small v-if="installedById.has(item.id) && installedById.get(item.id)?.version !== item.version">已安装 v{{ installedById.get(item.id)?.version }} → v{{ item.version }}</small>
            <details v-if="item.dataSources?.length || item.requires?.length" class="plugin-market__capabilities">
              <summary>数据源与网络权限</summary>
              <div v-for="source in item.dataSources" :key="source.id" class="plugin-market__source">
                <strong>提供 {{ source.id }} · v{{ source.version }}</strong><small>网络来源：{{ source.baseUrl }}</small>
                <small v-for="method in source.methods" :key="method.name">{{ method.name }} · {{ method.method }} {{ method.path }}</small>
                <small v-if="source.authentication">密码登录 · POST {{ source.authentication.path }} · 仅宿主使用凭据</small>
              </div>
              <small v-for="requirement in item.requires" :key="`${requirement.sourcePluginId}/${requirement.sourceId}`">依赖 {{ requirement.sourcePluginId }}/{{ requirement.sourceId }} ≥ {{ requirement.minVersion }} · 方法：{{ requirement.methods.join('、') }}</small>
            </details>
          </div>
          <button class="text-button" data-testid="plugin-market-install" :disabled="disabled || !!installedError || installedById.get(item.id)?.version === item.version" @click="install(item)">{{ busy === item.id ? busyLabel : installLabel(item) }}</button>
        </article>
        <div v-if="!filtered.length" class="plugin-market__state"><h2>{{ query.trim() ? '没有匹配的插件' : '目录暂时没有插件' }}</h2><p>{{ query.trim() ? '试试其他名称或作者，或清空搜索查看全部插件。' : '刷新目录以获取最新发布的插件。' }}</p><button v-if="query.trim()" class="text-button" @click="query = ''">清空搜索</button></div>
        <p v-if="installedError" class="plugin-market__feedback" role="alert">无法确定已安装状态：{{ installedError }}<button class="text-button" :disabled="disabled" @click="load">重试</button></p>
      </div>
      <div v-else class="plugin-market__list" data-testid="plugin-market-installed">
        <article v-for="item in installed" :key="item.id" class="plugin-market__row" data-testid="plugin-market-installed-entry" :data-plugin-id="item.id">
          <div class="plugin-market__info">
            <h2>{{ item.name }} <span>v{{ item.version }}</span></h2><p>{{ item.description }}</p><small>{{ item.author }} · {{ item.id }} · {{ item.enabled ? '已启用' : '已停用' }}</small>
            <ul v-if="item.dependencyErrors?.length" class="plugin-market__dependency-errors" data-testid="plugin-market-dependency-errors" role="alert"><li v-for="error in item.dependencyErrors" :key="error">{{ error }}</li></ul>
            <small v-for="requirement in item.requires" :key="`${requirement.sourcePluginId}/${requirement.sourceId}`">依赖 {{ requirement.sourcePluginId }}/{{ requirement.sourceId }} ≥ {{ requirement.minVersion }} · 方法：{{ requirement.methods.join('、') }}</small>
            <small v-if="consumers(item.id).length">消费者：{{ consumers(item.id).map(consumer => consumer.name).join('、') }}（独立安装、更新、卸载）</small>
            <div v-for="source in item.dataSources" :key="source.id" class="plugin-market__source" data-testid="plugin-market-source" :data-source-id="source.id">
              <strong>提供 {{ source.id }} · v{{ source.version }}</strong><small>网络来源：{{ source.baseUrl }}</small>
              <small v-for="method in source.methods" :key="method.name">{{ method.name }} · {{ method.method }} {{ method.path }}</small>
              <template v-if="source.authentication">
                <small>密码登录 · POST {{ source.authentication.path }} · 凭据仅交给宿主，不传入插件</small>
                <small data-testid="plugin-market-source-authentication">{{ item.authenticatedSources?.includes(source.id) ? '当前运行会话已登录' : '未登录' }} · 重启后需重新登录</small>
                <form v-if="authentication?.pluginId === item.id && authentication?.sourceId === source.id" class="plugin-market__authentication" @submit.prevent="configureSource">
                  <label :for="`source-password-${item.id}-${source.id}`">数据源密码</label>
                  <input :id="`source-password-${item.id}-${source.id}`" v-model="password" data-testid="plugin-market-source-password" type="password" autocomplete="off" :disabled="disabled" required />
                  <button type="submit" class="text-button" data-testid="plugin-market-source-login" :disabled="disabled || !password || !item.enabled">登录</button>
                  <button type="button" class="text-button" :disabled="disabled" @click="clearAuthentication">取消</button>
                </form>
                <button v-else class="text-button" data-testid="plugin-market-configure-source" :disabled="disabled || !item.enabled" @click="beginAuthentication(item.id, source.id)">{{ item.authenticatedSources?.includes(source.id) ? '重新登录' : '登录数据源' }}</button>
              </template>
            </div>
          </div>
          <div class="plugin-market__actions"><button class="text-button" data-testid="plugin-market-open" :disabled="disabled || !item.enabled || !!item.dependencyErrors?.length" @click="openPlugin(item)">打开</button><button class="switch" data-testid="plugin-market-enabled" role="switch" :aria-checked="item.enabled" :aria-label="`启用${item.name}`" :disabled="disabled" @click="toggle(item)"><span /></button><button class="text-button plugin-market__remove" data-testid="plugin-market-uninstall" :disabled="disabled" @click="uninstall(item)">卸载</button></div>
        </article>
        <div v-if="!installed.length" class="plugin-market__state"><h2>从一个插件开始</h2><p>在发现页安装插件，然后在这里打开或管理它们。</p><button class="text-button" @click="tab = 'catalog'">发现插件</button></div>
      </div>
    </template>
  </section>
</template>

<style scoped>
.plugin-market { display: flex; flex: 1; flex-direction: column; min-width: 0; min-height: 0; height: 100%; color: var(--ink); background: var(--surface); }
.plugin-market .plugin-market__header, .plugin-market .plugin-market__tabs, .plugin-market .plugin-market__toolbar { display: flex; align-items: center; gap: var(--space-3); padding: var(--space-4) var(--space-6); border-bottom: 1px solid var(--line); flex-shrink: 0; }
.plugin-market .plugin-market__header h1 { font-size: var(--text-title); font-weight: 600; }
.plugin-market .plugin-market__header p { margin-top: var(--space-1); color: var(--muted); font-size: var(--text-sm); }
.plugin-market .plugin-market__header > :last-child { margin-left: auto; }
.plugin-market .plugin-market__tabs { padding-top: var(--space-2); padding-bottom: var(--space-2); }
.plugin-market .plugin-market__tabs button { padding: var(--space-2) var(--space-3); border-radius: var(--radius-sm); background: transparent; color: var(--muted); }
.plugin-market .plugin-market__tabs button:hover { background: var(--surface-hover); }
.plugin-market .plugin-market__tabs button[aria-pressed='true'] { background: var(--selected); color: var(--accent); font-weight: 600; }
.plugin-market .plugin-market__toolbar input { width: 100%; padding: var(--space-3); border: 1px solid var(--line); border-radius: var(--radius-sm); background: var(--surface-raised); color: var(--ink); }
.plugin-market .plugin-market__toolbar input::placeholder { color: var(--muted); }
.plugin-market .plugin-market__list { flex: 1; min-height: 0; overflow-y: auto; padding: 0 var(--space-6) var(--space-8); }
.plugin-market .plugin-market__row { display: flex; align-items: center; gap: var(--space-4); padding: var(--space-6) 0; border-bottom: 1px solid var(--line); }
.plugin-market .plugin-market__info { flex: 1; min-width: 0; overflow-wrap: anywhere; }
.plugin-market .plugin-market__info h2 { font-size: var(--text-lg); font-weight: 600; }
.plugin-market .plugin-market__info h2 span { margin-left: var(--space-2); color: var(--muted); font-size: var(--text-sm); font-weight: 400; }
.plugin-market .plugin-market__info p { margin: var(--space-2) 0; color: var(--muted); line-height: 1.6; }
.plugin-market .plugin-market__info small { display: block; margin-top: var(--space-1); color: var(--muted); font-size: var(--text-sm); }
.plugin-market .plugin-market__capabilities { margin-top: var(--space-3); font-size: var(--text-sm); }
.plugin-market .plugin-market__capabilities summary { cursor: pointer; color: var(--accent); }
.plugin-market .plugin-market__source { margin-top: var(--space-3); padding: var(--space-3); border: 1px solid var(--line); border-radius: var(--radius-sm); font-size: var(--text-sm); }
.plugin-market .plugin-market__source > button { margin-top: var(--space-2); }
.plugin-market .plugin-market__dependency-errors { margin: var(--space-2) 0; padding-left: var(--space-4); color: var(--rose); font-size: var(--text-sm); line-height: 1.6; }
.plugin-market .plugin-market__authentication { display: flex; align-items: center; flex-wrap: wrap; gap: var(--space-2); margin-top: var(--space-3); }
.plugin-market .plugin-market__authentication input { width: 180px; max-width: 100%; padding: var(--space-2); border: 1px solid var(--line); border-radius: var(--radius-sm); background: var(--surface-raised); color: var(--ink); }
.plugin-market .plugin-market__actions { display: flex; align-items: center; flex-wrap: wrap; gap: var(--space-2); flex-shrink: 0; }
.plugin-market .plugin-market__remove { color: var(--rose); }
.plugin-market .plugin-market__state { padding: var(--space-10) var(--space-6); color: var(--muted); }
.plugin-market .plugin-market__state h2 { margin-bottom: var(--space-2); color: var(--ink); font-size: var(--text-lg); }
.plugin-market .plugin-market__state p { line-height: 1.6; overflow-wrap: anywhere; }
.plugin-market .plugin-market__state .text-button { margin-top: var(--space-3); }
.plugin-market .plugin-market__feedback { display: flex; align-items: center; gap: var(--space-3); padding: var(--space-3) var(--space-6); border-bottom: 1px solid var(--line); color: var(--muted); font-size: var(--text-sm); overflow-wrap: anywhere; }
.plugin-market .plugin-market__feedback > span { flex: 1; }
.plugin-market .plugin-market__viewer { display: flex; flex: 1; min-height: 0; }
.plugin-market .plugin-market__viewer iframe { flex: 1; width: 100%; border: 0; background: var(--surface); }
@media (max-width: 520px) {
  .plugin-market .plugin-market__header, .plugin-market .plugin-market__tabs, .plugin-market .plugin-market__toolbar { padding-right: var(--space-4); padding-left: var(--space-4); }
  .plugin-market .plugin-market__list { padding-right: var(--space-4); padding-left: var(--space-4); }
  .plugin-market .plugin-market__row { align-items: flex-start; flex-wrap: wrap; }
  .plugin-market .plugin-market__actions { margin-left: auto; }
}
</style>
