<template>
  <div ref="containerRef" class="app-container">
    <div class="search-window">
      <div class="search-box-wrapper">
        <SearchBox ref="searchBoxRef" :model-value="desktop.query"
          @update:model-value="handleSearchQueryChange" @composing="desktop.setSearchComposing"
          @arrow-keydown="handleArrowKeydown" @navigate="emit('navigate', $event)" />
      </div>
      <SearchResults ref="searchResultsRef" :search-query="desktop.query"
        @height-changed="updateWindowHeight" @focus-input="handleFocusInput" @navigate="emit('navigate', $event)" />
    </div>
  </div>
</template>
<script setup lang="ts">
import { nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { useDesktopStore } from '../../../../src/client/store'
import type { Page } from '../../../../src/shared/contracts'
import SearchBox from './components/search/SearchBox.vue'
import SearchResults from './components/search/SearchResults.vue'
import './style.css'
const emit = defineEmits<{ navigate: [page: Page] }>()
const desktop = useDesktopStore()
const containerRef = ref<HTMLElement>()
const searchBoxRef = ref<InstanceType<typeof SearchBox>>()
const searchResultsRef = ref<InstanceType<typeof SearchResults>>()
let observer: ResizeObserver | undefined
let lastHeight = 0
let resizeFrame = 0
// 用户输入写入共享查询，由宿主处理异步搜索和过期请求。
function handleSearchQueryChange(value: string): void { desktop.query = value }
// 原版导航组件接管方向和确认键，Escape 只清查询、从不隐藏窗口。
function handleArrowKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') {
    event.preventDefault()
    desktop.query = ''
    searchResultsRef.value?.resetSelection()
    handleFocusInput()
  } else searchResultsRef.value?.handleKeydown(event)
}
// 显示窗口和返回页面只恢复输入焦点，不清理查询、折叠或滚动状态。
function handleFocusInput(): void { if (desktop.page === 'launcher') void nextTick(() => searchBoxRef.value?.focus()) }
// 使用实际布局高度去重并按帧合并，避免 ResizeObserver 与原生窗口反复互调。
function updateWindowHeight(): void {
  cancelAnimationFrame(resizeFrame)
  resizeFrame = requestAnimationFrame(() => {
    const height = Math.ceil(containerRef.value?.getBoundingClientRect().height ?? 0) + 1
    if (height > 1 && height !== lastHeight && desktop.page === 'launcher') {
      lastHeight = height
      void desktop.setLauncherHeight(height)
    }
  })
}
watch(() => desktop.focusRequest, () => { lastHeight = 0; handleFocusInput(); updateWindowHeight() })
watch(() => desktop.page, (page) => { if (page === 'launcher') { lastHeight = 0; handleFocusInput(); updateWindowHeight() } })
onMounted(() => {
  observer = new ResizeObserver(updateWindowHeight)
  if (containerRef.value) observer.observe(containerRef.value)
  handleFocusInput()
  updateWindowHeight()
})
onUnmounted(() => { observer?.disconnect(); cancelAnimationFrame(resizeFrame) })
</script>
<style scoped>
.app-container {
  width: 100%;
  display: flex;
  flex-direction: column;
  outline: none;
  overflow: hidden; /* 隐藏所有滚动条 */
  border-radius: 8px; /* Windows 11 圆角 */
}
.app-container__plugin {
  border-radius: 0;
}
.search-window {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  position: relative;
  z-index: 1;
  /* overflow: hidden; 隐藏所有滚动条 */
  /* border-radius: 8px; Windows 11 圆角 */
}

.search-wallpaper-layer {
  position: absolute;
  z-index: 0;
  pointer-events: none;
  user-select: none;
  background-position: center;
  background-size: cover;
  background-repeat: no-repeat;
  transform: translateZ(0);
  transition:
    opacity 0.2s ease,
    filter 0.2s ease;
  will-change: opacity, filter;
}

.search-box-wrapper {
  flex-shrink: 0;
}

.plugin-placeholder {
  flex: 1;
  /* min-height: 500px; */
  background: transparent; /* 透明背景，让下方的 BrowserView 和 Mica 材质显示 */
  -webkit-app-region: no-drag; /* 禁止拖动窗口 */
  user-select: none; /* 禁止选取文本 */
}
</style>
