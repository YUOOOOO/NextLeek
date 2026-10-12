<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import AppIcon from '../../src/client/components/AppIcon.vue'
import CommandShortcuts from '../../src/client/components/CommandShortcuts.vue'
import DetailPanel from '../../src/client/components/product/DetailPanel.vue'
import PluginCard from '../../src/client/components/product/PluginCard.vue'
import type { Command, CommandResult } from '../../src/shared/contracts'
import type { InstalledPlugin, MarketEntry, OpenPlugin } from './shared'

const props = defineProps<{ active: boolean; openRequest?: { pluginId: string; commandId?: string; revision: number } | null }>()
const emit = defineEmits<{ back: []; 'shortcuts-updated': []; 'command-result': [result: CommandResult] }>()
const tab = ref<'catalog' | 'installed'>('catalog')
const query = ref('')
const selectedId = ref<string | null>(null)
const catalog = ref<MarketEntry[]>([])
const installed = ref<InstalledPlugin[]>([])
const commands = ref<Command[]>([])
const loading = ref(false)
const catalogError = ref('')
const installedError = ref('')
const actionError = ref('')
const notice = ref('')
const busy = ref<string | null>(null)
const busyLabel = ref('')
const sandbox = ref<HTMLElement | null>(null)
const opened = ref<OpenPlugin | null>(null)
const authentication = ref<{ pluginId: string; sourceId: string } | null>(null)
const password = ref('')
let viewGeneration = 0
let viewObserver: ResizeObserver | undefined
let viewFrame: number | undefined
let stopNativeEvents: (() => void) | undefined
let loaded = false
let disposed = false
let handledOpenRevision: number | null = null
// 指令启动只在真实安装列表加载后执行，仍复用沙箱打开和宿主校验。
async function applyOpenRequest() {
  const request = props.openRequest
  if (!props.active || !request || !loaded || disabled.value || request.revision === handledOpenRevision) return
  handledOpenRevision = request.revision
  if (installedError.value) { actionError.value = installedError.value; return }
  const item = installedById.value.get(request.pluginId)
  if (!item) { actionError.value = '此插件尚未安装'; return }
  if (!item.enabled || item.dependencyErrors?.length) { actionError.value = '此插件已停用或数据源依赖不可用'; return }
  if (opened.value) closePlugin()
  tab.value = 'installed'
  await openPlugin(item, request.commandId)
}


// 按名称、标识、描述和作者筛选真实目录。
const filtered = computed(() => {
  const needle = query.value.trim().toLocaleLowerCase()
  return catalog.value.filter(item => !needle || `${item.name} ${item.id} ${item.description} ${item.author}`.toLocaleLowerCase().includes(needle))
})
// 建立安装状态索引，供更新判断和依赖提示复用。
const installedById = computed(() => new Map(installed.value.map(item => [item.id, item])))
// 当前分类只展示对应请求错误。
const listError = computed(() => tab.value === 'catalog' ? catalogError.value : installedError.value)
// 请求进行中禁用冲突操作。
const disabled = computed(() => loading.value || busy.value !== null)
// 详情始终读取最新目录或安装状态，操作完成后不保留过期快照。
const selected = computed(() => selectedId.value
  ? (tab.value === 'catalog' ? catalog.value : installed.value).find(item => item.id === selectedId.value)
  : undefined)
// 搜索与列表保留原状态，详情仅收窄当前展示条目。
const visibleCatalog = computed(() => selected.value ? [selected.value as MarketEntry] : filtered.value)
// 安装详情仅展示当前条目，不改变完整安装列表。
const visibleInstalled = computed(() => selected.value ? [selected.value as InstalledPlugin] : installed.value)
// 市场卡片只打开已安装的真实宿主插件。
function openCatalogPlugin(id:string) { const item=installedById.value.get(id); if(item) void openPlugin(item) }
// 点击插件名称进入详情，不触发安装或运行操作。
function showDetail(id: string) { selectedId.value = id; clearAuthentication() }
// 将宿主异常转换为可见提示。
function message(cause: unknown) { return cause instanceof Error ? cause.message : String(cause) }
// 所有市场能力通过桌面插件接口调用。
async function invoke<T>(method: string, args: unknown = null): Promise<T> {
  if (!window.desktop?.invokePlugin) throw new Error('桌面插件接口不可用，请在 NextTools 桌面应用中打开。')
  return await window.desktop.invokePlugin('plugin-market', method, args) as T
}
// 并行刷新目录与安装列表，分别保留失败状态。
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
  void refreshCommands()
}
// 读取宿主注册的真实指令，供安装详情配置快捷键。
async function refreshCommands() {
  try {
    const result = await window.desktop.listCommands()
    if (!disposed) commands.value = result
  } catch (cause) { if (!disposed) actionError.value = message(cause) }
}
// 操作后重新读取宿主安装状态。
async function refreshInstalled() {
  try {
    const result = await invoke<InstalledPlugin[]>('installed')
    void refreshCommands()
    if (!disposed) { installed.value = result; installedError.value = '' }
  } catch (cause) {
    if (!disposed) installedError.value = message(cause)
    throw cause
  }
}
// 查找依赖指定数据源插件的消费者。
function consumers(id: string) {
  return installed.value.filter(item => item.requires?.some(requirement => requirement.sourcePluginId === id))
}
// 停用或卸载前明确告知依赖影响。
function dependencyWarning(id: string) {
  const names = consumers(id).map(item => item.name)
  return names.length ? `\n依赖此插件的消费者：${names.join('、')}。停用或卸载后，这些插件的数据源调用将不可用。` : ''
}
// 安装确认展示权限、网络来源和数据源方法。
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
// 清除密码及认证目标，避免凭据跨页残留。
function clearAuthentication() { password.value = ''; authentication.value = null }
// 只为当前选中数据源展开登录表单。
function beginAuthentication(pluginId: string, sourceId: string) {
  clearAuthentication()
  authentication.value = { pluginId, sourceId }
}
// 登录凭据仅提交给宿主，完成后刷新认证状态。
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
// 统一串行执行操作并呈现进度和真实错误。
async function perform(id: string, label: string, action: () => Promise<void>) {
  if (disabled.value || !props.active) return
  busy.value = id; busyLabel.value = label; actionError.value = ''; notice.value = ''
  try { await action() }
  catch (cause) { if (!disposed) actionError.value = message(cause) }
  finally { busy.value = null; busyLabel.value = '' }
}
// 根据实际安装版本区分安装、更新和已安装。
function installLabel(item: MarketEntry) {
  const current = installedById.value.get(item.id)
  return !current ? '安装' : current.version === item.version ? '已安装' : '更新'
}
// 用户确认权限后安装或更新，再刷新状态。
async function install(item: MarketEntry) {
  if (disabled.value || !props.active || !window.confirm(installPermissions(item))) return
  await perform(item.id, installedById.value.has(item.id) ? '正在更新…' : '正在安装…', async () => {
    const result = await invoke<InstalledPlugin>('install', { id: item.id })
    await refreshInstalled()
    if (disposed) return
    notice.value = `已安装 ${result.name} v${result.version}`
  })
}
// 用户确认删除与依赖影响后卸载插件。
async function uninstall(item: InstalledPlugin) {
  if (disabled.value || !props.active || !window.confirm(`确定卸载“${item.name}”吗？已安装的插件文件将被删除。${dependencyWarning(item.id)}`)) return
  await perform(item.id, '正在卸载…', async () => {
    await invoke<void>('uninstall', { id: item.id })
    await refreshInstalled()
    if (disposed) return
    notice.value = `已卸载 ${item.name}`
  })
}
// 切换启用状态，停用消费者依赖前二次确认。
async function toggle(item: InstalledPlugin) {
  if (item.enabled && consumers(item.id).length && !window.confirm(`确定停用“${item.name}”吗？${dependencyWarning(item.id)}`)) return
  await perform(item.id, item.enabled ? '正在停用…' : '正在启用…', async () => {
    const result = await invoke<InstalledPlugin>('setEnabled', { id: item.id, enabled: !item.enabled })
    await refreshInstalled()
    if (disposed) return
    notice.value = `${result.name} 已${result.enabled ? '启用' : '停用'}`
  })
}
// 打开宿主拥有的独立原生沙箱，不在可信 renderer 执行插件 HTML。
async function openPlugin(item: InstalledPlugin, commandId?: string) {
  if (!item.enabled || item.dependencyErrors?.length) return
  await perform(item.id, '正在打开…', async () => {
    const generation = ++viewGeneration
    const plugin = await invoke<OpenPlugin>('open', { id: item.id, ...(commandId === undefined ? {} : { commandId }) })
    if (disposed || !props.active || generation !== viewGeneration) { await revokeSession(plugin.session); return }
    opened.value = plugin
    await nextTick()
    observeView()
  })
}
// 合并布局变化，坐标采用主 WebContents 的 CSS 像素。
function scheduleViewBounds() {
  if (disposed || viewFrame !== undefined) return
  viewFrame = requestAnimationFrame(() => {
    viewFrame = undefined
    const plugin = opened.value
    const element = sandbox.value
    if (!plugin || !element || !props.active) return
    const rect = element.getBoundingClientRect()
    void invoke('viewBounds', { session: plugin.session, x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) })
      .then(() => opened.value === plugin && props.active ? invoke('viewVisible', { session: plugin.session, visible: rect.width > 0 && rect.height > 0 && !document.hidden }) : undefined)
      .catch(cause => { if (opened.value === plugin) actionError.value = message(cause) })
  })
}
// 观察占位大小及页面滚动，不把隐藏窗口当成关闭会话。
function observeView() {
  viewObserver?.disconnect()
  if (sandbox.value) viewObserver?.observe(sandbox.value)
  scheduleViewBounds()
}
// 窗口隐藏仅暂停原生视图显示，重新显示恢复相同会话。
function syncViewVisibility() {
  const plugin = opened.value
  if (plugin) void invoke('viewVisible', { session: plugin.session, visible: props.active && !document.hidden }).catch(cause => { if (!disposed) actionError.value = message(cause) })
  if (!document.hidden) scheduleViewBounds()
}
// 撤销宿主运行会话，不让已关闭页面继续调用能力。
async function revokeSession(session: string) {
  try { await invoke<void>('close', { session }) }
  catch (cause) { if (!disposed && props.active) actionError.value = message(cause) }
}
// 离开运行页时撤销宿主会话并停止占位观察。
function closePlugin() {
  const session = opened.value?.session
  viewGeneration++
  opened.value = null
  viewObserver?.disconnect()
  if (viewFrame !== undefined) { cancelAnimationFrame(viewFrame); viewFrame = undefined }
  clearAuthentication()
  if (session) void revokeSession(session)
}
// 运行页先返回插件详情，详情再返回保留搜索状态的市场列表。
function back() {
  if (opened.value) closePlugin()
  else if (selectedId.value) { selectedId.value = null; clearAuthentication() }
  else emit('back')
}
// 顶部输入框聚焦时也复用市场内部的逐级返回逻辑。
defineExpose({ back })
// 市场内部的 Esc 优先处理，避免父组件重复返回。
function onKey(event: KeyboardEvent) {
  if (event.key !== 'Escape' || !props.active) return
  event.preventDefault(); event.stopPropagation(); back()
}
// 后台退出运行会话，首次激活时才读取市场数据。
watch(() => props.active, value => {
  if (!value) closePlugin()
  else if (!loaded) void load()
}, { immediate: true, flush: 'sync' })
// 切换分类时清理详情和密码，保留搜索与列表数据。
watch(tab, () => { selectedId.value = null; clearAuthentication() })
// 激活和加载完成后消费新指令；后台实例不会提前打开沙箱。
watch(() => [props.active, props.openRequest?.revision, loading.value, busy.value], () => { void applyOpenRequest() }, { immediate: true, flush: 'post' })
// 挂载时接收宿主验证过的返回事件，并同步原生视图布局。
onMounted(() => {
  viewObserver = new ResizeObserver(scheduleViewBounds)
  stopNativeEvents = window.desktop.subscribe(event => {
    if (event.type === 'plugin-back' && event.session === opened.value?.session && props.active) back()
    if (event.type === 'shown') scheduleViewBounds()
  })
  window.addEventListener('resize', scheduleViewBounds)
  window.addEventListener('scroll', scheduleViewBounds, true)
  document.addEventListener('visibilitychange', syncViewVisibility)
  observeView()
})
// 卸载释放会话、观察器和全局事件。
onUnmounted(() => {
  disposed = true; closePlugin(); stopNativeEvents?.()
  window.removeEventListener('resize', scheduleViewBounds)
  window.removeEventListener('scroll', scheduleViewBounds, true)
  document.removeEventListener('visibilitychange', syncViewVisibility)
})
</script>

<template>
  <section class="plugin-market" :class="{ 'is-detail': !!selected }" data-testid="plugin-market" aria-label="插件市场" @keydown="onKey">
    <header class="plugin-market__header">
      <button class="back-button" data-testid="plugin-market-back" :aria-label="opened ? '返回插件列表' : selected ? '返回市场列表' : '返回菜单列表'" @click="back"><AppIcon name="back" /></button>
      <div><h1>{{ opened ? opened.name : selected ? '插件详情' : '插件市场' }}</h1><p v-if="opened">插件在独立沙箱中运行</p></div>
      <button v-if="!opened" class="text-button plugin-market__refresh" data-testid="plugin-market-refresh" :disabled="disabled" @click="load"><AppIcon name="refresh" />刷新</button>
      <button v-else class="text-button" data-testid="plugin-market-close" @click="closePlugin">返回列表</button>
    </header>
    <div v-if="actionError" class="plugin-market__feedback" data-testid="plugin-market-error" role="alert"><span>{{ actionError }}</span><button class="text-button" aria-label="关闭错误提示" @click="actionError = ''">关闭</button></div>
    <p v-if="busy" class="plugin-market__feedback" data-testid="plugin-market-busy" role="status">{{ busyLabel }}</p>
    <p v-else-if="notice" class="plugin-market__feedback" data-testid="plugin-market-notice" role="status">{{ notice }}</p>
    <div v-if="opened" ref="sandbox" class="plugin-market__viewer" data-testid="plugin-sandbox" :data-session="opened.session" :aria-label="opened.name" />
    <component :is="selected ? DetailPanel : 'div'" v-else class="plugin-market__content" :title="selected?.name ?? '插件市场'" @back="back">
      <div v-show="!selected" class="plugin-market__controls">
      <nav class="plugin-market__tabs" aria-label="市场分类"><button data-testid="plugin-market-tab-catalog" :aria-pressed="tab === 'catalog'" @click="tab = 'catalog'">发现</button><button data-testid="plugin-market-tab-installed" :aria-pressed="tab === 'installed'" @click="tab = 'installed'">已安装 · {{ installed.length }}</button></nav>
      <div v-if="tab === 'catalog'" class="plugin-market__toolbar"><AppIcon name="search" /><input v-model="query" data-testid="plugin-market-search" type="search" placeholder="搜索插件" aria-label="搜索插件" autocomplete="off" /></div>
      </div>
      <div v-if="loading" class="plugin-market__state" data-testid="plugin-market-loading" role="status">正在读取插件市场…</div>
      <div v-else-if="listError" class="plugin-market__state" data-testid="plugin-market-list-error" role="alert"><h2>暂时无法读取{{ tab === 'catalog' ? '插件目录' : '已安装插件' }}</h2><p>{{ listError }}</p><button class="text-button" data-testid="plugin-market-retry" :disabled="disabled" @click="load">重新读取</button></div>
      <div v-else-if="tab === 'catalog'" class="plugin-market__list" data-testid="plugin-market-catalog">
        <div v-if="!selected" class="plugin-market__section-heading"><h2>{{ query.trim() ? '搜索结果' : '全部插件' }}</h2><span>{{ filtered.length }} 个插件</span></div>
        <PluginCard v-for="item in selected ? [] : filtered" :key="item.id" :plugin="item" :installed="installedById.has(item.id)" :enabled="!!installedById.get(item.id)?.enabled" :disabled="disabled || !!installedError" :can-upgrade="installedById.has(item.id) && installedById.get(item.id)?.version !== item.version" data-testid="plugin-market-entry" :data-plugin-id="item.id" @click="showDetail(item.id)" @download="install(item)" @upgrade="install(item)" @open="openCatalogPlugin(item.id)" />
        <article v-for="item in selected ? visibleCatalog : []" :key="item.id" class="plugin-market__row" data-testid="plugin-market-entry" :data-plugin-id="item.id">
          <button class="plugin-market__icon" :aria-label="`查看${item.name}详情`" @click="showDetail(item.id)"><AppIcon name="puzzle" /></button>
          <div class="plugin-market__info">
            <h2><button class="plugin-market__name" @click="showDetail(item.id)">{{ item.name }}</button> <span>v{{ item.version }}</span></h2><p class="plugin-market__description">{{ item.description }}</p><small class="plugin-market__metadata">{{ item.author }} · {{ item.id }}</small><small class="plugin-market__metadata">需要 NextTools {{ item.minCreatorVersion }} · 权限：{{ item.permissions.join('、') || '无' }}</small><small v-if="installedById.has(item.id) && installedById.get(item.id)?.version !== item.version">已安装 v{{ installedById.get(item.id)?.version }} → v{{ item.version }}</small>
            <details v-if="item.dataSources?.length || item.requires?.length" :open="!!selected" class="plugin-market__capabilities">
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
        <div v-if="!selected" class="plugin-market__section-heading"><h2>已安装插件</h2><span>{{ installed.length }} 个插件</span></div>
        <PluginCard v-for="item in selected ? [] : visibleInstalled" :key="item.id" :plugin="item" installed :enabled="item.enabled && !item.dependencyErrors?.length" :disabled="disabled" :can-upgrade="false" data-testid="plugin-market-installed-entry" :data-plugin-id="item.id" @click="showDetail(item.id)" @open="openPlugin(item)" />
        <article v-for="item in selected ? visibleInstalled : []" :key="item.id" class="plugin-market__row" data-testid="plugin-market-installed-entry" :data-plugin-id="item.id">
          <button class="plugin-market__icon" :aria-label="`查看${item.name}详情`" @click="showDetail(item.id)"><AppIcon name="puzzle" /></button>
          <div class="plugin-market__info">
            <h2><button class="plugin-market__name" @click="showDetail(item.id)">{{ item.name }}</button> <span>v{{ item.version }}</span></h2><p class="plugin-market__description">{{ item.description }}</p><small class="plugin-market__metadata">{{ item.author }} · {{ item.id }}</small><small class="plugin-market__status">{{ item.enabled ? '已启用' : '已停用' }}</small>
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
            <CommandShortcuts v-if="selected" :commands="commands" :plugin-id="item.id" @updated="emit('shortcuts-updated')" />
          </div>
          <div class="plugin-market__actions"><button class="text-button" data-testid="plugin-market-open" :disabled="disabled || !item.enabled || !!item.dependencyErrors?.length" @click="openPlugin(item)">打开</button><template v-if="!item.deploymentManaged"><button class="switch" data-testid="plugin-market-enabled" role="switch" :aria-checked="item.enabled" :aria-label="`启用${item.name}`" :disabled="disabled" @click="toggle(item)"><span /></button><button class="text-button plugin-market__remove" data-testid="plugin-market-uninstall" :disabled="disabled" @click="uninstall(item)">卸载</button></template><span v-else>部署管理 · 在插件设置中停用</span></div>
        </article>
        <div v-if="!installed.length" class="plugin-market__state"><h2>从一个插件开始</h2><p>在发现页安装插件，然后在这里打开或管理它们。</p><button class="text-button" @click="tab = 'catalog'">发现插件</button></div>
      </div>
    </component>
  </section>
</template>

<style scoped>
.plugin-market { position: relative; display: flex; flex: 1; flex-direction: column; min-width: 0; min-height: 0; height: 100%; overflow: hidden; color: var(--ink); background: var(--surface); }
.plugin-market__header { display: flex; align-items: center; gap: 12px; min-height: 54px; padding: 10px 20px; border-bottom: 1px solid var(--line); flex-shrink: 0; }
.plugin-market__header h1 { margin: 0; font-size: 14px; font-weight: 600; }
.plugin-market__header p { margin: 3px 0 0; color: var(--muted); font-size: 11px; }
.plugin-market__header > :last-child { margin-left: auto; }
.plugin-market__refresh { display: inline-flex; align-items: center; gap: 6px; }
.plugin-market__refresh .icon { width: 14px; height: 14px; }
.plugin-market__controls { display: flex; align-items: center; gap: 16px; padding: 14px 20px 0; flex-shrink: 0; }
.plugin-market__tabs { display: flex; gap: 4px; flex-shrink: 0; }
.plugin-market__tabs button { padding: 7px 12px; border-radius: 6px; background: transparent; color: var(--muted); font-size: 13px; }
.plugin-market__tabs button:hover { background: var(--surface-hover); }
.plugin-market__tabs button[aria-pressed='true'] { background: var(--selected); color: var(--accent); font-weight: 600; }
.plugin-market__toolbar { display: flex; align-items: center; gap: 8px; width: 260px; min-width: 100px; margin-left: auto; padding: 7px 10px; border: 1px solid var(--line); border-radius: 6px; background: var(--surface-raised); }
.plugin-market__toolbar .icon { width: 15px; height: 15px; flex-shrink: 0; color: var(--muted); }
.plugin-market__toolbar:focus-within { border-color: var(--accent); }
.plugin-market__toolbar input { width: 100%; min-width: 0; border: 0; outline: none; padding: 0; font: inherit; font-size: 12px; background: transparent; color: var(--ink); }
.plugin-market__toolbar input::placeholder { color: var(--muted); }
.plugin-market__list { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); align-content: start; align-items: start; gap: 8px; flex: 1; min-height: 0; overflow-y: auto; overflow-x: hidden; padding: 20px; }
.plugin-market__section-heading { display: flex; align-items: center; justify-content: space-between; grid-column: 1 / -1; margin-bottom: 2px; padding: 0 2px; }
.plugin-market__section-heading h2 { margin: 0; font-size: 15px; font-weight: 600; }
.plugin-market__section-heading span { font-size: 12px; color: var(--muted); }
.plugin-market__row { display: grid; grid-template-columns: 48px minmax(0, 1fr) auto; align-items: start; gap: 12px; min-width: 0; padding: 12px 14px; border: 1px solid var(--line); border-radius: 8px; background: var(--surface-raised); transition: background 0.2s, transform 0.2s; }
.plugin-market__row:hover { background: var(--surface-hover); transform: translateX(2px); }
.plugin-market__icon { display: grid; place-items: center; width: 48px; height: 48px; padding: 10px; border-radius: 8px; color: var(--accent); background: var(--selected); }
.plugin-market__icon .icon { width: 100%; height: 100%; }
.plugin-market__info { min-width: 0; overflow-wrap: anywhere; }
.plugin-market__info h2 { margin: 0 0 4px; font-size: 14px; font-weight: 600; line-height: 20px; }
.plugin-market__name { max-width: 100%; padding: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; vertical-align: bottom; color: inherit; font: inherit; text-align: left; background: transparent; }
.plugin-market__name:hover { color: var(--accent); }
.plugin-market__info h2 span { color: var(--muted); font-size: 11px; font-weight: 400; }
.plugin-market__description { margin: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--muted); font-size: 12px; line-height: 20px; }
.plugin-market__info small { display: block; margin-top: 4px; color: var(--muted); font-size: 11px; line-height: 1.6; }
.plugin-market__metadata { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.plugin-market__capabilities { margin-top: 8px; font-size: 12px; }
.plugin-market__capabilities summary { cursor: pointer; color: var(--accent); }
.plugin-market__source { margin-top: 10px; padding: 12px; border: 1px solid var(--line); border-radius: 6px; background: var(--surface); font-size: 12px; }
.plugin-market__source strong { font-weight: 600; }
.plugin-market__source > button { margin-top: 8px; }
.plugin-market__dependency-errors { margin: 8px 0; padding-left: 16px; color: var(--rose); font-size: 12px; line-height: 1.6; }
.plugin-market__authentication { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; margin-top: 10px; }
.plugin-market__authentication input { width: 180px; max-width: 100%; min-width: 0; padding: 7px; border: 1px solid var(--line); border-radius: 6px; background: var(--surface-raised); color: var(--ink); }
.plugin-market__actions { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; grid-column: 2 / -1; justify-self: end; }
.plugin-market__row > [data-testid='plugin-market-install'] { padding: 5px 8px; border-radius: 6px; background: var(--selected); font-size: 12px; }
.plugin-market__remove { color: var(--rose); }
.plugin-market__state { grid-column: 1 / -1; padding: 48px 20px; color: var(--muted); text-align: center; }
.plugin-market__state h2 { margin-bottom: 8px; color: var(--ink); font-size: 15px; }
.plugin-market__state p { line-height: 1.6; overflow-wrap: anywhere; }
.plugin-market__state .text-button { margin-top: 12px; }
.plugin-market__feedback { display: flex; align-items: center; gap: 12px; grid-column: 1 / -1; flex-shrink: 0; padding: 10px 20px; margin: 0; border-bottom: 1px solid var(--line); color: var(--muted); font-size: 12px; overflow-wrap: anywhere; }
.plugin-market__feedback > span { flex: 1; }
.plugin-market__content { display:flex; flex:1; flex-direction:column; min-height:0; }
.plugin-market__content.detail-panel { top:54px; }
.plugin-market__viewer { display: flex; flex: 1; min-width: 0; min-height: 0; overflow: hidden; }
.is-detail .plugin-market__list { grid-template-columns: minmax(0, 1fr); }
.is-detail .plugin-market__row { grid-template-columns: 72px minmax(0, 1fr) auto; padding: 24px; gap: 20px; border: 0; background: transparent; }
.is-detail .plugin-market__row:hover { transform: none; }
.is-detail .plugin-market__icon { width: 72px; height: 72px; padding: 16px; border-radius: 12px; }
.is-detail .plugin-market__info h2 { margin: 0 0 10px; font-size: 22px; line-height: 28px; }
.is-detail .plugin-market__description, .is-detail .plugin-market__metadata { white-space: normal; overflow: visible; }
.is-detail .plugin-market__description { margin-bottom: 12px; font-size: 13px; line-height: 1.8; }
.is-detail .plugin-market__info small { font-size: 12px; }
.is-detail .plugin-market__capabilities { margin-top: 24px; padding-top: 16px; border-top: 1px solid var(--line); }
.is-detail .plugin-market__actions { gap: 16px; padding-top: 12px; }
@media (max-width: 600px) {
  .plugin-market__controls { flex-wrap: wrap; gap: 10px; }
  .plugin-market__toolbar { flex: 1; }
  .plugin-market__list { grid-template-columns: minmax(0, 1fr); padding: 16px; }
  .is-detail .plugin-market__row { padding: 8px 0; grid-template-columns: 48px minmax(0, 1fr); gap: 12px; }
  .is-detail .plugin-market__icon { width: 48px; height: 48px; padding: 10px; }
  .is-detail .plugin-market__row > [data-testid='plugin-market-install'] { grid-column: 2; justify-self: start; }
}
@media (prefers-reduced-motion: reduce) { .plugin-market__row { transition: none; } }
</style>
