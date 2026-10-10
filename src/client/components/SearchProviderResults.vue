<script setup lang="ts">
import { nextTick, onMounted, onUnmounted, ref } from 'vue'
import type { LauncherSearchGroup, LauncherSearchItem } from '../../shared/contracts'
import AppIcon from './AppIcon.vue'

const props = defineProps<{ group: LauncherSearchGroup; offset: number; selected: number; loading: boolean; disabled: boolean }>()
const emit = defineEmits<{ select: [index: number]; action: [providerId: string, item: LauncherSearchItem, action: string]; retry: []; loadMore: [providerId: string] }>()
const menu = ref<HTMLDivElement | null>(null)
const context = ref<{ item: LauncherSearchItem; left: number; top: number; trigger: HTMLButtonElement | null } | null>(null)
function primaryAction(item: LauncherSearchItem) { return item.actions.find(action => action.id === 'open') ?? item.actions[0] }
async function openMenu(event: MouseEvent | KeyboardEvent, item: LauncherSearchItem) {
  if (props.disabled) return
  event.preventDefault()
  const trigger = (event.currentTarget as HTMLElement).querySelector<HTMLButtonElement>('.search-result-open')
  const bounds = trigger?.getBoundingClientRect()
  context.value = { item, trigger: trigger ?? null, left: event instanceof MouseEvent ? event.clientX : bounds?.left ?? 0, top: event instanceof MouseEvent ? event.clientY : bounds?.bottom ?? 0 }
  await nextTick()
  if (context.value && menu.value) {
    const bounds = menu.value.getBoundingClientRect()
    context.value.left = Math.max(0, Math.min(context.value.left, window.innerWidth - bounds.width))
    context.value.top = Math.max(0, Math.min(context.value.top, window.innerHeight - bounds.height))
    menu.value.querySelector<HTMLButtonElement>('button')?.focus()
  }
}
function closeMenu() { context.value = null }
function outside(event: PointerEvent) { if (!menu.value?.contains(event.target as Node)) closeMenu() }
function menuKey(event: KeyboardEvent) {
  event.stopPropagation()
  if (event.key === 'Escape' || event.key === 'Tab') { event.preventDefault(); context.value?.trigger?.focus(); closeMenu() }
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault()
    const buttons = [...menu.value?.querySelectorAll<HTMLButtonElement>('button') ?? []]
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement)
    buttons[(index + (event.key === 'ArrowDown' ? 1 : buttons.length - 1)) % buttons.length]?.focus()
  }
}
function action(id: string) { if (!context.value) return; emit('action', props.group.providerId, context.value.item, id); context.value.trigger?.focus(); closeMenu() }
onMounted(() => { window.addEventListener('pointerdown', outside); window.addEventListener('blur', closeMenu) })
onUnmounted(() => { window.removeEventListener('pointerdown', outside); window.removeEventListener('blur', closeMenu) })
</script>

<template>
  <section class="search-provider" data-testid="search-provider" :data-provider-id="group.providerId" :data-status="group.status" :aria-label="group.title" :aria-busy="loading">
    <div class="section-heading"><h1>{{ group.title }}</h1><span>{{ group.items.length }} / {{ group.total }} 项结果</span></div>
    <div v-if="group.status !== 'ready' || group.message" class="search-provider-status" data-testid="search-provider-status" role="status"><span>{{ group.message || '搜索提供者暂时不可用。' }}</span><button v-if="group.status !== 'ready'" class="text-button" data-testid="search-provider-retry" :disabled="loading" @click="$emit('retry')">重试</button></div>
    <p v-if="group.status === 'ready' && !group.items.length && !loading" class="inline-empty">没有匹配的结果</p>
    <ul v-if="group.items.length" class="search-results" aria-label="匹配结果">
      <li v-for="(item, index) in group.items" :key="item.id" class="search-result-row" :class="{ selected: selected === offset + index }" data-testid="search-result-row" :data-result-id="item.id" :data-result-index="offset + index" @contextmenu="openMenu($event, item)" @keydown="($event.key === 'ContextMenu' || ($event.shiftKey && $event.key === 'F10')) && openMenu($event, item)">
        <button class="search-result-open" :data-testid="`search-result-${primaryAction(item)?.id ?? 'open'}`" :data-search-index="offset + index" :title="item.path" :aria-label="`${primaryAction(item)?.label ?? '打开'}${item.name}；右键显示更多操作`" :aria-current="selected === offset + index ? 'true' : undefined" :disabled="disabled || !primaryAction(item)" @focus="$emit('select', offset + index)" @click="$emit('action', group.providerId, item, primaryAction(item)!.id)">
          <AppIcon :name="item.icon ?? (item.isDirectory ? 'folder' : 'file')" /><span class="search-result-info"><strong>{{ item.name }}</strong><span class="search-result-path">{{ item.path }}</span></span>
        </button>
      </li>
    </ul>
    <div v-if="group.status === 'ready' && group.hasMore" class="search-provider-pagination"><button class="text-button" data-testid="search-provider-load-more" :disabled="loading" @click="$emit('loadMore', group.providerId)">{{ loading ? '加载中…' : '加载更多' }}</button></div>
    <Teleport to=".app-shell"><div v-if="context" ref="menu" class="command-context-menu" role="menu" :aria-label="context.item.name" :style="{ left: `${context.left}px`, top: `${context.top}px` }" @keydown="menuKey"><button v-for="itemAction in context.item.actions" :key="itemAction.id" role="menuitem" :data-testid="`search-result-${itemAction.id}`" :disabled="disabled" @click="action(itemAction.id)">{{ itemAction.label }}</button></div></Teleport>
  </section>
</template>
