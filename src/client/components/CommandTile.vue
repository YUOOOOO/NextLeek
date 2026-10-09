<script setup lang="ts">
import type { Command } from '../../shared/contracts'
import AppIcon from './AppIcon.vue'

defineProps<{ command: Command; selected: boolean; pinned: boolean; disabled: boolean; index: number }>()
defineEmits<{ run: []; select: []; pin: [] }>()
</script>

<template>
  <div class="command-tile" :class="{ selected }" @mouseenter="$emit('select')" @contextmenu.prevent="$emit('pin')">
    <button class="command-launch" :data-command-index="index" :aria-label="command.title" :aria-current="selected ? 'true' : undefined" :disabled="disabled" :title="command.description" @focus="$emit('select')" @click="$emit('run')">
      <span class="command-icon"><AppIcon :name="command.icon" /></span>
      <span class="command-title">{{ command.title }}</span>
    </button>
    <button class="pin-action" :class="{ 'is-pinned': pinned }" :aria-label="`${pinned ? '取消固定' : '固定'}${command.title}`" :aria-pressed="pinned" :disabled="disabled" @click="$emit('pin')"><AppIcon name="pin" /></button>
  </div>
</template>
