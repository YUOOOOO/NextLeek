<script setup lang="ts">
import {nextTick,ref,watch} from 'vue'
const props=defineProps<{selectedIndex:number}>()
const list=ref<HTMLElement|null>(null)
// 复用上游选择滚入可视区行为，具体执行及右键仍交由宿主 tile。
watch(()=>props.selectedIndex,async()=>{ await nextTick(); const selected=list.value?.querySelector<HTMLElement>('[aria-current="true"]'); if(selected) selected.scrollIntoView({block:'nearest',inline:'nearest'}) })
</script>
<template><div ref="list" class="command-grid"><slot /></div></template>
<style scoped>
.app-list {
  flex: 1;
  overflow-y: auto;
  padding: 0 12px;
}

.command-grid {
  width:100%;
  display: grid;
  grid-template-columns: repeat(9, 1fr); /* 每行 9 个 */
  gap: 0; /* 项目之间的间隙 */
}

:deep(.command-tile){
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 8px 4px; /* 上下8px，左右4px */
  border-radius: 8px;
  cursor: pointer;
  width: 100%; /* 占满格子宽度 */
  overflow: hidden;
  user-select: none; /* 禁止文本选择 */
}

:deep(.command-tile:hover){
  background: var(--hover-bg);
}

:deep(.command-tile.selected){
  background: var(--active-bg);
}

:deep(.command-icon){
  width: 32px;
  height: 32px;
  border-radius: 6px;
  flex-shrink: 0;
}

:deep(.command-icon-placeholder){
  width: 32px;
  height: 32px;
  border-radius: 6px;
  background: var(--primary-gradient);
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-on-primary);
  font-size: 14px;
  font-weight: bold;
  flex-shrink: 0;
}

:deep(.command-icon-wrap){
  position: relative;
  margin-bottom: 6px;
}

.app-pin-badge {
  position: absolute;
  top: -4px;
  right: -4px;
  display: inline-flex;
  width: 16px;
  height: 16px;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--bg-color);
  border-radius: 50%;
  background: var(--primary-color);
  color: var(--text-on-primary);
  box-shadow: 0 1px 3px rgb(0 0 0 / 18%);
}

:deep(.command-title){
  font-size: 12px;
  font-weight: 500; /* 增加字体粗细，提高可读性 */
  line-height: 16px; /* 固定行高 */
  color: var(--text-color);
  text-align: center;
  width: 100%; /* 占满父容器宽度 */
  padding: 0 4px; /* 左右留一点边距 */
  height: 32px; /* 固定高度：16px * 2 = 32px（两行文本） */

  /* 多行文本省略 */
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2; /* 最多显示2行 */
  line-clamp: 2; /* 标准属性 */
  overflow: hidden;
  word-break: break-all; /* 允许在任意字符间断行 */
}

.empty-state {
  padding: 40px;
  text-align: center;
  color: var(--text-secondary);
  font-size: 14px;
}

/* 高亮样式 */
:deep(.command-title :deep(mark.highlight)){
  background-color: transparent; /* 不使用背景色 */
  color: var(--highlight-color); /* 橙色文字 */
  font-weight: 600;
}
</style>
