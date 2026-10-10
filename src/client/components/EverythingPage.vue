<script setup lang="ts">
import { computed, nextTick, onUnmounted, ref, watch } from 'vue'
import type { EverythingAction, EverythingItem, EverythingSearchRequest, EverythingStatus } from '../../shared/contracts'
import AppIcon from './AppIcon.vue'

const props = defineProps<{ active: boolean; focusRequest: number }>()
defineEmits<{ back: [] }>()
const query = ref('')
const filter = ref<EverythingSearchRequest['filter']>('all')
const sort = ref<EverythingSearchRequest['sort']>('name')
const descending = ref(false)
const status = ref<EverythingStatus | null>(null)
const checking = ref(false)
const loading = ref(false)
const items = ref<EverythingItem[]>([])
const hasMore = ref(false)
const selected = ref(0)
const error = ref('')
const feedback = ref('')
const actionBusy = ref(false)
const input = ref<HTMLInputElement | null>(null)
const root = ref<HTMLElement | null>(null)
const composing = ref(false)
const pageSize = 100
const maxItems = 1000
const canLoadMore = computed(() => hasMore.value && items.value.length < maxItems)
const fingerprint = computed(() => JSON.stringify([query.value, filter.value, sort.value, descending.value]))
let timer: ReturnType<typeof setTimeout> | undefined
let revision = 0
let statusRevision = 0
let actionRevision = 0
let disposed = false
let dirty = true

function message(cause: unknown) { return cause instanceof Error ? cause.message : String(cause) }
function cancelSearch() {
  clearTimeout(timer)
  timer = undefined
  revision++
  loading.value = false
}
function schedule() {
  cancelSearch()
  dirty = true
  items.value = []
  hasMore.value = false
  selected.value = 0
  error.value = ''
  feedback.value = ''
  if (!props.active || status.value?.status !== 'ready' || !query.value.trim() || composing.value) return
  loading.value = true
  timer = setTimeout(() => { timer = undefined; void search(false) }, 150)
}
async function search(append: boolean) {
  if (!props.active || status.value?.status !== 'ready' || !query.value.trim() || (append && (!canLoadMore.value || loading.value))) return
  clearTimeout(timer)
  timer = undefined
  const current = ++revision
  const key = fingerprint.value
  const offset = append ? items.value.length : 0
  loading.value = true
  error.value = ''
  try {
    const result = await window.desktop.searchEverything({ query: query.value, filter: filter.value, sort: sort.value, descending: descending.value, offset, limit: Math.min(pageSize, maxItems - offset) })
    if (disposed || !props.active || current !== revision || key !== fingerprint.value) return
    items.value = append ? [...items.value, ...result.items] : result.items
    hasMore.value = result.hasMore
    dirty = false
  } catch (cause) {
    if (!disposed && props.active && current === revision) { error.value = message(cause); dirty = true }
  } finally { if (!disposed && current === revision) loading.value = false }
}
async function refreshStatus() {
  cancelSearch()
  const current = ++statusRevision
  checking.value = true
  error.value = ''
  try {
    const result = await window.desktop.getEverythingStatus()
    if (disposed || !props.active || current !== statusRevision) return
    status.value = result
    if (result.status !== 'ready') { items.value = []; hasMore.value = false; dirty = true }
    else if (dirty) schedule()
  } catch (cause) { if (!disposed && props.active && current === statusRevision) error.value = message(cause) }
  finally {
    if (!disposed && current === statusRevision) {
      checking.value = false
      await nextTick()
      if (!disposed && props.active && current === statusRevision && status.value?.status === 'ready') input.value?.focus()
    }
  }
}
async function action(item: EverythingItem, kind: EverythingAction) {
  if (actionBusy.value) return
  const current = ++actionRevision
  actionBusy.value = true
  error.value = ''
  feedback.value = ''
  try {
    await window.desktop.performEverythingAction(item.id, kind)
    if (!disposed && props.active && current === actionRevision) feedback.value = kind === 'copy-path' ? `已复制路径：${item.path}` : kind === 'reveal' ? `已在资源管理器中定位：${item.name}` : `已打开：${item.name}`
  } catch (cause) { if (!disposed && props.active && current === actionRevision) error.value = message(cause) }
  finally { if (!disposed && current === actionRevision) actionBusy.value = false }
}
async function download() {
  const current = actionRevision
  error.value = ''
  try { await window.desktop.openEverythingDownload() }
  catch (cause) { if (!disposed && props.active && current === actionRevision) error.value = message(cause) }
}
function clear() { query.value = ''; schedule(); input.value?.focus() }
function parentPath(item: EverythingItem) { return item.path.slice(0, Math.max(item.path.lastIndexOf('\\'), item.path.lastIndexOf('/'))) || item.path }
function size(item: EverythingItem) {
  if (item.isDirectory || item.size === null) return '—'
  if (item.size < 1024) return `${item.size} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let value = item.size / 1024
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit++ }
  return `${value.toFixed(1)} ${units[unit]}`
}
function modified(item: EverythingItem) {
  if (!item.modifiedAt) return '—'
  const date = new Date(item.modifiedAt)
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString()
}
function keydown(event: KeyboardEvent) {
  if (event.isComposing || composing.value || event.keyCode === 229 || event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return
  const target = event.target as HTMLElement
  if (event.key === 'Escape' && query.value) {
    event.preventDefault()
    event.stopPropagation()
    query.value = ''
    input.value?.focus()
    return
  }
  if (target !== input.value && !target.closest('.everything-open')) return
  if (!items.value.length || loading.value) return
  if (event.key === 'Enter') { event.preventDefault(); const item = items.value[selected.value]; if (item) void action(item, 'open'); return }
  if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
  event.preventDefault()
  selected.value = Math.max(0, Math.min(items.value.length - 1, selected.value + (event.key === 'ArrowDown' ? 1 : -1)))
  const row = root.value?.querySelector<HTMLElement>(`[data-result-index="${selected.value}"]`)
  row?.scrollIntoView({ block: 'nearest' })
  if (target !== input.value) row?.querySelector<HTMLButtonElement>('.everything-open')?.focus()
}
watch(fingerprint, schedule)
watch(() => props.active, async active => {
  if (!active) {
    if (loading.value) dirty = true
    cancelSearch()
    statusRevision++
    actionRevision++
    checking.value = false
    actionBusy.value = false
    query.value = ''
    items.value = []
    selected.value = 0
    hasMore.value = false
    dirty = true
    return
  }
  await nextTick()
  if (disposed || !props.active) return
  input.value?.focus()
  void refreshStatus()
}, { immediate: true })
watch(() => props.focusRequest, async () => {
  await nextTick()
  if (props.active && !disposed && !root.value?.contains(document.activeElement)) input.value?.focus()
})
onUnmounted(() => { disposed = true; cancelSearch(); statusRevision++; actionRevision++ })
</script>

<template>
  <section ref="root" class="everything-page" data-testid="everything-page" aria-label="Everything 文件搜索" @keydown="keydown">
    <header class="search-header">
      <button class="back-button" data-testid="everything-back" aria-label="返回启动器" @click="$emit('back')"><AppIcon name="back" /></button>
      <input ref="input" v-model="query" class="search-input" data-testid="everything-query" type="search" aria-label="Everything 文件搜索" placeholder="搜索文件和文件夹" autocomplete="off" spellcheck="false" :disabled="checking || status?.status !== 'ready'" @compositionstart="composing = true; cancelSearch()" @compositionend="composing = false; schedule()" />
      <button v-if="query || items.length" class="clear-button" data-testid="everything-clear" aria-label="清除文件搜索和结果" title="清除文件搜索和结果" @click="clear"><AppIcon name="close" /></button>
      <span class="everything-brand">Everything</span>
    </header>
    <div class="everything-toolbar" :aria-busy="checking">
      <label>范围 <select v-model="filter" data-testid="everything-filter" :disabled="status?.status !== 'ready' || checking"><option value="all">全部</option><option value="files">文件</option><option value="folders">文件夹</option></select></label>
      <label>排序 <select v-model="sort" data-testid="everything-sort" :disabled="status?.status !== 'ready' || checking"><option value="name">名称</option><option value="path">路径</option><option value="size">大小</option><option value="modified">修改时间</option></select></label>
      <button class="text-button" data-testid="everything-direction" :aria-pressed="descending" :disabled="status?.status !== 'ready' || checking" @click="descending = !descending">{{ descending ? '降序 ↓' : '升序 ↑' }}</button>
      <button class="text-button everything-refresh" data-testid="everything-retry" :disabled="checking || loading" @click="dirty = true; refreshStatus()">{{ checking ? '检查中…' : '重新连接' }}</button>
    </div>
    <div v-if="error" class="error-strip" role="alert" data-testid="everything-error"><span>{{ error }}</span><button :disabled="checking || loading" @click="dirty = true; refreshStatus()">重试</button></div>
    <div class="everything-status" data-testid="everything-status" :data-status="checking ? 'checking' : status?.status ?? (error ? 'error' : 'checking')" role="status">
      <span>{{ checking ? '正在连接 Everything 索引…' : status?.message ?? (error ? '未能读取 Everything 状态，请重试连接。' : '正在读取 Everything 状态…') }}<template v-if="status?.version && !checking"> · v{{ status.version }}</template></span>
      <button v-if="status && status.status !== 'ready'" class="text-button" data-testid="everything-download" @click="download">Everything 官方下载</button>
    </div>
    <main class="everything-content" :aria-busy="loading" aria-label="文件搜索结果">
      <div v-if="status?.status !== 'ready'" class="empty-state"><h2>{{ status?.status === 'unsupported' ? '仅支持 Windows' : '连接 Everything 后开始搜索' }}</h2><p>{{ status?.status === 'unsupported' ? 'Everything 使用 Windows 本地文件索引，当前系统无法使用此功能。' : '请安装并启动 Everything，然后点击重新连接。无需配置 HTTP 服务。' }}</p></div>
      <template v-else>
        <p v-if="loading" class="everything-search-state" role="status">{{ items.length ? '正在加载更多结果…' : '正在搜索本地索引…' }}</p>
        <div v-if="!query.trim() && !loading" class="empty-state"><h2>查找本地文件</h2><p>输入文件名或路径，也可以使用 Everything 搜索语法。</p></div>
        <div v-else-if="!items.length && !loading && !error" class="empty-state"><h2>没有匹配的文件</h2><p>尝试更短的关键词，或将范围切换为全部。</p></div>
        <ul v-if="items.length" id="everything-results" class="everything-results" data-testid="everything-results" aria-label="匹配文件">
          <li v-for="(item, index) in items" :key="item.id" class="everything-row" :class="{ selected: selected === index }" data-testid="everything-row" :data-item-id="item.id" :data-result-index="index" @mouseenter="selected = index">
            <button class="everything-open" :title="item.path" :aria-label="`打开${item.name}`" :aria-current="selected === index ? 'true' : undefined" :disabled="actionBusy || loading" @focus="selected = index" @click="action(item, 'open')">
              <AppIcon :name="item.isDirectory ? 'folder' : 'file'" /><span class="everything-file-info"><strong>{{ item.name }}</strong><span class="everything-path">{{ parentPath(item) }}</span><span class="everything-metadata">{{ item.isDirectory ? '文件夹' : '文件' }} · {{ size(item) }} · {{ modified(item) }}</span></span>
            </button>
            <div class="everything-row-actions"><button class="text-button everything-reveal" :aria-label="`在资源管理器中显示${item.name}`" :disabled="actionBusy || loading" @click="action(item, 'reveal')">定位</button><button class="text-button everything-copy-path" :aria-label="`复制${item.name}的路径`" :disabled="actionBusy || loading" @click="action(item, 'copy-path')">复制路径</button></div>
          </li>
        </ul>
        <div v-if="canLoadMore" class="everything-pagination"><button class="text-button" data-testid="everything-load-more" :disabled="loading" @click="search(true)">{{ loading ? '加载中…' : '加载更多' }}</button></div>
        <p v-else-if="hasMore" class="everything-search-state">已显示 {{ maxItems }} 项，请缩小搜索范围查看其他结果。</p>
      </template>
    </main>
    <footer class="launcher-footer"><span><kbd>↑ ↓</kbd> 选择 <kbd>Enter</kbd> 打开 · {{ items.length }} 项已显示</span><span class="everything-feedback" role="status">{{ feedback }}</span></footer>
  </section>
</template>
