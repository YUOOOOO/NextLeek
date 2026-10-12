<!-- MIT Copyright (c) 2025 lzx8589561; adapted to the NextTools Cordis desktop contract. -->
<template><div class="hotkey-input" :class="{ recording: isRecording }" data-shortcut-capture role="button" tabindex="0" :aria-label="placeholder" @click="startRecording" @keydown="handleKeydown" @keyup.stop @blur="stopRecording">{{ isRecording ? '请按下快捷键，Esc 取消' : modelValue || placeholder }}</div></template>
<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import { useDesktopStore } from '../../../../../../src/client/store'
import { useEscapeHandler } from '../../../composables/useEscapeStack'
import { keyboardAccelerator } from '../../../../../../src/client/accelerator'
const props = withDefaults(defineProps<{ modelValue: string; placeholder?: string; disabled?: boolean }>(), { placeholder: '点击录制快捷键', disabled: false })
const emit = defineEmits<{ 'update:modelValue': [value: string] }>()
const desktop = useDesktopStore()
const isRecording = ref(false)
let disposed = false
let revision = 0
let unsubscribe: (() => void) | undefined
// 原生录制与页面录制共享宿主开关，异步开始后离开也必须释放。
async function startRecording() {
  if (props.disabled || desktop.busy || isRecording.value) return
  const current = ++revision
  const started = await desktop.setHotkeyCapture(true)
  if (disposed || current !== revision) { if (started) await desktop.setHotkeyCapture(false); return }
  isRecording.value = started
}
// 取消录制不修改设置、不隐藏窗口。
function stopRecording() { revision++; isRecording.value = false; void desktop.setHotkeyCapture(false) }
// 确认原生或浏览器录制的组合键，再交由父页保存。
function confirmShortcut(value: string) { if (!isRecording.value) return; stopRecording(); emit('update:modelValue', value) }
// 消费快捷键录制按键，避免触发宿主应用指令。
function handleKeydown(event: KeyboardEvent) {
  if (event.key === 'Tab') return
  if (!isRecording.value) { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); void startRecording() }; return }
  event.preventDefault(); event.stopImmediatePropagation()
  if (event.key === 'Escape') { stopRecording(); return }
  const value = keyboardAccelerator(event)
  if (value) confirmShortcut(value)
}
onMounted(() => { unsubscribe = window.desktop.subscribe(event => { if (event.type === 'hotkey') confirmShortcut(event.value) }); window.addEventListener('blur', stopRecording) })
onUnmounted(() => { disposed = true; unsubscribe?.(); window.removeEventListener('blur', stopRecording); stopRecording() })
// 录制中的 Esc 优先于详情面板返回，只取消当前录制。
useEscapeHandler(() => { stopRecording(); return true }, { priority: 200, enabled: isRecording })
defineExpose({ stopRecording })
</script>
<style scoped>
.hotkey-input {
  min-width: 150px;
  padding: 6px 16px;
  border: 2px solid var(--control-border);
  border-radius: 6px;
  background: var(--control-bg);
  color: var(--text-color);
  font-size: 14px;
  font-weight: 500;
  text-align: center;
  cursor: pointer;
  transition: all 0.2s;
  user-select: none;
}

.hotkey-input:hover {
  background: var(--hover-bg);
  border-color: color-mix(in srgb, var(--primary-color), black 15%);
}

.hotkey-input.recording {
  border-color: color-mix(in srgb, var(--primary-color), black 15%);
  background: var(--primary-light-bg);
  color: var(--primary-color);
  animation: pulse 1.5s infinite;
}

@keyframes pulse {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.7;
  }
}
</style>
