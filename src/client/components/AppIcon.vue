<script setup lang="ts">
defineProps<{ name: string }>()
</script>

<template>
  <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <template v-if="name.includes('setting') || name === 'gear'">
      <path d="m9 3-1 3-3 1-2 3 2 2-1 3 3 2 2-1 3 2 2-2 3-1v-3l2-2-1-3-3-1-1-3Z" />
      <circle cx="12" cy="12" r="3" />
    </template>
    <template v-else-if="name.includes('plugin') || name === 'puzzle'">
      <path d="M9 4h6v5h3a3 3 0 0 1 0 6h-3v5H9v-5H6a3 3 0 0 1 0-6h3Z" />
    </template>
    <template v-else-if="name.includes('theme') || name === 'palette'">
      <path d="M20 13a9 9 0 1 0-8 8h2a2 2 0 0 0 1-4 2 2 0 0 1 1-4Z" />
      <circle cx="7" cy="10" r=".8" /><circle cx="10" cy="6" r=".8" /><circle cx="15" cy="7" r=".8" />
    </template>
    <template v-else-if="name === 'back'"><path d="m10 5-7 7 7 7M3 12h18" /></template>
    <template v-else-if="name === 'pin'"><path d="m9 3 6 0-1 6 4 4H6l4-4ZM12 13v8" /></template>
    <template v-else-if="name === 'close'"><path d="m6 6 12 12M18 6 6 18" /></template>
    <template v-else-if="name.includes('quit') || name === 'power'"><path d="M12 2v10M6 5a9 9 0 1 0 12 0" /></template>
    <template v-else-if="name === 'command'"><path d="M9 9H6a3 3 0 1 1 3-3v12a3 3 0 1 1-3-3h12a3 3 0 1 1-3 3V6a3 3 0 1 1 3 3ZM9 9h6v6H9Z" /></template>
    <template v-else><rect x="4" y="4" width="16" height="16" rx="4" /><path d="m9 8 4 4-4 4M14 16h3" /></template>
  </svg>
</template>
