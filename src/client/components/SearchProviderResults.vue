<script setup lang="ts">
import type { LauncherSearchGroup, LauncherSearchItem } from '../../shared/contracts'
import AppIcon from './AppIcon.vue'

defineProps<{ group: LauncherSearchGroup; offset: number; selected: number; loading: boolean; disabled: boolean }>()
defineEmits<{ select: [index: number]; action: [providerId: string, item: LauncherSearchItem, action: string]; retry: []; loadMore: [providerId: string] }>()
function primaryAction(item: LauncherSearchItem) { return item.actions.find(action => action.id === 'open') ?? item.actions[0] }
function secondaryActions(item: LauncherSearchItem) { return item.actions.filter(action => action.id !== primaryAction(item)?.id) }
function size(item: LauncherSearchItem) {
  if (item.isDirectory || item.size === null) return '—'
  if (item.size < 1024) return `${item.size} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let value = item.size / 1024
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit++ }
  return `${value.toFixed(1)} ${units[unit]}`
}
function modified(item: LauncherSearchItem) {
  if (!item.modifiedAt) return '—'
  const date = new Date(item.modifiedAt)
  return Number.isNaN(date.getTime()) ? item.modifiedAt : date.toLocaleString()
}
</script>

<template>
  <section class="search-provider" data-testid="search-provider" :data-provider-id="group.providerId" :data-status="group.status" :aria-label="group.title" :aria-busy="loading">
    <div class="section-heading"><h1>{{ group.title }}</h1><span>{{ group.items.length }} / {{ group.total }} 项结果</span></div>
    <div v-if="group.status !== 'ready' || group.message" class="search-provider-status" data-testid="search-provider-status" role="status"><span>{{ group.message || '搜索提供者暂时不可用。' }}</span><button v-if="group.status !== 'ready'" class="text-button" data-testid="search-provider-retry" :disabled="loading" @click="$emit('retry')">重试</button></div>
    <p v-if="group.status === 'ready' && !group.items.length && !loading" class="inline-empty">没有匹配的结果</p>
    <ul v-if="group.items.length" class="search-results" aria-label="匹配结果">
      <li v-for="(item, index) in group.items" :key="item.id" class="search-result-row" :class="{ selected: selected === offset + index }" data-testid="search-result-row" :data-result-id="item.id" :data-result-index="offset + index" @mouseenter="$emit('select', offset + index)">
        <button class="search-result-open" :data-testid="`search-result-${primaryAction(item)?.id ?? 'open'}`" :data-search-index="offset + index" :title="item.path" :aria-label="`${primaryAction(item)?.label ?? '打开'}${item.name}`" :aria-current="selected === offset + index ? 'true' : undefined" :disabled="disabled || !primaryAction(item)" @focus="$emit('select', offset + index)" @click="$emit('action', group.providerId, item, primaryAction(item)!.id)">
          <AppIcon :name="item.icon ?? (item.isDirectory ? 'folder' : 'file')" /><span class="search-result-info"><strong>{{ item.name }}</strong><span class="search-result-path">{{ item.path }}</span><span class="search-result-metadata">{{ item.isDirectory ? '文件夹' : '文件' }} · {{ size(item) }} · {{ modified(item) }}</span></span>
        </button>
        <div class="search-result-actions"><button v-for="action in secondaryActions(item)" :key="action.id" class="text-button" :data-testid="`search-result-${action.id}`" :aria-label="`${action.label}：${item.name}`" :disabled="disabled" @click="$emit('action', group.providerId, item, action.id)">{{ action.label }}</button></div>
      </li>
    </ul>
    <div v-if="group.status === 'ready' && group.hasMore" class="search-provider-pagination"><button class="text-button" data-testid="search-provider-load-more" :disabled="loading" @click="$emit('loadMore', group.providerId)">{{ loading ? '加载中…' : '加载更多' }}</button></div>
  </section>
</template>
