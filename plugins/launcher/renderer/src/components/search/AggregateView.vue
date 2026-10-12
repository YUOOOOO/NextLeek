<template>
  <div class="aggregate-view">
    <!-- 无搜索时：历史记录 + 固定列表 -->
    <div v-if="!hasSearchContent" class="content-section">
      <!-- 最近使用 -->
      <CollapsibleList
        v-if="showRecentInSearch"
        :expanded="recentExpanded"
        title="最近使用"
        :apps="displayApps"
        :selected-index="getAbsoluteIndexForSection('apps')"
        :empty-text="loading ? '正在加载应用...' : '未找到应用'"
        :default-visible-rows="recentRows"
        :draggable="false"
        @select="$emit('select', $event)"
        @contextmenu="(app) => $emit('contextmenu', app, 'history')"
        @update:expanded="$emit('update:recent-expanded', $event)"
      />

      <!-- 固定栏 -->
      <CollapsibleList
        :expanded="pinnedExpanded"
        title="已固定"
        :apps="pinnedApps"
        :selected-index="getAbsoluteIndexForSection('pinned')"
        :default-visible-rows="pinnedRows"
        :draggable="false"
        @select="$emit('select', $event)"
        @contextmenu="(app) => $emit('contextmenu', app, 'pinned')"
        @update:expanded="$emit('update:pinned-expanded', $event)"
      />
    </div>
    <!-- 有搜索时：搜索结果 -->
    <div v-if="hasSearchContent" class="search-results">
      <!-- 宿主注册指令搜索结果 -->
      <CollapsibleList
        v-if="bestSearchResults.length > 0"
        :expanded="searchResultsExpanded"
        title="最佳搜索结果"
        :apps="bestSearchResults"
        :selected-index="getAbsoluteIndexForSection('bestSearch')"
        :empty-text="'未找到应用'"
        :default-visible-rows="2"
        :draggable="false"
        :search-query="searchQuery"
        @select="$emit('select', $event)"
        @contextmenu="(app) => $emit('contextmenu', app, 'search')"
        @update:expanded="$emit('update:search-results-expanded', $event)"
      />

    </div>
  </div>
</template>
<script setup lang="ts">
import { computed } from 'vue'
import CollapsibleList from '../common/CollapsibleList.vue'
import type { Command } from '../../stores/commandDataStore'
const props = withDefaults(defineProps<{ searchQuery: string; bestSearchResults: Command[]; displayApps: Command[]; pinnedApps: Command[]; navigationGrid: Array<{ type: string; items: Command[] }>; selectedRow: number; selectedCol: number; loading: boolean; showRecentInSearch: boolean; recentRows: number; pinnedRows: number; recentExpanded?: boolean; pinnedExpanded?: boolean; searchResultsExpanded?: boolean }>(), { recentExpanded: false, pinnedExpanded: false, searchResultsExpanded: false })
defineEmits<{ select: [app: Command]; contextmenu: [app: Command, source: string]; 'update:recent-expanded': [value: boolean]; 'update:pinned-expanded': [value: boolean]; 'update:search-results-expanded': [value: boolean] }>()
const hasSearchContent = computed(() => Boolean(props.searchQuery.trim()))
// 原版每行九项的分组相对索引用于高亮当前键盘选择。
function getAbsoluteIndexForSection(type: string): number {
  if (props.navigationGrid[props.selectedRow]?.type !== type) return -1
  const start = props.navigationGrid.findIndex(row => row.type === type)
  return (props.selectedRow - start) * 9 + props.selectedCol
}
</script>
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
