<template>
  <div ref="scrollContainerRef" class="scrollable-content" @click="handleContainerClick">
    <div class="section-header">
      <button type="button" @click.stop="windowStore.searchMode = windowStore.searchMode === 'aggregate' ? 'list' : 'aggregate'">{{ searchMode === 'aggregate' ? '列表' : '网格' }}</button>
      <button type="button" @click.stop="emit('navigate', 'plugins')">插件</button>
      <button type="button" @click.stop="emit('navigate', 'plugin-market')">插件市场</button>
    </div>
    <AggregateView v-if="searchMode === 'aggregate'"
      v-model:recent-expanded="isRecentExpanded" v-model:pinned-expanded="isPinnedExpanded"
      v-model:search-results-expanded="isSearchResultsExpanded"
      :search-query="searchQuery" :best-search-results="bestSearchResults"
      :display-apps="displayApps" :pinned-apps="pinnedApps"
      :navigation-grid="navigationGrid"
      :selected-row="selectedRow" :selected-col="selectedCol" :loading="desktop.loading"
      :show-recent-in-search="true" :recent-rows="windowStore.recentRows" :pinned-rows="windowStore.pinnedRows"
      @select="handleSelectApp" @contextmenu="handleAppContextMenu" />
    <div v-if="searchMode === 'list'" class="list-mode-results">
      <VerticalList :apps="allListModeResults" :selected-index="listModeSelectedIndex"
        :search-query="searchQuery" @select="handleSelectApp" @contextmenu="handleAppContextMenu" />
    </div>
    <CollapsibleList v-if="!hasSearchContent && searchMode === 'aggregate'" title="全部指令"
      :apps="commandDataStore.all" :expanded="true" :selected-index="sectionIndex('commands')"
      @select="handleSelectApp" @contextmenu="handleAppContextMenu" />
    <section v-for="group in commandDataStore.groups" :key="group.providerId" class="provider-group">
      <div class="section-header"><span>{{ group.title }} · {{ group.total }}</span>
        <button v-if="group.hasMore" type="button" :disabled="desktop.searchLoading" @click.stop="desktop.searchLauncher(group.providerId)">加载更多</button>
      </div>
      <p v-if="group.status !== 'ready'">{{ group.message || group.status }}</p>
      <VerticalList :apps="group.items" :selected-index="sectionIndex('provider:' + group.providerId)"
        :search-query="searchQuery" @select="handleSelectApp" @contextmenu="handleAppContextMenu" />
    </section>
    <div v-if="contextItem" class="result-actions" @click.stop>
      <span>{{ contextItem.name }}</span>
      <button v-if="contextItem.command" type="button" :disabled="desktop.busy" @click="toggleContextPin">{{ desktop.snapshot?.pinned.includes(contextItem.id) ? '取消固定' : '固定' }}</button>
      <button v-for="action in contextItem.searchItem?.actions || []" :key="action.id" type="button"
        :disabled="desktop.searchActionBusy" @click="performContextAction(action.id)">{{ action.label }}</button>
      <button type="button" @click="contextItem = null">关闭</button>
    </div>
    <p v-if="desktop.searchLoading || desktop.loading" role="status">正在搜索…</p>
    <p v-if="desktop.error || desktop.searchError" role="alert">{{ desktop.error || desktop.searchError }}</p>
    <p v-if="desktop.searchFeedback" role="status">{{ desktop.searchFeedback }}</p>
    <p v-if="hasSearchContent && !desktop.searchLoading && !bestSearchResults.length && !commandDataStore.groups.some(group => group.items.length)">未找到结果</p>
  </div>
</template>
<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { useDesktopStore } from '../../../../../../src/client/store'
import type { Page } from '../../../../../../src/shared/contracts'
import { useCommandDataStore, type Command } from '../../stores/commandDataStore'
import { useWindowStore } from '../../stores/windowStore'
import { useNavigation } from '../../composables/useNavigation'
import VerticalList from '../common/VerticalList.vue'
import CollapsibleList from '../common/CollapsibleList.vue'
import AggregateView from './AggregateView.vue'
import { buildAggregateNavigationGrid } from './navigationGrid'
const props = defineProps<{ searchQuery: string }>()
const emit = defineEmits<{ 'height-changed': []; 'focus-input': []; navigate: [page: Page] }>()
const desktop = useDesktopStore()
const windowStore = useWindowStore()
const commandDataStore = useCommandDataStore()
const scrollContainerRef = ref<HTMLElement>()
const searchMode = computed(() => windowStore.searchMode)
const hasSearchContent = computed(() => Boolean(props.searchQuery.trim()))
const bestSearchResults = computed(() => hasSearchContent.value ? commandDataStore.results : [])
const displayApps = computed(() => commandDataStore.recent)
const pinnedApps = computed(() => commandDataStore.pinned)
const allListModeResults = computed(() => hasSearchContent.value ? commandDataStore.results : commandDataStore.all)
const isRecentExpanded = ref(false)
const isPinnedExpanded = ref(false)
const isSearchResultsExpanded = ref(false)
const contextItem = ref<Command | null>(null)
// 原版九列聚合网格与安全提供者列表共用连续导航坐标。
const navigationGrid = computed(() => {
  const rows = searchMode.value === 'list'
    ? allListModeResults.value.map(item => ({ type: 'listItem', items: [item] }))
    : buildAggregateNavigationGrid({ hasSearchContent: hasSearchContent.value,
      bestSearchResults: bestSearchResults.value, displayApps: displayApps.value, pinnedApps: pinnedApps.value,
      showRecentInSearch: true, recentExpanded: isRecentExpanded.value, pinnedExpanded: isPinnedExpanded.value,
      searchResultsExpanded: isSearchResultsExpanded.value,
      recentRows: windowStore.recentRows, pinnedRows: windowStore.pinnedRows })
  if (!hasSearchContent.value && searchMode.value === 'aggregate') {
    for (let index = 0; index < commandDataStore.all.length; index += 9) rows.push({ type: 'commands', items: commandDataStore.all.slice(index, index + 9) })
  }
  for (const group of commandDataStore.groups) for (const item of group.items) rows.push({ type: 'provider:' + group.providerId, items: [item] })
  return rows
})
const { selectedRow, selectedCol, handleKeydown: navigateKey, resetSelection } = useNavigation(searchMode, navigationGrid)
const listModeSelectedIndex = computed(() => navigationGrid.value[selectedRow.value]?.type === 'listItem' ? selectedRow.value : -1)
// 按分组位置计算原版组件选中索引。
function sectionIndex(type: string): number {
  if (navigationGrid.value[selectedRow.value]?.type !== type) return -1
  const start = navigationGrid.value.findIndex(row => row.type === type)
  return (selectedRow.value - start) * (type === 'commands' ? 9 : 1) + selectedCol.value
}
// 所有鼠标和键盘启动经过相同授权契约。
function handleSelectApp(item: Command): void { contextItem.value = null; void commandDataStore.run(item) }
// 导航后滚动真正选中的原版元素，不将搜索输入移出焦点。
function handleKeydown(event: KeyboardEvent): void {
  navigateKey(event, handleSelectApp)
  void nextTick(() => scrollContainerRef.value?.querySelector('.selected')?.scrollIntoView({ block: 'nearest' }))
}
// 右键仅展示实际存在的指令固定或提供者动作。
function handleAppContextMenu(item: Command): void { contextItem.value = item }
// 点击列表空白收起动作并恢复输入焦点。
function handleContainerClick(): void { contextItem.value = null; emit('focus-input') }
// 持久化固定状态由共享宿主完成。
async function toggleContextPin(): Promise<void> { if (contextItem.value) await commandDataStore.togglePin(contextItem.value); contextItem.value = null }
// 文件与应用动作只传提供者授权的标识，不直接发送路径。
async function performContextAction(action: string): Promise<void> {
  const item = contextItem.value
  if (item?.providerId && item.searchItem) await desktop.performSearchAction(item.providerId, item.searchItem, action)
  contextItem.value = null
}
watch(() => props.searchQuery, () => { resetSelection(); contextItem.value = null })
watch(navigationGrid, () => { void nextTick(() => emit('height-changed')) })
defineExpose({ handleKeydown, resetSelection })
</script>
<style scoped>
.scrollable-content {
  max-height: 541px;
  overflow-y: auto;
  overflow-x: hidden;
  user-select: none;
  padding: 0 0 2px 0;
  border-radius: 0;
}

.list-mode-results {
  display: flex;
  flex-direction: column;
}
</style>

<style scoped>
.section-header,.result-actions { display:flex; align-items:center; gap:8px; padding:8px 12px; color:var(--text-secondary); font-size:12px; }
.section-header button,.result-actions button { color:var(--text-color); background:var(--control-bg); border:0; border-radius:6px; padding:4px 8px; cursor:pointer; }
p { padding:4px 12px; font-size:12px; color:var(--text-secondary); }
</style>
