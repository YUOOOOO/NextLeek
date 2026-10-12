<template>
  <div
    ref="searchBoxRef"
    class="search-box"
    :class="{ 'is-compact': windowStore.compactMainWindowHeader }"
    :style="{ height: `${mainWindowHeaderHeight}px` }"
    @mousedown="handleMouseDown"
  >
    <!-- 隐藏的测量元素,用于计算文本宽度 -->
    <div class="search-input-container">
      <!-- 输入框包装器：占位符和输入框在同一容器内 -->
      <div class="input-wrapper">
        <span ref="measureRef" class="measure-text"></span>
        <!-- 独立的占位符显示 -->
        <div v-if="!modelValue && !isComposing" class="placeholder-text">
          {{ currentPlaceholder }}
        </div>
        <input
          ref="inputRef"
          type="text"
          :value="modelValue"
          placeholder=""
          class="search-input"
          @input="onInput"
          @compositionstart="onCompositionStart"
          @compositionend="onCompositionEnd"
          @keydown="onKeydown"
          @keydown.left="(e) => keydownEvent(e, 'left')"
          @keydown.right="(e) => keydownEvent(e, 'right')"
          @keydown.down="(e) => keydownEvent(e, 'down')"
          @keydown.up="(e) => keydownEvent(e, 'up')"
          @keydown.enter="(e) => keydownEvent(e, 'enter')"
          @keydown.tab="(e) => keydownEvent(e, 'tab')"
        />
      </div>
    </div>

    <!-- 操作栏 -->
    <div ref="searchActionsRef" class="search-actions">
      <!-- 原版头像入口导航至安全设置页 -->
      <div
        class="avatar-wrapper"
        :class="{ 'is-default': true }"
        @click="handleSettingsClick"
      >
        <!-- 保留原版头像容器 -->
        <div class="avatar-container">
          <AdaptiveIcon
            :src="avatarUrl"
            :force-adaptive="false"
            class="search-btn is-default"
            draggable="false"
          />
        </div>
      </div>
    </div>
  </div>
</template>
<script setup lang="ts">
import { computed, onUnmounted, ref } from 'vue'
import type { Page } from '../../../../../../src/shared/contracts'
import { useDesktopStore } from '../../../../../../src/client/store'
import { DEFAULT_AVATAR, useWindowStore } from '../../stores/windowStore'
import AdaptiveIcon from '../common/AdaptiveIcon.vue'
defineProps<{ modelValue: string }>()
const emit = defineEmits<{ 'update:model-value': [value: string]; composing: [active: boolean]; 'arrow-keydown': [event: KeyboardEvent]; navigate: [page: Page] }>()
const desktop = useDesktopStore()
const windowStore = useWindowStore()
const searchBoxRef = ref<HTMLElement>()
const inputRef = ref<HTMLInputElement>()
const measureRef = ref<HTMLElement>()
const searchActionsRef = ref<HTMLElement>()
const isComposing = ref(false)
const avatarUrl = DEFAULT_AVATAR
const currentPlaceholder = '搜索应用、文件和指令'
const mainWindowHeaderHeight = computed(() => windowStore.compactMainWindowHeader ? 48 : 60)
let dragging = false
// 输入法结束前不派发搜索，结束后提交最终文本。
function onInput(event: Event): void { if (!isComposing.value) emit('update:model-value', (event.target as HTMLInputElement).value) }
// 开始组合输入时隔离异步搜索。
function onCompositionStart(): void { isComposing.value = true; emit('composing', true) }
// 组合输入完成后恢复查询并提交文本。
function onCompositionEnd(event: CompositionEvent): void { isComposing.value = false; emit('update:model-value', (event.target as HTMLInputElement).value); emit('composing', false) }
// Escape 只发给启动页，快捷键保持宿主统一处理。
function onKeydown(event: KeyboardEvent): void {
  if (isComposing.value || event.isComposing) return
  if (event.key === 'Escape') { event.stopPropagation(); emit('arrow-keydown', event) }
  if ((event.ctrlKey || event.metaKey) && event.key === ',') { event.preventDefault(); emit('navigate', 'settings') }
}
// 方向键和 Enter 交给原版结果导航，输入光标左右移动不被无条件阻止。
function keydownEvent(event: KeyboardEvent, direction: string): void {
  if (isComposing.value || event.isComposing || (['left', 'right'].includes(direction) && !event.altKey)) return
  if (direction === 'tab') return
  event.preventDefault(); event.stopPropagation(); emit('arrow-keydown', event)
}
// 头像进入设置页面，不调用不受支持的原版全局桥。
function handleSettingsClick(): void { emit('navigate', 'settings') }
// 只在空白标题区请求安全原生拖动，输入与按钮不触发拖动。
function handleMouseDown(event: MouseEvent): void {
  if (event.button !== 0 || (event.target as Element).closest('input,button,.avatar-wrapper')) return
  dragging = true
  void window.desktop.startWindowDrag().catch(cause => { desktop.error = String(cause) })
  window.addEventListener('mouseup', finishDrag, { once: true })
}
// 结束原生拖动并移除临时监听。
function finishDrag(): void {
  if (!dragging) return
  dragging = false; window.removeEventListener('mouseup', finishDrag)
  void window.desktop.endWindowDrag().catch(cause => { desktop.error = String(cause) })
}
// 恢复焦点但不改变用户原有输入选择。
function focus(): void { inputRef.value?.focus({ preventScroll: true }) }
// 为调用方提供原版输入选择能力。
function selectAll(): void { inputRef.value?.select() }
onUnmounted(finishDrag)
defineExpose({ focus, selectAll })
</script>
<style scoped>
.search-box {
  padding: 5px 12px;
  display: flex;
  align-items: center;
  gap: 8px;
  /* -webkit-app-region: drag; 暂时注释掉，测试 mousemove */
  position: relative;
  overflow: hidden; /* 防止内容溢出 */
  width: 100%; /* 确保宽度不超过父容器 */
  z-index: 10; /* 确保在其他内容之上 */
  user-select: none; /* 禁止选取文本 */
  border-radius: 0; /* 组件本身不要圆角 */
  height: 58px;
}

.search-box.is-compact {
  padding-block: 3px;
  padding-inline: 8px;
}

.search-box.is-compact .measure-text,
.search-box.is-compact .placeholder-text,
.search-box.is-compact .search-input {
  font-size: 20px;
}

.search-box.is-compact .search-input {
  height: 38px;
}

.search-box.is-compact .pasted-image-thumbnail {
  width: 38px;
  height: 38px;
}

.search-box.is-compact .pasted-files,
.search-box.is-compact .pasted-text {
  height: 32px;
  padding-inline: 10px;
}

.search-box.is-compact .plugin-tag {
  height: 32px;
  border-radius: 16px;
  padding-right: 3px;
}

.search-box.is-compact .plugin-tag-left {
  height: 32px;
  gap: 5px;
  padding: 6px 7px;
}

.search-box.is-compact .plugin-tag.has-cmd .plugin-tag-left {
  padding-right: 18px;
}

.search-box.is-compact .plugin-tag-icon {
  width: 18px;
  height: 18px;
}

.search-box.is-compact .plugin-tag-title {
  font-size: 15px;
}

.search-box.is-compact .plugin-tag-cmd {
  font-size: 13px;
  padding-inline: 3px;
}

.search-box.is-compact .plugin-tag-close {
  width: 18px;
  height: 18px;
}

.search-box.is-compact .search-btn,
.search-box.is-compact .avatar-container {
  width: 34px;
  height: 34px;
}

.search-box.is-compact .avatar-spinner {
  right: -3px;
  width: 40px;
  height: 40px;
}

.search-box.is-compact .update-notification {
  border-radius: 7px;
}

.search-box.is-compact .update-action {
  gap: 6px;
  padding: 4px 6px 4px 9px;
}

.search-box.is-compact .update-text {
  font-size: 12px;
}

.search-box.is-compact .update-action :deep(svg) {
  width: 26px;
  height: 26px;
}

.search-box.is-compact .update-dismiss {
  top: -4px;
  right: -4px;
  width: 16px;
  height: 16px;
  font-size: 14px;
}

/* 拖放蒙版 */
.drag-overlay {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.3);
  z-index: 1000;
  pointer-events: none;
  animation: fadeIn 0.15s ease;
}

@keyframes fadeIn {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}

.measure-text {
  position: absolute;
  white-space: pre;
  font-size: 25px;
  line-height: 1.3; /* 与 .search-input 保持一致 */
  font-family:
    -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
  font-weight: inherit;
  letter-spacing: inherit;
  pointer-events: none;
  visibility: hidden;
  left: -9999px;
}

.placeholder-text {
  position: absolute;
  left: 0;
  color: #7a7a7a;
  font-size: 25px;
  font-weight: 300;
  line-height: 1.3;
  pointer-events: none;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 100%;
  font-family:
    -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
}

/* 暗色模式下的 placeholder 颜色 */
@media (prefers-color-scheme: dark) {
  .placeholder-text {
    color: #aaaaaa;
  }
}

.search-input {
  /* 移除 flex: 1，改为根据内容自动调整 */
  width: auto; /* 将由 JS 动态设置 */
  height: 48px;
  line-height: 1.3; /* 降低行高，使文本更紧凑 */
  font-size: 25px;
  border: none;
  outline: none;
  background: transparent;
  color: var(--text-color);
  -webkit-app-region: no-drag;
  user-select: text; /* 允许选取文本 */
  font-family:
    -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
}

/* 移除了原生 placeholder 样式，因为现在使用独立的占位符元素 */

.search-input-container {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0; /* 允许 flex 子元素缩小 */
  overflow: hidden; /* 防止内容溢出 */
  /* 不设置 no-drag，继承父元素的 drag，整个区域可拖动 */
}

/* 插件模式胶囊标签 */
.plugin-tag {
  display: inline-flex;
  align-items: center;
  border-radius: 20px;
  background: rgba(0, 0, 0, 0.06);
  flex-shrink: 0;
  max-width: 280px;
  overflow: hidden;
  -webkit-app-region: no-drag;
  user-select: none;
  transition: all 0.2s;
  cursor: default;
  padding-right: 4px;
}

.plugin-tag:hover {
  background: rgba(0, 0, 0, 0.09);
}

/* 有 cmd 时：右侧区域使用更淡的背景 */
.plugin-tag.has-cmd {
  background: rgba(0, 0, 0, 0.03);
}

.plugin-tag.has-cmd:hover {
  background: rgba(0, 0, 0, 0.05);
}

/* 左侧区域：icon + 标题 */
.plugin-tag-left {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px;
}

/* 有 cmd 时，左侧使用更深的背景 + 斜切右边缘 */
.plugin-tag.has-cmd .plugin-tag-left {
  background: rgba(0, 0, 0, 0.07);
  padding-right: 20px;
  clip-path: polygon(0 0, 100% 0, calc(100% - 10px) 100%, 0 100%);
}

.plugin-tag-icon {
  width: 20px;
  height: 20px;
  border-radius: 4px;
  flex-shrink: 0;
}

.plugin-tag-title {
  font-size: 16px;
  color: var(--text-color);
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  line-height: 1;
}

.plugin-tag-cmd {
  font-size: 14px;
  color: var(--text-color);
  font-weight: 600;
  padding: 0 4px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 120px;
  line-height: 1;
  flex-shrink: 1;
  min-width: 0;
  opacity: 0.6;
}

.plugin-tag-close {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  border: none;
  background: transparent;
  border-radius: 50%;
  color: var(--text-color);
  opacity: 0.35;
  cursor: pointer;
  flex-shrink: 0;
  padding: 0;
  transition: all 0.15s;
}

.plugin-tag-close:hover {
  opacity: 0.7;
  background: rgba(0, 0, 0, 0.06);
}

.plugin-tag-close:active {
  transform: scale(0.9);
}

/* 暗色模式 */
@media (prefers-color-scheme: dark) {
  .plugin-tag {
    background: rgba(255, 255, 255, 0.08);
  }

  .plugin-tag:hover {
    background: rgba(255, 255, 255, 0.12);
  }

  .plugin-tag.has-cmd {
    background: rgba(255, 255, 255, 0.04);
  }

  .plugin-tag.has-cmd:hover {
    background: rgba(255, 255, 255, 0.06);
  }

  .plugin-tag.has-cmd .plugin-tag-left {
    background: rgba(255, 255, 255, 0.1);
  }

  .plugin-tag-close:hover {
    background: rgba(255, 255, 255, 0.1);
  }
}

.input-wrapper {
  position: relative; /* 为占位符提供定位上下文 */
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
}

.pasted-image-thumbnail {
  position: relative;
  width: 48px;
  height: 48px;
  flex-shrink: 0; /* 图片缩略图不允许缩小，保持尺寸 */
  border-radius: 6px;
  overflow: hidden;
  border: 1px solid rgba(0, 0, 0, 0.15); /* 透明黑色描边 */
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
  background: var(--control-bg); /* 添加背景色，图片未填满时显示 */
  display: flex;
  align-items: center;
  justify-content: center;
  -webkit-app-region: no-drag;
  user-select: none; /* 不可选取 */
}

.pasted-image-thumbnail img {
  max-width: 100%;
  max-height: 100%;
  width: auto;
  height: auto;
  object-fit: contain; /* 显示完整图片，不裁切 */
}

.pasted-files,
.pasted-text {
  position: relative;
  max-width: 200px;
  height: 36px;
  flex-shrink: 1; /* 允许缩小 */
  display: inline-flex; /* 改为inline-flex，内容自适应宽度 */
  align-items: center;
  gap: 8px;
  padding: 0 12px;
  border-radius: 6px;
  background: var(--control-bg);
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);
  -webkit-app-region: no-drag;
  user-select: none; /* 不可选取文本 */
}

/* 文件粘贴：实线描边（与图片一致） */
.pasted-files {
  border: 1px solid rgba(0, 0, 0, 0.15);
}

/* 文本粘贴：虚线描边，可点击 */
.pasted-text {
  border: 1px dashed rgba(0, 0, 0, 0.2);
  cursor: pointer;
  transition: all 0.2s;
}

.pasted-text:hover {
  background: var(--hover-bg);
  border-color: rgba(0, 0, 0, 0.3);
}

/* 暗色模式下使用透明白色描边（必须放在所有描边定义之后） */
@media (prefers-color-scheme: dark) {
  .pasted-image-thumbnail,
  .pasted-files {
    border-color: rgba(255, 255, 255, 0.15);
  }

  .pasted-text {
    border-color: rgba(255, 255, 255, 0.2);
  }

  .pasted-text:hover {
    border-color: rgba(255, 255, 255, 0.3);
  }
}

.file-icon,
.text-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  color: var(--primary-color);
  opacity: 0.8;
}

.file-info,
.text-info {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 4px;
}

.file-name,
.text-content {
  font-size: 13px;
  font-weight: 500;
  color: var(--text-color);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.file-count {
  font-size: 12px;
  font-weight: 600;
  color: var(--primary-color);
  background: color-mix(in srgb, var(--primary-color) 10%, transparent);
  padding: 2px 6px;
  border-radius: 10px;
  flex-shrink: 0;
}

.search-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0; /* 右侧按钮区域不允许缩小 */
  -webkit-app-region: no-drag; /* 头像区域不可拖动 */
}

.plugin-upgrade-slot {
  position: relative;
  z-index: 4;
  width: 30px;
  height: 30px;
  flex: 0 0 30px;
}

.plugin-upgrade-control {
  position: absolute;
  top: 0;
  right: 0;
  width: 30px;
  height: 30px;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  overflow: hidden;
  border: 1px solid transparent;
  border-radius: 6px;
  background: transparent;
  transition:
    width 0.16s ease,
    background-color 0.12s ease,
    border-color 0.18s ease,
    color 0.12s ease;
}

.plugin-upgrade-control:hover,
.plugin-upgrade-control:focus-within,
.plugin-upgrade-control.upgrading,
.plugin-upgrade-control.error {
  width: 198px;
  border-color: color-mix(in srgb, var(--text-color) 10%, transparent);
  background: var(--control-bg);
}

.plugin-upgrade-actions {
  height: 100%;
  display: flex;
  align-items: stretch;
  flex-shrink: 0;
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.1s ease;
}

.plugin-upgrade-control:hover .plugin-upgrade-actions,
.plugin-upgrade-control:focus-within .plugin-upgrade-actions,
.plugin-upgrade-control.upgrading .plugin-upgrade-actions,
.plugin-upgrade-control.error .plugin-upgrade-actions {
  opacity: 1;
  pointer-events: auto;
}

.plugin-upgrade-trigger,
.plugin-upgrade-action {
  height: 100%;
  border: none;
  background: transparent;
  color: var(--text-color);
  cursor: pointer;
  -webkit-app-region: no-drag;
}

.plugin-upgrade-trigger {
  width: 28px;
  padding: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 28px;
  color: var(--primary-color);
}

.plugin-upgrade-trigger :deep(svg) {
  width: 18px;
  height: 18px;
}

.plugin-upgrade-action {
  padding: 0 10px;
  font-size: 12px;
  font-weight: 400;
  letter-spacing: 0;
  white-space: nowrap;
}

.plugin-upgrade-action + .plugin-upgrade-action {
  border-left: 1px solid color-mix(in srgb, var(--text-color) 9%, transparent);
}

.plugin-upgrade-trigger {
  border-left: 1px solid transparent;
}

.plugin-upgrade-control:hover .plugin-upgrade-trigger,
.plugin-upgrade-control:focus-within .plugin-upgrade-trigger,
.plugin-upgrade-control.upgrading .plugin-upgrade-trigger,
.plugin-upgrade-control.error .plugin-upgrade-trigger {
  border-left-color: color-mix(in srgb, var(--text-color) 9%, transparent);
}

.market-action:hover:not(:disabled) {
  background: var(--hover-bg);
}

.upgrade-now-action {
  min-width: 76px;
  color: var(--primary-color);
  font-weight: 500;
}

.upgrade-now-action:hover:not(:disabled) {
  background: var(--hover-bg);
}

.plugin-upgrade-trigger:hover {
  background: var(--hover-bg);
}

.plugin-upgrade-control.error {
  border-color: color-mix(in srgb, #dc2626 24%, transparent);
}

.plugin-upgrade-control.error .upgrade-now-action {
  color: #dc2626;
}

.plugin-upgrade-action:disabled {
  cursor: default;
  opacity: 0.62;
}

.plugin-upgrade-trigger:focus-visible,
.plugin-upgrade-action:focus-visible {
  outline: 2px solid var(--primary-color);
  outline-offset: -2px;
}

/* Tab 键目标提示 */
.tab-target-hint {
  display: flex;
  align-items: center;
  gap: 5px;
  opacity: 0.45;
  transition: opacity 0.2s;
  white-space: nowrap;
  user-select: none;
}

.tab-target-hint:hover {
  opacity: 0.7;
}

.tab-target-text {
  font-size: 12px;
  color: var(--text-color);
  font-weight: 400;
}

.tab-target-key {
  font-size: 11px;
  font-weight: 500;
  color: var(--text-color);
  border: 1px solid currentColor;
  border-radius: 4px;
  padding: 1px 5px;
  line-height: 1.3;
}

.update-notification {
  position: relative;
  display: flex;
  align-items: center;
  overflow: visible;
  border-radius: 8px;
  background: rgba(16, 185, 129, 0.1);
  transition: background 0.2s;
  -webkit-app-region: no-drag;
}

.update-notification:hover {
  background: rgba(16, 185, 129, 0.2);
}

.update-action,
.update-dismiss {
  border: none;
  background: transparent;
  color: #10b981;
  cursor: pointer;
  -webkit-app-region: no-drag;
}

.update-action {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px 6px 12px;
}

.update-action:active {
  opacity: 0.7;
}

.update-dismiss {
  position: absolute;
  z-index: 1;
  top: -5px;
  right: -5px;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  padding: 0;
  border-radius: 4px;
  font-size: 16px;
  line-height: 1;
  opacity: 0;
  pointer-events: none;
  transform: scale(0.85);
  transition:
    opacity 0.15s,
    transform 0.15s;
}

.update-notification:hover .update-dismiss,
.update-dismiss:focus-visible {
  opacity: 1;
  pointer-events: auto;
  transform: scale(1);
}

.update-dismiss:hover {
  background: rgba(16, 185, 129, 0.24);
}

.update-action:focus-visible,
.update-dismiss:focus-visible {
  outline: 2px solid #10b981;
  outline-offset: -2px;
}

.update-text {
  font-size: 13px;
  color: #10b981;
  font-weight: 500;
  white-space: nowrap;
}

.search-btn {
  width: 38px;
  height: 38px;
  border-radius: 50%;
  object-fit: cover;
  cursor: pointer;
  transition:
    transform 0.2s,
    box-shadow 0.2s,
    border-radius 0.24s ease;
  -webkit-app-region: no-drag;
  /* 按钮不可拖动 */
  border: none;
  outline: none;
  position: relative;
  z-index: 1;
}

/* 插件图标：保持原本形状，不使用圆形遮罩 */
.search-btn.plugin-logo {
  border-radius: 6px;
  object-fit: contain;
}

/* AI 调用期间将插件图标裁成圆形，避免圆形状态层外露出矩形四角。 */
.avatar-wrapper.ai-active .search-btn.plugin-logo {
  border-radius: 50%;
}

.search-btn:not(.plugin-logo):hover {
  transform: scale(0.96);
  box-shadow: 0 0 6px 1px color-mix(in srgb, var(--primary-color), transparent 60%);
}

.search-btn:active {
  transform: scale(0.95);
}

.avatar-wrapper {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
}

.avatar-container {
  position: relative;
  width: 38px;
  height: 38px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.avatar-wrapper.loading .search-btn {
  opacity: 0.9;
}

.action-indicator {
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-secondary);
  opacity: 0.6;
  transition: opacity 0.2s;
}

.avatar-wrapper:hover .action-indicator {
  opacity: 1;
}

.search-btn.is-default {
  opacity: 1;
}

.avatar-spinner {
  position: absolute;
  right: -4px;
  width: 46px;
  height: 46px;
  border-radius: 50%;
  border: 2px solid rgba(255, 255, 255, 0.3);
  border-top-color: var(--primary-color, #3b82f6);
  animation: avatar-spin 0.8s linear infinite;
  pointer-events: none;
}

@keyframes avatar-spin {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}

/* AI 动画层 */
.ai-animation-layer {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  border-radius: 50%;
  pointer-events: none;
  z-index: 2;
}

/* AI 蒙版层 */
.ai-mask {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.7);
  z-index: 1;
}

/* 暗色模式下使用黑色蒙版 */
@media (prefers-color-scheme: dark) {
  .ai-mask {
    background: rgba(0, 0, 0, 0.3);
  }
}

/* AI 文字 */
.ai-text {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  font-size: 12px;
  font-weight: 600;
  color: var(--primary-color);
  z-index: 3;
  letter-spacing: 0.5px;
}

/* 发送状态：从小到大扩散 */
.ai-ripple-container {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  display: inline-block;
  z-index: 2;
}

.ai-ripple-container::after,
.ai-ripple-container::before {
  content: '';
  box-sizing: border-box;
  width: 100%;
  height: 100%;
  border-radius: 50%;
  border: 2px solid var(--primary-color);
  position: absolute;
  left: 0;
  top: 0;
  animation: animloader-sending 2s linear infinite;
  animation-fill-mode: backwards;
}

.ai-ripple-container::after {
  animation-delay: 1s;
}

@keyframes animloader-sending {
  0% {
    transform: scale(0);
    opacity: 1;
  }
  100% {
    transform: scale(1);
    opacity: 0;
  }
}

/* 接收状态：从大到小收缩 */
.ai-pulse-container {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  display: inline-block;
  z-index: 2;
}

.ai-pulse-container::after,
.ai-pulse-container::before {
  content: '';
  box-sizing: border-box;
  width: 100%;
  height: 100%;
  border-radius: 50%;
  border: 2px solid var(--primary-color);
  position: absolute;
  left: 0;
  top: 0;
  animation: animloader-receiving 2s linear infinite;
  animation-fill-mode: backwards;
}

.ai-pulse-container::after {
  animation-delay: 1s;
}

@keyframes animloader-receiving {
  0% {
    transform: scale(1);
    opacity: 0;
  }
  100% {
    transform: scale(0);
    opacity: 1;
  }
}
</style>
