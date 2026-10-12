<script setup lang="ts">
import { computed } from 'vue'
const props = withDefaults(defineProps<{title:string; total:number; expanded:boolean; defaultVisibleRows?:number; disabled?:boolean; testId?:string}>(), { defaultVisibleRows:2 })
const emit=defineEmits<{ 'update:expanded':[value:boolean] }>()
// 按九列计算折叠区可见数量。
const canExpand=computed(()=>props.total>9*props.defaultVisibleRows)
// 标题与按钮共用同一展开操作。
function toggleExpand(){ if(!props.disabled && canExpand.value) emit('update:expanded',!props.expanded) }
</script>
<template><section v-if="total" class="collapsible-section"><div class="section-header" :class="{clickable:canExpand}" @click="toggleExpand"><h1 class="section-title">{{title}}</h1><button v-if="canExpand" class="expand-btn-text" :data-testid="testId" :aria-expanded="expanded" :disabled="disabled" @click.stop="toggleExpand">{{expanded?'收起':`展开 (${total})`}}</button></div><div class="list-content"><slot /></div></section></template>
<style scoped>
.collapsible-section {
  display: flex;
  flex-direction: column;
  margin-bottom: 4px; /* 列表间距 */
}

.section-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0 12px;
}

.list-content {
  margin-top: 2px; /* 与结果项间距保持一致，确保标题和内容之间有间距 */
}

/* 可点击的标题行（只在可展开时应用） */
.section-header.clickable {
  cursor: pointer;
  margin: 0;
  padding: 2px 12px;
  min-height: 28px;
}

.section-header.clickable:hover {
  background: var(--hover-bg);
}

/* 不可展开的标题行 */
.section-header:not(.clickable) {
  margin: 0;
  padding: 2px 12px;
  min-height: 28px;
}

.section-title {
  font-size: 14.5px;
  font-weight: 600;
  padding: 0; /* 移除内边距 */
  line-height: 24px; /* 控制行高 */
}

.expand-btn-text {
  font-size: 14px;
  opacity: 0.6;
  user-select: none;
  white-space: nowrap; /* 防止文本换行 */
}

/* 只在可点击状态下，hover 时改变透明度 */
.section-header.clickable:hover .expand-btn-text {
  opacity: 1;
}
</style>
