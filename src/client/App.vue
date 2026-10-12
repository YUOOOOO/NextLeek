<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { useDesktopStore } from './store'
import AppIcon from './components/AppIcon.vue'
import CommandTile from './components/CommandTile.vue'
import CommandList from './components/product/CommandList.vue'
import AggregateView from './components/product/AggregateView.vue'
import CollapsibleList from './components/product/CollapsibleList.vue'
import DetailPanel from './components/product/DetailPanel.vue'
import VerticalList from './components/product/VerticalList.vue'
import { appendGridRows } from './components/product/navigationGrid'
import SearchProviderResults from './components/SearchProviderResults.vue'
import PluginMarket from '../../plugins/plugin-market/client.vue'
import CommandShortcuts from './components/CommandShortcuts.vue'
import type { Command, DesktopEvent, LauncherSearchItem, Settings } from '../shared/contracts'

const desktop = useDesktopStore()
const search = ref<HTMLInputElement | null>(null)
const header = ref<HTMLElement | null>(null)
const launcherContent = ref<HTMLElement | null>(null)
const footer = ref<HTMLElement | null>(null)
const errorStrip = ref<HTMLElement | null>(null)
const stateMessage = ref<HTMLElement | null>(null)
const selected = ref(0)
const hotkeyInput = ref<HTMLInputElement | null>(null)
const marketReturnPage = ref<'settings' | 'plugins'>('settings')
const market = ref<InstanceType<typeof PluginMarket> | null>(null)
let inputPointer: { id: number; x: number; y: number; dragging: boolean } | undefined
let suppressInputClick = false
const capturingHotkey = ref(false)
const hotkey = ref('')
const systemDark = ref(false)
// 判断当前是否展示聚合搜索结果。
const searchMode = computed(() => desktop.query.trim().length > 0)
// 根据真实近期与固定记录决定首页是否展开。
const hasHomeHistory = computed(() => desktop.recentCommands.length > 0 || desktop.pinnedCommands.length > 0)
const expandedSections = ref<string[]>([])
// 获取真实应用搜索提供者。
const applicationGroup = computed(() => desktop.searchGroups.find(group => group.providerId === 'applications'))
// 合并真实指令和应用的最佳匹配结果。
const bestResults = computed(() => [
  ...desktop.results.map(command => ({ kind: 'command' as const, command })),
  ...(applicationGroup.value?.items ?? []).map(item => ({ kind: 'application' as const, item })),
])
// 按真实提供者总数展示展开数量。
const bestTotal = computed(() => desktop.results.length + (applicationGroup.value?.total ?? 0))
// 默认展示九列两行，展开后展示已加载结果。
const visibleBestResults = computed(() => expandedSections.value.includes('results') ? bestResults.value : bestResults.value.slice(0, 18))
// 保留近期与固定分组的展开状态和导航偏移。
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
// 汇总首页可导航的真实指令。
const visibleCommands = computed(() => commandSections.value.flatMap(section => section.commands))
// 为文件等竖向提供者计算选择偏移。
const providerSections = computed(() => {
  let offset = searchMode.value ? visibleBestResults.value.length : visibleCommands.value.length
  return desktop.searchGroups.filter(group => group.providerId !== 'applications').map(group => { const section = { group, offset }; offset += group.items.length; return section })
})
// 将视觉结果映射为宿主可执行的对象。
const selectableResults = computed<Array<{ command: Command } | { providerId: string; item: LauncherSearchItem }>>(() => searchMode.value ? [
  ...visibleBestResults.value.map(result => result.kind === 'command' ? { command: result.command } : { providerId: 'applications', item: result.item }),
  ...providerSections.value.flatMap(({ group }) => group.items.map(item => ({ providerId: group.providerId, item }))),
] : visibleCommands.value.map(command => ({ command })))
// 统计当前可键盘选择的结果。
const resultCount = computed(() => selectableResults.value.length)
// 区分聚合九列与提供者单列导航。
const navigationSections = computed(() => [
  ...(searchMode.value ? [{ offset: 0, count: visibleBestResults.value.length, columns: 9 }] : commandSections.value.map(section => ({ offset: section.offset, count: section.commands.length, columns: 9 }))),
  ...providerSections.value.map(section => ({ offset: section.offset, count: section.group.items.length, columns: 1 })),
].filter(section => section.count))
// 复用上游聚合九列/单列导航分行，保留当前选择与执行权威。
const navigationRows = computed(() => navigationSections.value.flatMap(section => {
  const rows: Array<{type:string;items:number[]}> = []
  appendGridRows(rows, 'results', Array.from({length:section.count},(_,index)=>section.offset+index),section.columns)
  return rows.map(row=>({offset:row.items[0]!,count:row.items.length}))
}))
// 展开分组时按需获取剩余应用，查询变化后停止加载。
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
// 根据当前页面和真实状态决定窗口展开。
const launcherExpanded = computed(() => desktop.page !== 'launcher' || searchMode.value || hasHomeHistory.value || Boolean(desktop.error) || desktop.loading || !desktop.snapshot)
// 读取 Cordis 快照的设置。
const settings = computed(() => desktop.snapshot?.settings)
// 组合用户主题与系统主题。
const dark = computed(() => settings.value?.theme === 'dark' || (settings.value?.theme === 'system' && systemDark.value))
const updateLabels = {
  unsupported: '当前安装方式不支持在线更新', idle: '尚未检查更新', checking: '正在检查更新…',
  available: '发现新版本', 'not-available': '已是最新版本', downloading: '正在下载更新…',
  downloaded: '更新已下载', installing: '正在重启安装…', error: '更新失败',
} as const
// 按宿主更新阶段禁用冲突操作。
const updateInProgress = computed(() => desktop.updateBusy || ['checking', 'downloading', 'installing'].includes(desktop.updateState?.status ?? ''))
// 将真实下载进度限制在可显示范围。
const updatePercent = computed(() => Math.min(100, Math.max(0, desktop.updateState?.progress?.percent ?? 0)))
const accents = [
  { id: 'blue', label: '海蓝' }, { id: 'violet', label: '紫罗兰' },
  { id: 'green', label: '松绿' }, { id: 'orange', label: '琥珀' },
  { id: 'rose', label: '玫瑰' }, { id: 'teal', label: '青碧' },
] as const
const navigation = [
  { id: 'settings', label: '通用设置', icon: 'gear' },
  { id: 'plugins', label: '已安装插件', icon: 'puzzle' },
  { id: 'plugin-market', label: '插件市场', icon: 'store' },
] as const

const pluginQuery = ref('')
const pluginFilter = ref<'all' | 'enabled' | 'disabled'>('all')
const selectedPluginId = ref<string | null>(null)
const pluginStatusLabels = { pending: '等待加载', loading: '加载中', active: '已启用', failed: '加载失败', disposed: '已停止', unloading: '停止中', disabled: '已禁用' } as const
// 插件搜索与启动器查询独立，切页或重新唤出时保留筛选。
const searchedPlugins = computed(() => {
  const query = pluginQuery.value.trim().toLocaleLowerCase()
  return (desktop.snapshot?.plugins ?? []).filter(plugin => `${plugin.name} ${plugin.id}`.toLocaleLowerCase().includes(query))
})
// 根据真实启用状态生成筛选数量，不将启用误标为进程运行中。
const pluginFilters = computed(() => [
  { id: 'all' as const, label: '全部', count: searchedPlugins.value.length },
  { id: 'enabled' as const, label: '已启用', count: searchedPlugins.value.filter(plugin => plugin.enabled).length },
  { id: 'disabled' as const, label: '已禁用', count: searchedPlugins.value.filter(plugin => !plugin.enabled).length },
])
// 只展示当前筛选下的真实运行时插件。
const visiblePlugins = computed(() => searchedPlugins.value.filter(plugin => pluginFilter.value === 'all' || plugin.enabled === (pluginFilter.value === 'enabled')))
// 详情始终引用最新快照，启停后同步更新状态。
const selectedPlugin = computed(() => desktop.snapshot?.plugins.find(plugin => plugin.id === selectedPluginId.value))
// 返回插件列表时恢复该插件入口的键盘焦点。
async function closePluginDetail() {
  const id = selectedPluginId.value
  selectedPluginId.value = null
  await nextTick()
  Array.from(document.querySelectorAll<HTMLButtonElement>('[data-plugin-detail]')).find(button => button.dataset.pluginDetail === id)?.focus()
}

// 设置更新后同步快捷键编辑框。
watch(() => settings.value?.hotkey, value => { hotkey.value = value ?? '' })
// 输入只更新搜索选择，不把其他页面的查询强制切回首页。
watch(() => desktop.query, () => { selected.value = 0; expandedSections.value = [] })
// 结果变化时保证键盘选择仍在有效范围内。
watch(resultCount, count => { selected.value = Math.min(selected.value, Math.max(0, count - 1)) })
let layoutObserver: ResizeObserver | undefined
let layoutFrame: number | undefined
let layoutActive = false
let requestedLauncherHeight: number | undefined
// 内容变化后按实际高度调整原生窗口，最高不超过 690px。
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
// 观察动态搜索内容与状态栏，避免窗口高度滞后。
function observeLauncherLayout() {
  layoutObserver?.disconnect()
  for (const element of [header.value, launcherContent.value, footer.value, errorStrip.value, stateMessage.value]) {
    if (element) layoutObserver?.observe(element)
  }
  scheduleLauncherHeight()
}
// DOM 引用挂载或替换后重新测量。
watch([header, launcherContent, footer, errorStrip, stateMessage], observeLauncherLayout, { flush: 'post' })
// 页面和展示模式改变时更新窗口布局。
watch([() => desktop.page, () => desktop.searchLoading, launcherExpanded, () => settings.value?.compact, () => desktop.focusRequest], scheduleLauncherHeight, { flush: 'post' })
// 记录市场入口页面，返回时不跳过插件管理。
watch(() => desktop.page, (page, previous) => {
  if (page === 'plugin-market' && previous !== 'plugin-market') {
    marketReturnPage.value = previous === 'plugins' ? 'plugins' : 'settings'
  }
}, { flush: 'sync' })
// 页面切换时释放快捷键录入，仅回首页才聚焦搜索。
watch(() => desktop.page, async page => {
  selected.value = 0
  void releaseHotkeyCapture()
  await nextTick()
  if (page === 'launcher') search.value?.focus()
})
// 重新唤出只恢复焦点，不清空选择、展开状态和查询。
watch(() => desktop.focusRequest, async () => {
  await nextTick()
  if (desktop.page === 'launcher') search.value?.focus()
  else if (!document.activeElement?.closest('.settings-layout, .plugin-market')) {
    search.value?.focus()
  }
})

// 保存主题偏好。
function changeTheme(event: Event) {
  void desktop.update({ theme: (event.target as HTMLSelectElement).value as Settings['theme'] })
}
// 先释放全局快捷键捕获，再提交新组合键。
async function saveHotkey() {
  if (!hotkey.value.trim()) return
  hotkeyInput.value?.blur()
  if (!await desktop.setHotkeyCapture(false)) return
  await desktop.update({ hotkey: hotkey.value.trim() })
}
// 聚焦录入框时暂停全局唤出快捷键。
function startHotkeyCapture() {
  capturingHotkey.value = true
  void desktop.setHotkeyCapture(true)
}
// 失焦或切页时结束快捷键捕获。
async function releaseHotkeyCapture() {
  if (!capturingHotkey.value) return
  capturingHotkey.value = false
  await desktop.setHotkeyCapture(false)
}
// 窗口重新聚焦时恢复尚在编辑的快捷键捕获。
function restoreHotkeyCapture() {
  if (document.activeElement === hotkeyInput.value && !capturingHotkey.value) startHotkeyCapture()
}
// Esc 撤销快捷键草稿，不退出当前设置页面。
function cancelHotkey() { hotkey.value = settings.value?.hotkey ?? '' }
// 将组合键转换为 Electron accelerator 格式。
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
// 点击仍定位光标；按住左键移动超过阈值后才拖动窗口。
function beginInputPointer(event: PointerEvent) {
  if (event.button !== 0 || event.pointerType !== 'mouse') return
  suppressInputClick = false
  inputPointer = { id: event.pointerId, x: event.screenX, y: event.screenY, dragging: false }
  search.value?.setPointerCapture(event.pointerId)
}
// 宿主使用原生屏幕坐标移动窗口，避免窗口移动后相对坐标反馈。
function moveInputPointer(event: PointerEvent) {
  if (!inputPointer || event.pointerId !== inputPointer.id) return
  if (!(event.buttons & 1)) { endInputPointer(); return }
  if (!inputPointer.dragging && Math.hypot(event.screenX - inputPointer.x, event.screenY - inputPointer.y) >= 5) {
    inputPointer.dragging = true
    suppressInputClick = true
    void window.desktop.startWindowDrag().catch(cause => { desktop.error = String(cause); endInputPointer() })
  }
  if (inputPointer?.dragging) event.preventDefault()
}
// 松开、失焦或捕获取消时结束拖拽，避免宿主持续跟随鼠标。
function endInputPointer() {
  const pointer = inputPointer
  inputPointer = undefined
  if (!pointer) return
  if (search.value?.hasPointerCapture(pointer.id)) search.value.releasePointerCapture(pointer.id)
  if (pointer.dragging) void window.desktop.endWindowDrag().catch(cause => { desktop.error = String(cause) })
}
// 拖拽结束的合成点击不再改变光标位置。
function clickInput(event: MouseEvent) {
  if (suppressInputClick) { event.preventDefault(); suppressInputClick = false }
}
// Esc 按页面层级返回，搜索首页清空后停留，不隐藏窗口。
function keydown(event: KeyboardEvent) {
  if (event.isComposing || desktop.searchComposing || event.keyCode === 229 || event.defaultPrevented) return
  const target = event.target as HTMLElement
  if (target.closest('[data-hotkey]')) return
  if (event.key === 'Escape') {
    event.preventDefault()
    if (desktop.page === 'plugin-market') market.value?.back()
    else if (desktop.page === 'plugins' && selectedPlugin.value) void closePluginDetail()
    else if (desktop.page !== 'launcher') desktop.navigate('launcher')
    else if (desktop.query) desktop.query = ''
    else search.value?.focus()
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
// 接收宿主捕获的系统组合键，仅更新活动录入框。
function receiveHotkey(event: DesktopEvent) {
  if (event.type === 'hotkey' && capturingHotkey.value && document.activeElement === hotkeyInput.value) hotkey.value = event.value
}
// 跟随操作系统的深浅主题变化。
function syncSystemTheme(event: MediaQueryListEvent) { systemDark.value = event.matches }
// 初始化桌面状态和窗口级事件监听。
onMounted(() => {
  layoutActive = true
  layoutObserver = new ResizeObserver(scheduleLauncherHeight)
  observeLauncherLayout()
  media = window.matchMedia('(prefers-color-scheme: dark)')
  systemDark.value = media.matches
  media.addEventListener('change', syncSystemTheme)
  window.addEventListener('keydown', keydown)
  window.addEventListener('keydown', desktop.handleApplicationShortcut, true)
  window.addEventListener('blur', releaseHotkeyCapture)
  window.addEventListener('blur', endInputPointer)
  window.addEventListener('focus', restoreHotkeyCapture)
  unsubscribeHotkey = window.desktop?.subscribe(receiveHotkey)
  void desktop.initialize().then(() => nextTick(() => search.value?.focus()))
})
// 卸载时释放拖拽、观察器与所有全局监听。
onUnmounted(() => {
  endInputPointer()
  window.removeEventListener('blur', endInputPointer)
  layoutActive = false
  layoutObserver?.disconnect()
  if (layoutFrame !== undefined) cancelAnimationFrame(layoutFrame)
  unsubscribeHotkey?.()
  media?.removeEventListener('change', syncSystemTheme)
  window.removeEventListener('keydown', keydown)
  window.removeEventListener('keydown', desktop.handleApplicationShortcut, true)
  window.removeEventListener('blur', releaseHotkeyCapture)
  window.removeEventListener('focus', restoreHotkeyCapture)
  void releaseHotkeyCapture()
  desktop.dispose()
})
</script>

<template>
  <div class="app-shell" :class="{ dark, compact: settings?.compact, collapsed: !launcherExpanded }" :data-accent="settings?.accent ?? 'green'">
    <header ref="header" class="search-header">
      <button v-if="desktop.page !== 'launcher'" class="back-button" :aria-label="desktop.page === 'plugin-market' ? '返回菜单列表' : '返回启动器'" @click="desktop.navigate(desktop.page === 'plugin-market' ? marketReturnPage : 'launcher')"><AppIcon name="back" /></button>
      <input ref="search" v-model="desktop.query" class="search-input" data-testid="launcher-query" type="search" aria-label="搜索应用、文件和指令" placeholder="搜索应用、文件和指令" autocomplete="off" spellcheck="false" :disabled="desktop.loading || !desktop.snapshot" @pointerdown="beginInputPointer" @pointermove="moveInputPointer" @pointerup="endInputPointer" @pointercancel="endInputPointer" @lostpointercapture="endInputPointer" @click="clickInput" @compositionstart="desktop.setSearchComposing(true)" @compositionend="desktop.setSearchComposing(false)" />
      <button class="brand-button" aria-label="打开设置" title="NextTools · 设置" @click="desktop.navigate('settings')"><AppIcon name="brand" /></button>
    </header>

    <div v-if="desktop.error" ref="errorStrip" class="error-strip" role="alert"><span>{{ desktop.error }}</span><button v-if="!desktop.snapshot" @click="desktop.initialize()">重新连接</button><button v-else aria-label="关闭错误提示" @click="desktop.error = ''"><AppIcon name="close" /></button></div>
    <main v-if="desktop.loading" ref="stateMessage" class="state-message" role="status">正在连接桌面运行时…</main>
    <main v-else-if="!desktop.snapshot" ref="stateMessage" class="state-message"><AppIcon name="command" /><h1>无法连接桌面运行时</h1><p>未读取到设置和指令。请重试连接，或重新打开应用。</p><button class="text-button" @click="desktop.initialize()">重新连接</button></main>
    <main v-else-if="desktop.page === 'launcher' && launcherExpanded" class="launcher" :class="{ 'launcher--searching': desktop.searchLoading }" aria-label="启动器" :aria-busy="desktop.busy || desktop.searchLoading">
      <div ref="launcherContent" class="launcher-content">
      <AggregateView :searching="searchMode">
      <template #home>
      <CollapsibleList v-for="section in commandSections" :key="section.id" :title="section.title" :total="section.total" :expanded="expandedSections.includes(section.id)" :data-command-section="section.id" @update:expanded="toggleSection(section.id)">
        <CommandList :selected-index="selected"><CommandTile v-for="(command, index) in section.commands" :key="command.id" :command="command" :index="section.offset + index" :selected="selected === section.offset + index" :pinned="desktop.snapshot.pinned.includes(command.id)" :disabled="desktop.busy" @select="selected = section.offset + index" @run="desktop.run(command)" @pin="desktop.pin(command)" /></CommandList>
      </CollapsibleList>
      </template>
      <template #results>
        <CollapsibleList v-if="bestResults.length" title="最佳搜索结果" :total="bestTotal" :expanded="expandedSections.includes('results')" :disabled="desktop.searchLoading" test-id="best-results-expand" data-command-section="results" @update:expanded="toggleSection('results')">
          <CommandList :selected-index="selected">
            <template v-for="(result, index) in visibleBestResults" :key="result.kind === 'command' ? result.command.id : result.item.id">
              <CommandTile v-if="result.kind === 'command'" :command="result.command" :index="index" :selected="selected === index" :pinned="desktop.snapshot.pinned.includes(result.command.id)" :disabled="desktop.busy" @select="selected = index" @run="desktop.run(result.command)" @pin="desktop.pin(result.command)" />
              <div v-else class="command-tile application-tile" :class="{ selected: selected === index }" data-testid="search-result-row" :data-result-id="result.item.id" :data-result-index="index">
                <button class="command-launch search-result-open" :data-search-index="index" data-testid="search-result-open" :title="result.item.name" :aria-label="`打开${result.item.name}`" :aria-current="selected === index ? 'true' : undefined" :disabled="desktop.busy || desktop.searchActionBusy" @focus="selected = index" @click="desktop.performSearchAction('applications', result.item, 'open')"><span class="command-icon"><img v-if="result.item.iconUrl" class="application-icon" :src="result.item.iconUrl" alt="" /><AppIcon v-else :name="result.item.icon ?? 'command'" /></span><span class="command-title">{{ result.item.name }}</span></button>
              </div>
            </template>
          </CommandList>
        </CollapsibleList>
        <div v-if="applicationGroup && (applicationGroup.status !== 'ready' || applicationGroup.message)" class="search-provider-status" data-testid="search-provider-status" :data-provider-id="applicationGroup.providerId" :data-status="applicationGroup.status" role="status">{{ applicationGroup.message || '应用搜索暂时不可用。' }}<button v-if="applicationGroup.status !== 'ready'" class="text-button" :disabled="desktop.searchLoading" @click="desktop.searchLauncher()">重试</button></div>
        <div v-if="desktop.searchError" class="error-strip" data-testid="search-error" role="alert"><span>{{ desktop.searchError }}</span><button class="text-button" data-testid="search-provider-retry" :disabled="desktop.searchLoading" @click="desktop.searchLauncher()">重试</button></div>
        <SearchProviderResults v-for="section in providerSections" :key="section.group.providerId" :group="section.group" :offset="section.offset" :selected="selected" :loading="desktop.searchLoading" :disabled="desktop.busy || desktop.searchActionBusy" @select="selected = $event" @action="desktop.performSearchAction" @retry="desktop.searchLauncher()" @load-more="desktop.searchLauncher" />
        <p v-if="desktop.searchFeedback" class="search-feedback" data-testid="search-feedback" role="status">{{ desktop.searchFeedback }}</p>
      </template>
      </AggregateView>
      <div v-if="!resultCount && !desktop.searchLoading && !desktop.searchError && !desktop.searchGroups.some(group => group.status !== 'ready')" class="empty-state"><h2>{{ searchMode ? '没有匹配的结果' : '暂无可用指令' }}</h2><p>{{ searchMode ? '试试应用名称、文件名、路径或指令关键词。' : '打开设置查看已安装插件，或搜索其他指令。' }}</p><button v-if="!searchMode" class="text-button" @click="desktop.navigate('plugins')">查看已安装插件</button></div>
      <p v-if="desktop.searchLoading" class="search-provider-progress" data-testid="search-loading" role="status">正在搜索…</p>
      </div>
    </main>
    <div v-else-if="desktop.page !== 'launcher' && desktop.page !== 'plugin-market'" class="settings-layout">
      <nav class="settings-sidebar" aria-label="设置导航"><button v-for="item in navigation" :key="item.id" :class="{ active: desktop.page === item.id }" :aria-current="desktop.page === item.id ? 'page' : undefined" @click="desktop.navigate(item.id)"><AppIcon :name="item.icon" />{{ item.label }}</button></nav>
      <main class="settings-content" :class="{ 'installed-plugins': desktop.page === 'plugins' }" :aria-busy="desktop.busy">
        <template v-if="desktop.page === 'settings' && settings">
          <h1 class="sr-only">通用设置</h1>
          <div class="setting-row"><div><label for="hotkey">呼出快捷键</label><p>点击输入框录入组合键，再点击保存</p></div><form class="hotkey-control" @submit.prevent="saveHotkey"><input id="hotkey" ref="hotkeyInput" v-model="hotkey" data-hotkey data-shortcut-capture aria-describedby="hotkey-hint" :disabled="desktop.busy" @focus="startHotkeyCapture" @blur="releaseHotkeyCapture" @keydown="captureHotkey" @keyup.stop /><button type="submit" :disabled="desktop.busy || hotkey === settings.hotkey || !hotkey.trim()">保存</button><button type="button" :disabled="desktop.busy || hotkey === settings.hotkey" @click="cancelHotkey">取消</button><span id="hotkey-hint" class="sr-only">按下包含 Control、Alt 或 Super 的组合键，然后点击保存。Escape 取消修改，不会隐藏窗口。</span></form></div>
          <div class="setting-row"><div><label id="autostart-label">开机自启</label><p>登录电脑后自动运行 NextTools</p></div><button class="switch" role="switch" aria-labelledby="autostart-label" :aria-checked="settings.autostart" :disabled="desktop.busy" @click="desktop.update({ autostart: !settings.autostart })"><span /></button></div>
          <div class="setting-row"><div><label id="compact-label">紧凑顶部栏</label><p>缩小搜索框，留出更多内容空间</p></div><button class="switch" role="switch" aria-labelledby="compact-label" :aria-checked="settings.compact" :disabled="desktop.busy" @click="desktop.update({ compact: !settings.compact })"><span /></button></div>
          <div class="setting-row"><div><label for="theme">主题设置</label><p>选择应用的主题外观</p></div><select id="theme" :value="settings.theme" :disabled="desktop.busy" @change="changeTheme"><option value="system">跟随系统</option><option value="light">亮色</option><option value="dark">暗色</option></select></div>
          <div class="setting-row"><div><h2 id="accent-label">主题色</h2><p>自定义应用的主题色调</p></div><div class="accent-options" role="group" aria-labelledby="accent-label"><button v-for="accent in accents" :key="accent.id" class="accent-swatch" :data-swatch="accent.id" :aria-label="accent.label" :aria-pressed="settings.accent === accent.id" :disabled="desktop.busy" @click="desktop.update({ accent: accent.id })"><span v-if="settings.accent === accent.id" /></button></div></div>
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
        <template v-else-if="desktop.page === 'plugins'">
          <h1 class="sr-only">已安装插件</h1>
          <DetailPanel v-if="selectedPlugin" :title="selectedPlugin.name" @back="closePluginDetail">
            <section class="plugin-detail-summary">
              <span class="plugin-icon"><AppIcon name="puzzle" /></span>
              <div class="plugin-info"><div class="plugin-name"><h2>{{ selectedPlugin.name }}</h2><span class="plugin-version">v{{ selectedPlugin.version }}</span><span v-if="selectedPlugin.protected" class="plugin-protected">内置核心</span></div><p>{{ selectedPlugin.id }}</p><span class="plugin-status" :data-status="selectedPlugin.status">{{ pluginStatusLabels[selectedPlugin.status] }}</span></div>
              <button class="switch" role="switch" :aria-label="`启用${selectedPlugin.name}`" :aria-checked="selectedPlugin.enabled" :disabled="desktop.busy || selectedPlugin.protected" @click="desktop.togglePlugin(selectedPlugin.id, !selectedPlugin.enabled)"><span /></button>
            </section>
            <section class="plugin-commands" aria-label="插件指令与快捷键"><h2>指令与快捷键</h2><CommandShortcuts :commands="desktop.commands" :plugin-id="selectedPlugin.id" @updated="desktop.refreshShortcutBindings" /></section>
          </DetailPanel>
          <template v-else>
            <div class="plugins-heading">
              <div class="plugins-filters" role="group" aria-label="插件状态筛选"><button v-for="filter in pluginFilters" :key="filter.id" :class="{ active: pluginFilter === filter.id }" :aria-pressed="pluginFilter === filter.id" @click="pluginFilter = filter.id">{{ filter.label }}<span>{{ filter.count }}</span></button></div>
              <label class="plugins-search"><AppIcon name="search" /><input v-model="pluginQuery" type="search" aria-label="搜索已安装插件" placeholder="搜索已安装插件" /></label>
            </div>
            <VerticalList :apps="visiblePlugins" :disabled="desktop.busy" @select="selectedPluginId = $event.id"><template #actions="{app:plugin}"><button v-if="plugin.id === 'plugin-market'" class="text-button" :disabled="desktop.busy || !plugin.enabled" @click="desktop.navigate('plugin-market')">打开市场</button><button class="switch" role="switch" :aria-label="`启用${plugin.name}`" :aria-checked="plugin.enabled" :disabled="desktop.busy || plugin.protected" @click="desktop.togglePlugin(plugin.id,!plugin.enabled)"><span /></button></template></VerticalList>
            <div v-if="!visiblePlugins.length" class="plugins-empty"><AppIcon name="puzzle" /><h2>{{ desktop.snapshot?.plugins.length ? '未找到匹配的插件' : '暂无插件' }}</h2></div>
          </template>
        </template>
      </main>
    </div>
    <PluginMarket ref="market" v-show="desktop.page === 'plugin-market' && !!desktop.snapshot && !desktop.loading" :active="desktop.page === 'plugin-market' && !!desktop.snapshot && !desktop.loading" :open-request="desktop.openPluginRequest" @back="desktop.navigate(marketReturnPage)" @command-result="desktop.applyCommandResult" @shortcuts-updated="desktop.refreshShortcutBindings" />
    <footer v-if="desktop.snapshot && desktop.page === 'launcher' && launcherExpanded" ref="footer" class="launcher-footer"><span><kbd>↑ ↓ ← →</kbd> 选择 <kbd>Enter</kbd> 打开</span><span><kbd>Esc</kbd> {{ searchMode ? '返回搜索首页' : '搜索首页' }}</span></footer>
  </div>
</template>
