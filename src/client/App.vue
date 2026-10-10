<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { useDesktopStore } from './store'
import AppIcon from './components/AppIcon.vue'
import CommandTile from './components/CommandTile.vue'
import SearchProviderResults from './components/SearchProviderResults.vue'
import PluginMarket from '../../plugins/plugin-market/client.vue'
import type { Command, DesktopEvent, LauncherSearchItem, Settings } from '../shared/contracts'

const desktop = useDesktopStore()
const search = ref<HTMLInputElement | null>(null)
const header = ref<HTMLElement | null>(null)
const launcherContent = ref<HTMLElement | null>(null)
const footer = ref<HTMLElement | null>(null)
const errorStrip = ref<HTMLElement | null>(null)
const stateMessage = ref<HTMLElement | null>(null)
const themeControl = ref<HTMLSelectElement | null>(null)
const selected = ref(0)
const hotkeyInput = ref<HTMLInputElement | null>(null)
const capturingHotkey = ref(false)
const hotkey = ref('')
const systemDark = ref(false)
const searchMode = computed(() => desktop.query.trim().length > 0)
const hasHomeHistory = computed(() => desktop.recentCommands.length > 0 || desktop.pinnedCommands.length > 0)
const expandedSections = ref<string[]>([])
const applicationGroup = computed(() => desktop.searchGroups.find(group => group.providerId === 'applications'))
const bestResults = computed(() => [
  ...desktop.results.map(command => ({ kind: 'command' as const, command })),
  ...(applicationGroup.value?.items ?? []).map(item => ({ kind: 'application' as const, item })),
])
const bestTotal = computed(() => desktop.results.length + (applicationGroup.value?.total ?? 0))
const visibleBestResults = computed(() => expandedSections.value.includes('results') ? bestResults.value : bestResults.value.slice(0, 18))
const commandSections = computed(() => {
  if (searchMode.value) return []
  let offset = 0
  return [
    { id: 'recent', title: '最近使用', commands: desktop.recentCommands },
    { id: 'pinned', title: '已固定', commands: desktop.pinnedCommands },
  ].filter(section => section.commands.length).map(section => {
    const commands = expandedSections.value.includes(section.id) ? section.commands : section.commands.slice(0, 18)
    const result = { ...section, total: section.commands.length, commands, offset }
    offset += commands.length
    return result
  })
})
const visibleCommands = computed(() => commandSections.value.flatMap(section => section.commands))
const providerSections = computed(() => {
  let offset = searchMode.value ? visibleBestResults.value.length : visibleCommands.value.length
  return desktop.searchGroups.filter(group => group.providerId !== 'applications').map(group => { const section = { group, offset }; offset += group.items.length; return section })
})
const selectableResults = computed<Array<{ command: Command } | { providerId: string; item: LauncherSearchItem }>>(() => searchMode.value ? [
  ...visibleBestResults.value.map(result => result.kind === 'command' ? { command: result.command } : { providerId: 'applications', item: result.item }),
  ...providerSections.value.flatMap(({ group }) => group.items.map(item => ({ providerId: group.providerId, item }))),
] : visibleCommands.value.map(command => ({ command })))
const resultCount = computed(() => selectableResults.value.length)
const navigationSections = computed(() => [
  ...(searchMode.value ? [{ offset: 0, count: visibleBestResults.value.length, columns: 9 }] : commandSections.value.map(section => ({ offset: section.offset, count: section.commands.length, columns: 9 }))),
  ...providerSections.value.map(section => ({ offset: section.offset, count: section.group.items.length, columns: 1 })),
].filter(section => section.count))
const navigationRows = computed(() => navigationSections.value.flatMap(section => Array.from({ length: Math.ceil(section.count / section.columns) }, (_, row) => ({ offset: section.offset + row * section.columns, count: Math.min(section.columns, section.count - row * section.columns) }))))
async function toggleSection(id: string) {
  const expanding = !expandedSections.value.includes(id)
  expandedSections.value = expanding ? [...expandedSections.value, id] : expandedSections.value.filter(section => section !== id)
  const query = desktop.query
  while (expanding && id === 'results' && expandedSections.value.includes(id) && desktop.query === query && applicationGroup.value?.hasMore && !desktop.searchLoading) {
    const count = applicationGroup.value.items.length
    await desktop.searchLauncher('applications')
    if (applicationGroup.value?.items.length === count || desktop.searchError) break
  }
}
const launcherExpanded = computed(() => desktop.page !== 'launcher' || searchMode.value || hasHomeHistory.value || Boolean(desktop.error) || desktop.loading || !desktop.snapshot)
const settings = computed(() => desktop.snapshot?.settings)
const dark = computed(() => settings.value?.theme === 'dark' || (settings.value?.theme === 'system' && systemDark.value))
const updateLabels = {
  unsupported: '当前安装方式不支持在线更新', idle: '尚未检查更新', checking: '正在检查更新…',
  available: '发现新版本', 'not-available': '已是最新版本', downloading: '正在下载更新…',
  downloaded: '更新已下载', installing: '正在重启安装…', error: '更新失败',
} as const
const updateInProgress = computed(() => desktop.updateBusy || ['checking', 'downloading', 'installing'].includes(desktop.updateState?.status ?? ''))
const updatePercent = computed(() => Math.min(100, Math.max(0, desktop.updateState?.progress?.percent ?? 0)))
const accents = [
  { id: 'blue', label: '海蓝' }, { id: 'violet', label: '紫罗兰' },
  { id: 'green', label: '松绿' }, { id: 'orange', label: '琥珀' },
  { id: 'rose', label: '玫瑰' }, { id: 'teal', label: '青碧' },
] as const
const navigation = [
  { id: 'settings', label: '通用设置', icon: 'gear' },
  { id: 'theme', label: '外观主题', icon: 'palette' },
  { id: 'plugins', label: '已安装插件', icon: 'puzzle' },
] as const

watch(() => settings.value?.hotkey, value => { hotkey.value = value ?? '' })
watch(() => desktop.query, () => { selected.value = 0; expandedSections.value = []; if (searchMode.value) desktop.page = 'launcher' })
watch(resultCount, count => { selected.value = Math.min(selected.value, Math.max(0, count - 1)) })
let layoutObserver: ResizeObserver | undefined
let layoutFrame: number | undefined
let layoutActive = false
let requestedLauncherHeight: number | undefined
function scheduleLauncherHeight() {
  if (!layoutActive) return
  void nextTick(() => {
    if (!layoutActive || layoutFrame !== undefined) return
    layoutFrame = requestAnimationFrame(() => {
      layoutFrame = undefined
      const height = desktop.page === 'launcher'
        ? (header.value?.getBoundingClientRect().height ?? 0) + (launcherContent.value?.getBoundingClientRect().height ?? 0)
          + (footer.value?.getBoundingClientRect().height ?? 0) + (errorStrip.value?.getBoundingClientRect().height ?? 0)
          + (stateMessage.value?.getBoundingClientRect().height ?? 0) + 1
        : 690
      const nextHeight = Math.min(690, Math.ceil(height))
      if (nextHeight === requestedLauncherHeight) return
      requestedLauncherHeight = nextHeight
      void desktop.setLauncherHeight(nextHeight)
    })
  })
}
function observeLauncherLayout() {
  layoutObserver?.disconnect()
  for (const element of [header.value, launcherContent.value, footer.value, errorStrip.value, stateMessage.value]) {
    if (element) layoutObserver?.observe(element)
  }
  scheduleLauncherHeight()
}
watch([header, launcherContent, footer, errorStrip, stateMessage], observeLauncherLayout, { flush: 'post' })
watch([() => desktop.page, launcherExpanded, () => settings.value?.compact, () => desktop.focusRequest], scheduleLauncherHeight, { flush: 'post' })
watch(() => desktop.page, async page => {
  selected.value = 0
  void releaseHotkeyCapture()
  await nextTick()
  if (page === 'launcher') search.value?.focus()
  if (page === 'theme') themeControl.value?.focus()
})
watch(() => desktop.focusRequest, async () => {
  selected.value = 0
  expandedSections.value = []
  await nextTick()
  if (desktop.page === 'launcher') search.value?.focus()
  else if (!document.activeElement?.closest('.settings-layout')) {
    if (desktop.page === 'theme') themeControl.value?.focus()
    else search.value?.focus()
  }
})

function changeTheme(event: Event) {
  void desktop.update({ theme: (event.target as HTMLSelectElement).value as Settings['theme'] })
}
async function saveHotkey() {
  if (!hotkey.value.trim()) return
  hotkeyInput.value?.blur()
  if (!await desktop.setHotkeyCapture(false)) return
  await desktop.update({ hotkey: hotkey.value.trim() })
}
function startHotkeyCapture() {
  capturingHotkey.value = true
  void desktop.setHotkeyCapture(true)
}
async function releaseHotkeyCapture() {
  if (!capturingHotkey.value) return
  capturingHotkey.value = false
  await desktop.setHotkeyCapture(false)
}
function restoreHotkeyCapture() {
  if (document.activeElement === hotkeyInput.value && !capturingHotkey.value) startHotkeyCapture()
}
function cancelHotkey() { hotkey.value = settings.value?.hotkey ?? '' }
function captureHotkey(event: KeyboardEvent) {
  event.stopPropagation()
  if (event.key === 'Tab') return
  if (event.key === 'Escape') { event.preventDefault(); cancelHotkey(); return }
  if (event.key === 'Enter') { event.preventDefault(); return }
  event.preventDefault()
  if (['Control', 'Alt', 'Shift', 'Meta'].includes(event.key)) return
  if (!(event.ctrlKey || event.altKey || event.metaKey)) return
  const key = event.code === 'Space' ? 'Space' : event.key.length === 1 ? event.key.toUpperCase() : event.key
  hotkey.value = [...(event.ctrlKey ? ['Control'] : []), ...(event.altKey ? ['Alt'] : []), ...(event.shiftKey ? ['Shift'] : []), ...(event.metaKey ? ['Super'] : []), key].join('+')
}
function keydown(event: KeyboardEvent) {
  if (event.isComposing || desktop.searchComposing || event.keyCode === 229 || event.defaultPrevented) return
  const target = event.target as HTMLElement
  if (target.closest('[data-hotkey]')) return
  if (event.key === 'Escape') {
    event.preventDefault()
    if (desktop.page === 'launcher' && desktop.query) desktop.query = ''
    else if (desktop.page !== 'launcher') {
      if (settings.value?.escHide) void desktop.hide()
      else desktop.navigate('launcher')
    } else void desktop.hide()
    return
  }
  if (desktop.page !== 'launcher' || !resultCount.value || desktop.busy || desktop.searchActionBusy) return
  if (target.closest('.command-context-menu, .brand-button')) return
  const resultTarget = target.closest('.command-launch, .search-result-open')
  if (event.key === 'Enter' && (target === search.value || resultTarget)) {
    event.preventDefault()
    const result = selectableResults.value[selected.value]
    if (result && 'command' in result && result.command) void desktop.run(result.command)
    else if (result && 'item' in result && result.item && 'providerId' in result && result.providerId) {
      const action = result.item.actions.find(action => action.id === 'open') ?? result.item.actions[0]
      if (action) void desktop.performSearchAction(result.providerId, result.item, action.id)
    }
    return
  }
  const movement = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].indexOf(event.key)
  if (movement === -1 || (target !== search.value && !resultTarget)) return
  event.preventDefault()
  const rowIndex = navigationRows.value.findIndex(row => selected.value >= row.offset && selected.value < row.offset + row.count)
  const row = navigationRows.value[rowIndex]
  if (!row) return
  if (movement < 2) selected.value = (selected.value + (movement === 0 ? resultCount.value - 1 : 1)) % resultCount.value
  else {
    const nextRow = navigationRows.value[(rowIndex + (movement === 2 ? navigationRows.value.length - 1 : 1)) % navigationRows.value.length]
    if (nextRow) selected.value = nextRow.offset + Math.min(selected.value - row.offset, nextRow.count - 1)
  }
  const selectedResult = document.querySelector<HTMLButtonElement>(`[data-command-index="${selected.value}"], [data-search-index="${selected.value}"]`)
  if (target !== search.value) selectedResult?.focus()
  selectedResult?.scrollIntoView({ block: 'nearest' })
}
let media: MediaQueryList | undefined
let unsubscribeHotkey: (() => void) | undefined
function receiveHotkey(event: DesktopEvent) {
  if (event.type === 'hotkey' && capturingHotkey.value && document.activeElement === hotkeyInput.value) hotkey.value = event.value
}
function syncSystemTheme(event: MediaQueryListEvent) { systemDark.value = event.matches }
onMounted(() => {
  layoutActive = true
  layoutObserver = new ResizeObserver(scheduleLauncherHeight)
  observeLauncherLayout()
  media = window.matchMedia('(prefers-color-scheme: dark)')
  systemDark.value = media.matches
  media.addEventListener('change', syncSystemTheme)
  window.addEventListener('keydown', keydown)
  window.addEventListener('blur', releaseHotkeyCapture)
  window.addEventListener('focus', restoreHotkeyCapture)
  unsubscribeHotkey = window.desktop?.subscribe(receiveHotkey)
  void desktop.initialize().then(() => nextTick(() => search.value?.focus()))
})
onUnmounted(() => {
  layoutActive = false
  layoutObserver?.disconnect()
  if (layoutFrame !== undefined) cancelAnimationFrame(layoutFrame)
  unsubscribeHotkey?.()
  media?.removeEventListener('change', syncSystemTheme)
  window.removeEventListener('keydown', keydown)
  window.removeEventListener('blur', releaseHotkeyCapture)
  window.removeEventListener('focus', restoreHotkeyCapture)
  void releaseHotkeyCapture()
  desktop.dispose()
})
</script>

<template>
  <div class="app-shell" :class="{ dark, compact: settings?.compact, collapsed: !launcherExpanded }" :data-accent="settings?.accent ?? 'green'">
    <header ref="header" class="search-header">
      <button v-if="desktop.page !== 'launcher'" class="back-button" aria-label="返回启动器" @click="desktop.navigate('launcher')"><AppIcon name="back" /></button>
      <input ref="search" v-model="desktop.query" class="search-input" data-testid="launcher-query" type="search" aria-label="搜索应用、文件和指令" placeholder="搜索应用、文件和指令" autocomplete="off" spellcheck="false" :disabled="desktop.loading || !desktop.snapshot" @compositionstart="desktop.setSearchComposing(true)" @compositionend="desktop.setSearchComposing(false)" />
      <button class="brand-button" aria-label="打开设置" title="NextTools · 设置" @click="desktop.navigate('settings')"><AppIcon name="brand" /></button>
    </header>

    <div v-if="desktop.error" ref="errorStrip" class="error-strip" role="alert"><span>{{ desktop.error }}</span><button v-if="!desktop.snapshot" @click="desktop.initialize()">重新连接</button><button v-else aria-label="关闭错误提示" @click="desktop.error = ''"><AppIcon name="close" /></button></div>
    <main v-if="desktop.loading" ref="stateMessage" class="state-message" role="status">正在连接桌面运行时…</main>
    <main v-else-if="!desktop.snapshot" ref="stateMessage" class="state-message"><AppIcon name="command" /><h1>无法连接桌面运行时</h1><p>未读取到设置和指令。请重试连接，或重新打开应用。</p><button class="text-button" @click="desktop.initialize()">重新连接</button></main>
    <main v-else-if="desktop.page === 'launcher' && launcherExpanded" class="launcher" aria-label="启动器" :aria-busy="desktop.busy">
      <div ref="launcherContent" class="launcher-content">
      <section v-for="section in commandSections" :key="section.id" :aria-labelledby="`${section.id}-heading`" :data-command-section="section.id">
        <div class="section-heading"><h1 :id="`${section.id}-heading`">{{ section.title }}</h1><button v-if="section.total > 18" class="section-expand" :aria-expanded="expandedSections.includes(section.id)" @click="toggleSection(section.id)">{{ expandedSections.includes(section.id) ? '收起' : `展开 (${section.total})` }}</button></div>
        <div v-if="section.commands.length" class="command-grid"><CommandTile v-for="(command, index) in section.commands" :key="command.id" :command="command" :index="section.offset + index" :selected="selected === section.offset + index" :pinned="desktop.snapshot.pinned.includes(command.id)" :disabled="desktop.busy" @select="selected = section.offset + index" @run="desktop.run(command)" @pin="desktop.pin(command)" /></div>
      </section>
      <template v-if="searchMode">
        <section v-if="bestResults.length" data-command-section="results" aria-labelledby="results-heading">
          <div class="section-heading"><h1 id="results-heading">最佳搜索结果</h1><button v-if="bestTotal > 18" class="section-expand" data-testid="best-results-expand" :aria-expanded="expandedSections.includes('results')" :disabled="desktop.searchLoading" @click="toggleSection('results')">{{ expandedSections.includes('results') ? '收起' : `展开 (${bestTotal})` }}</button></div>
          <div class="command-grid">
            <template v-for="(result, index) in visibleBestResults" :key="result.kind === 'command' ? result.command.id : result.item.id">
              <CommandTile v-if="result.kind === 'command'" :command="result.command" :index="index" :selected="selected === index" :pinned="desktop.snapshot.pinned.includes(result.command.id)" :disabled="desktop.busy" @select="selected = index" @run="desktop.run(result.command)" @pin="desktop.pin(result.command)" />
              <div v-else class="command-tile application-tile" :class="{ selected: selected === index }" data-testid="search-result-row" :data-result-id="result.item.id" :data-result-index="index">
                <button class="command-launch search-result-open" :data-search-index="index" data-testid="search-result-open" :title="result.item.name" :aria-label="`打开${result.item.name}`" :aria-current="selected === index ? 'true' : undefined" :disabled="desktop.busy || desktop.searchActionBusy" @focus="selected = index" @click="desktop.performSearchAction('applications', result.item, 'open')"><span class="command-icon"><img v-if="result.item.iconUrl" class="application-icon" :src="result.item.iconUrl" alt="" /><AppIcon v-else :name="result.item.icon ?? 'command'" /></span><span class="command-title">{{ result.item.name }}</span></button>
              </div>
            </template>
          </div>
        </section>
        <div v-if="applicationGroup && (applicationGroup.status !== 'ready' || applicationGroup.message)" class="search-provider-status" data-testid="search-provider-status" :data-provider-id="applicationGroup.providerId" :data-status="applicationGroup.status" role="status">{{ applicationGroup.message || '应用搜索暂时不可用。' }}<button v-if="applicationGroup.status !== 'ready'" class="text-button" :disabled="desktop.searchLoading" @click="desktop.searchLauncher()">重试</button></div>
        <p v-if="desktop.searchLoading" class="search-provider-progress" data-testid="search-loading" role="status">正在搜索…</p>
        <div v-if="desktop.searchError" class="error-strip" data-testid="search-error" role="alert"><span>{{ desktop.searchError }}</span><button class="text-button" data-testid="search-provider-retry" :disabled="desktop.searchLoading" @click="desktop.searchLauncher()">重试</button></div>
        <SearchProviderResults v-for="section in providerSections" :key="section.group.providerId" :group="section.group" :offset="section.offset" :selected="selected" :loading="desktop.searchLoading" :disabled="desktop.busy || desktop.searchActionBusy" @select="selected = $event" @action="desktop.performSearchAction" @retry="desktop.searchLauncher()" @load-more="desktop.searchLauncher" />
        <p v-if="desktop.searchFeedback" class="search-feedback" data-testid="search-feedback" role="status">{{ desktop.searchFeedback }}</p>
      </template>
      <div v-if="!resultCount && !desktop.searchLoading && !desktop.searchError && !desktop.searchGroups.some(group => group.status !== 'ready')" class="empty-state"><h2>{{ searchMode ? '没有匹配的结果' : '暂无可用指令' }}</h2><p>{{ searchMode ? '试试应用名称、文件名、路径或指令关键词。' : '打开设置查看已安装插件，或搜索其他指令。' }}</p><button v-if="!searchMode" class="text-button" @click="desktop.navigate('plugins')">查看已安装插件</button></div>
      </div>
    </main>
    <div v-else-if="desktop.page !== 'launcher' && desktop.page !== 'plugin-market'" class="settings-layout">
      <nav class="settings-sidebar" aria-label="设置导航"><button v-for="item in navigation" :key="item.id" :class="{ active: desktop.page === item.id }" :aria-current="desktop.page === item.id ? 'page' : undefined" @click="desktop.navigate(item.id)"><AppIcon :name="item.icon" />{{ item.label }}</button></nav>
      <main class="settings-content" :aria-busy="desktop.busy">
        <template v-if="desktop.page === 'settings' && settings">
          <h1 class="sr-only">通用设置</h1>
          <div class="setting-row"><div><label for="hotkey">呼出快捷键</label><p>点击输入框录入组合键，再点击保存</p></div><form class="hotkey-control" @submit.prevent="saveHotkey"><input id="hotkey" ref="hotkeyInput" v-model="hotkey" data-hotkey aria-describedby="hotkey-hint" :disabled="desktop.busy" @focus="startHotkeyCapture" @blur="releaseHotkeyCapture" @keydown="captureHotkey" @keyup.stop /><button type="submit" :disabled="desktop.busy || hotkey === settings.hotkey || !hotkey.trim()">保存</button><button type="button" :disabled="desktop.busy || hotkey === settings.hotkey" @click="cancelHotkey">取消</button><span id="hotkey-hint" class="sr-only">按下包含 Control、Alt 或 Super 的组合键，然后点击保存。Escape 取消修改，不会隐藏窗口。</span></form></div>
          <div class="setting-row"><div><label id="autostart-label">开机自启</label><p>登录电脑后自动运行 NextTools</p></div><button class="switch" role="switch" aria-labelledby="autostart-label" :aria-checked="settings.autostart" :disabled="desktop.busy" @click="desktop.update({ autostart: !settings.autostart })"><span /></button></div>
          <div class="setting-row"><div><label id="compact-label">紧凑顶部栏</label><p>缩小搜索框，留出更多内容空间</p></div><button class="switch" role="switch" aria-labelledby="compact-label" :aria-checked="settings.compact" :disabled="desktop.busy" @click="desktop.update({ compact: !settings.compact })"><span /></button></div>
          <div class="setting-row"><div><label id="escape-label">ESC 隐藏</label><p>默认返回搜索；开启后在页面中按 Esc 隐藏窗口，下次唤出保留当前页面</p></div><button class="switch" role="switch" aria-labelledby="escape-label" :aria-checked="settings.escHide" :disabled="desktop.busy" @click="desktop.update({ escHide: !settings.escHide })"><span /></button></div>
          <section class="setting-row update-row" aria-labelledby="update-heading" :aria-busy="updateInProgress">
            <div class="update-info">
              <h2 id="update-heading">在线更新</h2>
              <template v-if="desktop.updateState">
                <p>当前版本 v{{ desktop.updateState.currentVersion }}<template v-if="desktop.updateState.version"> · 更新版本 v{{ desktop.updateState.version }}</template></p>
                <p class="update-status" :role="desktop.updateState.status === 'error' ? 'alert' : 'status'">{{ updateLabels[desktop.updateState.status] }}<template v-if="desktop.updateState.status !== 'downloading' && desktop.updateState.message"> · {{ desktop.updateState.message }}</template></p>
                <div v-if="desktop.updateState.status === 'downloading' && desktop.updateState.progress" class="update-progress">
                  <progress :value="updatePercent" max="100" aria-label="更新下载进度" />
                  <span>{{ updatePercent.toFixed(1) }}% · {{ (desktop.updateState.progress.transferred / 1024 / 1024).toFixed(1) }} / {{ (desktop.updateState.progress.total / 1024 / 1024).toFixed(1) }} MB</span>
                </div>
                <p v-if="desktop.updateState.status === 'downloaded'">重启后安装更新，请先保存正在进行的工作。</p>
              </template>
              <p v-else-if="!desktop.updateError" role="status">正在读取更新状态…</p>
              <p v-if="desktop.updateError" role="alert">{{ desktop.updateError }}</p>
            </div>
            <div class="update-actions">
              <button v-if="!desktop.updateState" class="text-button" :disabled="updateInProgress" @click="desktop.refreshUpdateState()">重新读取状态</button>
              <button v-else-if="desktop.updateState.status === 'downloaded'" class="text-button" :disabled="updateInProgress" @click="desktop.installUpdate()">重启并安装</button>
              <button v-else-if="desktop.updateState.status === 'available'" class="text-button" :disabled="updateInProgress" @click="desktop.downloadUpdate()">下载更新</button>
              <button v-else class="text-button" :disabled="!desktop.updateState.supported || updateInProgress" @click="desktop.checkForUpdates()">{{ desktop.updateState.status === 'error' ? '重新检查更新' : '检查更新' }}</button>
            </div>
          </section>
        </template>
        <template v-else-if="desktop.page === 'theme' && settings">
          <h1 class="sr-only">外观主题</h1>
          <div class="setting-row"><div><label for="theme">主题设置</label><p>选择应用的主题外观</p></div><select id="theme" ref="themeControl" :value="settings.theme" :disabled="desktop.busy" @change="changeTheme"><option value="system">跟随系统</option><option value="light">亮色</option><option value="dark">暗色</option></select></div>
          <div class="setting-row"><div><h2 id="accent-label">主题色</h2><p>自定义应用的主题色调</p></div><div class="accent-options" role="group" aria-labelledby="accent-label"><button v-for="accent in accents" :key="accent.id" class="accent-swatch" :data-swatch="accent.id" :aria-label="accent.label" :aria-pressed="settings.accent === accent.id" :disabled="desktop.busy" @click="desktop.update({ accent: accent.id })"><span v-if="settings.accent === accent.id" /></button></div></div>
        </template>
        <template v-else-if="desktop.page === 'plugins'">
          <div class="plugins-heading"><h1>已安装插件</h1><span>{{ desktop.snapshot.plugins.length }} 个插件</span></div>
          <p v-if="!desktop.snapshot.plugins.length" class="inline-empty">运行时尚未注册插件。插件加载后会显示在这里。</p>
          <article v-for="plugin in desktop.snapshot.plugins" :key="plugin.id" class="plugin-row"><span class="plugin-icon"><AppIcon name="puzzle" /></span><div class="plugin-info"><h2>{{ plugin.name }} <span class="plugin-version">v{{ plugin.version }}</span></h2><p>{{ plugin.id }}</p><span class="plugin-status">{{ plugin.status }}<template v-if="plugin.protected"> · 内置核心</template></span></div><button class="switch" role="switch" :aria-label="`启用${plugin.name}`" :aria-checked="plugin.enabled" :disabled="desktop.busy || plugin.protected" @click="desktop.togglePlugin(plugin.id, !plugin.enabled)"><span /></button></article>
        </template>
      </main>
    </div>
    <PluginMarket v-show="desktop.page === 'plugin-market' && !!desktop.snapshot && !desktop.loading" :active="desktop.page === 'plugin-market' && !!desktop.snapshot && !desktop.loading" @back="desktop.navigate('launcher')" />
    <footer v-if="desktop.snapshot && desktop.page === 'launcher' && launcherExpanded" ref="footer" class="launcher-footer"><span><kbd>↑ ↓ ← →</kbd> 选择 <kbd>Enter</kbd> 打开</span><span><kbd>Esc</kbd> {{ searchMode ? '清除搜索' : '隐藏窗口' }}</span></footer>
  </div>
</template>
