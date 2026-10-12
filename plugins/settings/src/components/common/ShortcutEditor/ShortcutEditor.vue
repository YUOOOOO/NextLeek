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
            <div v-if="!isAppShortcut" class="form-item">
              <span class="form-hint">预截图优化尚未接入原生截图服务。</span>
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
import type { ShortcutsSettingCommandTargetOptionBase } from '../../../views/ShortcutsSetting/desktop-types'
const props=defineProps<{ editingShortcut?: { id:string; shortcut:string; target:string } | null; targetOptions: ShortcutsSettingCommandTargetOptionBase[]; isAppShortcut?:boolean; saving?:boolean }>()
const emit=defineEmits<{ back:[]; save:[shortcut:string, target:string] }>()
const recordedShortcut=ref('')
const targetCommand=ref('')
const currentTarget=computed(()=>props.targetOptions.find(item=>item.commandId===targetCommand.value) ?? null)
// 编辑目标直接使用真实 commandId，不再拼接插件指令兼容别名。
watch(()=>props.editingShortcut, value=>{recordedShortcut.value=value?.shortcut ?? '';targetCommand.value=value?.target ?? ''},{immediate:true})
// 选择原始两层目标列表中的真实指令。
function handleSelectTarget(target: ShortcutsSettingCommandTargetOptionBase){targetCommand.value=target.commandId}
// 保存交由父列表调用快捷键插件，并保留另一个作用域绑定。
function handleSave(){if(recordedShortcut.value&&currentTarget.value)emit('save',recordedShortcut.value,currentTarget.value.commandId)}
// Esc 只返回本页编辑器，不隐藏窗口。
function handleSelectorEscape(){emit('back')}
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
