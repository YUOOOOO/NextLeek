<script setup lang="ts">
defineEmits<{
  (e: 'click'): void
}>()
</script>
<template>
  <button class="refresh-btn" @click="$emit('click')">
    <div class="i-z-refresh font-size-14px" />
    <span>换一批</span>
  </button>
</template>

<style scoped>
.refresh-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 10px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--text-secondary);
  font-size: 12px;
  cursor: pointer;
  transition:
    color 0.15s,
    background-color 0.15s;
}

.refresh-btn:hover {
  color: var(--primary-color);
  background: var(--primary-light-bg);
}

.refresh-btn svg {
  transition: transform 0.3s ease;
}

.refresh-btn:active svg {
  transform: rotate(-180deg);
}
</style>
