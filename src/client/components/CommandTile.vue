<script setup lang="ts">
import { nextTick, onMounted, onUnmounted, ref } from 'vue'
import type { Command } from '../../shared/contracts'
import AppIcon from './AppIcon.vue'

const props = defineProps<{ command: Command; selected: boolean; pinned: boolean; disabled: boolean; index: number }>()
const emit = defineEmits<{ run: []; select: []; pin: [] }>()
const menu = ref<HTMLDivElement | null>(null)
const launch = ref<HTMLButtonElement | null>(null)
const menuPosition = ref<{ left: number; top: number } | null>(null)
async function openMenu(event: MouseEvent | KeyboardEvent) {
  if (props.disabled) return
  event.preventDefault()
  const bounds = launch.value?.getBoundingClientRect()
  menuPosition.value = { left: event instanceof MouseEvent ? event.clientX : bounds?.left ?? 0, top: event instanceof MouseEvent ? event.clientY : bounds?.bottom ?? 0 }
  await nextTick()
  if (menu.value && menuPosition.value) {
    const rect = menu.value.getBoundingClientRect()
    menuPosition.value = { left: Math.max(0, Math.min(menuPosition.value.left, window.innerWidth - rect.width)), top: Math.max(0, Math.min(menuPosition.value.top, window.innerHeight - rect.height)) }
    menu.value.querySelector<HTMLButtonElement>('button')?.focus()
  }
}
function closeMenu() { menuPosition.value = null }
function outside(event: PointerEvent) { if (!menu.value?.contains(event.target as Node)) closeMenu() }
function menuKey(event: KeyboardEvent) {
  event.stopPropagation()
  if (event.key === 'Escape' || event.key === 'Tab') { event.preventDefault(); closeMenu(); launch.value?.focus() }
}
function pin() { closeMenu(); emit('pin'); launch.value?.focus() }
onMounted(() => { window.addEventListener('pointerdown', outside); window.addEventListener('blur', closeMenu) })
onUnmounted(() => { window.removeEventListener('pointerdown', outside); window.removeEventListener('blur', closeMenu) })
</script>

<template>
  <div class="command-tile" :class="{ selected }" @contextmenu="openMenu">
    <button ref="launch" class="command-launch" :data-command-index="index" :aria-label="command.title" :aria-current="selected ? 'true' : undefined" :disabled="disabled" :title="command.description" @focus="$emit('select')" @click="$emit('run')" @keydown="($event.key === 'ContextMenu' || ($event.shiftKey && $event.key === 'F10')) && openMenu($event)">
      <span class="command-icon"><AppIcon :name="command.icon" /></span>
      <span class="command-title">{{ command.title }}</span>
    </button>
    <Teleport to=".app-shell"><div v-if="menuPosition" ref="menu" class="command-context-menu" role="menu" :aria-label="command.title" :style="{ left: `${menuPosition.left}px`, top: `${menuPosition.top}px` }" @keydown="menuKey"><button role="menuitem" :disabled="disabled" @click="pin">{{ pinned ? '取消固定' : '固定' }}{{ command.title }}</button></div></Teleport>
  </div>
</template>
