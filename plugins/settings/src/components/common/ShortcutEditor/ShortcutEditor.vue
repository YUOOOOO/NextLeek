<!-- MIT Copyright (c) 2025 lzx8589561; adapted to the NextTools Cordis desktop contract. -->
<template>
  <DetailPanel
    :title="
      editingShortcut
        ? isAppShortcut
          ? '编辑应用快捷键'
          : '编辑全局快捷键'
        : isAppShortcut
          ? '添加应用快捷键'
          : '添加全局快捷键'
    "
    @back="emit('back')"
  >
    <div class="editor-wrapper">
      <div class="editor-content">
        <div class="editor-main">
          <div>
            <!-- 快捷键类型说明 -->
            <div v-if="isAppShortcut" class="form-notice">
              应用快捷键仅在 NextTools 窗口激活时生效，不会与其他应用冲突
            </div>

            <!-- 快捷键录制 -->
            <div class="form-item">
              <label class="form-label">快捷键</label>
              <HotkeyInput
                v-model="recordedShortcut"
                placeholder="点击录制快捷键"
              />
              <span class="form-hint">点击上方输入框录制快捷键</span>
            </div>

            <!-- 预截图优化（仅 Windows 全局快捷键编辑页） -->
            <div v-if="!isAppShortcut && isWindows" class="form-item">
              <label class="form-label">预截图优化</label>
              <label class="toggle editor-toggle">
                <input v-model="preScreenshotOptimization" type="checkbox" />
                <span class="toggle-slider"></span>
              </label>
              <span class="form-hint">仅对截图类全局快捷键生效，触发后会优先预抓取屏幕首帧</span>
            </div>
          </div>

          <div class="editor-selector">
            <label class="form-label">目标指令</label>
            <CommandTargetSelector
              :options="targetOptions"
              :selected-command-id="currentTarget?.commandId || null"
              @select="handleSelectTarget"
              @escape="handleSelectorEscape"
            />
          </div>
        </div>
      </div>

      <div class="editor-footer">
        <button class="btn" @click="emit('back')">取消</button>
        <button class="btn" :disabled="saving || !recordedShortcut || !currentTarget" @click="handleSave">
          确定
        </button>
      </div>
    </div>
  </DetailPanel>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import HotkeyInput from '../HotkeyInput/HotkeyInput.vue'
import DetailPanel from '../DetailPanel/DetailPanel.vue'
import CommandTargetSelector from '../../../views/ShortcutsSetting/components/CommandTargetSelector.vue'
import {
  buildShortcutTargetCandidates,
  buildShortcutTargetValue,
  normalizeShortcutTargetValue,
  type ShortcutsSettingCommandTargetOptionBase,
  type ShortcutsSettingShortcutTargetOption
} from '../../../views/ShortcutsSetting/ShortcutsSetting'

interface EditableShortcut {
  id: string
  shortcut: string
  target: string
  preScreenshotOptimization?: boolean
}

const props = defineProps<{
  editingShortcut?: EditableShortcut | null
  prefillTarget?: string
  targetOptions: ShortcutsSettingShortcutTargetOption[]
  isAppShortcut?: boolean
  saving?: boolean
}>()
const emit = defineEmits<{
  back: []
  save: [shortcut: string, target: string, preScreenshotOptimization: boolean]
}>()
const recordedShortcut = ref('')
const targetCommand = ref('')
const preScreenshotOptimization = ref(false)
const isWindows = window.ztools.isWindows()

// 将旧格式目标还原为当前可选指令，保存时使用 canonical 字符串。
const currentTarget = computed(() => {
  const normalizedTarget = normalizeShortcutTargetValue(targetCommand.value)
  if (!normalizedTarget) return null
  return props.targetOptions.find((item) =>
    buildShortcutTargetCandidates(item).includes(normalizedTarget)
  ) ?? null
})

// 打开编辑器时回填快捷键、目标和预截图开关，新建时使用跳转预选目标。
watch(() => props.editingShortcut, (value) => {
  recordedShortcut.value = value?.shortcut ?? ''
  targetCommand.value = normalizeShortcutTargetValue(value?.target ?? props.prefillTarget ?? '')
  preScreenshotOptimization.value = value?.preScreenshotOptimization ?? false
}, { immediate: true })

// 新建入口更新预选目标时不覆盖正在编辑的存量绑定。
watch(() => props.prefillTarget, (value) => {
  if (!props.editingShortcut) targetCommand.value = normalizeShortcutTargetValue(value ?? '')
})

// 选择器共享最小目标契约，由页面工具生成待保存目标。
function handleSelectTarget(target: ShortcutsSettingCommandTargetOptionBase): void {
  targetCommand.value = buildShortcutTargetValue(target)
}

// 保留预截图参数交由父页注册；应用快捷键不启用预截图。
function handleSave(): void {
  if (!recordedShortcut.value || !currentTarget.value) return
  emit('save', recordedShortcut.value, currentTarget.value.value,
    !props.isAppShortcut && preScreenshotOptimization.value)
}

// Esc 只返回本页编辑器，不隐藏窗口。
function handleSelectorEscape(): void {
  emit('back')
}
</script>
<style scoped>
.editor-wrapper {
  height: 100%;
  display: flex;
  flex-direction: column;
}

.editor-content {
  flex: 1;
  padding: 20px 24px;
  min-height: 0;
  overflow: hidden;
}

.editor-main {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 320px;
  gap: 20px;
  height: 100%;
  min-height: 0;
}

.form-notice {
  padding: 12px 16px;
  margin-bottom: 20px;
  background: var(--primary-light-bg);
  border: 1px solid var(--primary-color);
  border-radius: 8px;
  font-size: 13px;
  color: var(--primary-color);
  line-height: 1.5;
}

.form-item {
  margin-bottom: 24px;
}

.form-item:last-child {
  margin-bottom: 0;
}

.editor-toggle {
  display: inline-flex;
}

.form-label {
  display: block;
  font-size: 14px;
  font-weight: 500;
  color: var(--text-color);
  margin-bottom: 8px;
}

.form-hint {
  display: block;
  font-size: 12px;
  color: var(--text-secondary);
  margin-top: 6px;
}

.editor-selector {
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
}

.editor-footer {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  padding: 16px 24px;
  border-top: 1px solid var(--divider-color);
  background: var(--bg-color);
}
</style>
