<script setup lang="ts">
// 数据和动作由 Cordis facade 提供，展示层不持有第二份应用状态。
defineProps<{searching:boolean}>()
</script>
<template><div class="aggregate-view"><div v-if="!searching" class="content-section"><slot name="home" /></div><div v-else class="search-results"><slot name="results" /></div><div class="content-section"><slot /></div></div></template>
<style scoped>
.aggregate-view {
  display: flex;
  flex-direction: column;
}

.content-section {
  flex: 1;
}

.search-results {
  display: flex;
  flex-direction: column;
}
</style>
