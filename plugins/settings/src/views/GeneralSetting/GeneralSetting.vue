<!-- MIT Copyright (c) 2025 lzx8589561; adapted to the NextTools Cordis desktop contract. -->
<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useDesktopStore } from '../../../../../src/client/store'
import type { Settings } from '../../../../../src/shared/contracts'
import HotkeyInput from '../../components/common/HotkeyInput/HotkeyInput.vue'
import Dropdown from '../../components/common/Dropdown/Dropdown.vue'
const desktop = useDesktopStore()
const hotkey = ref('')
// 快照变化后回显已成功保存的呼出快捷键。
watch(() => desktop.snapshot?.settings.hotkey, value => { hotkey.value = value ?? '' }, { immediate: true })
// 只写入真实设置服务支持的字段，注册失败时恢复已保存值。
async function handleHotkeyChange(value: string) {
  await desktop.update({ hotkey: value })
  hotkey.value = desktop.snapshot?.settings.hotkey ?? ''
}
// 将通用设置控件直接映射到宿主快照，避免本地保存成功假象。
function settingField<K extends keyof Settings>(key: K) {
  return computed({ get: () => desktop.snapshot!.settings[key], set: value => { if (!desktop.busy) void desktop.update({ [key]: value }) } })
}
const launchAtLogin = settingField('autostart')
const theme = settingField('theme')
const compactMainWindowHeader = settingField('compact')
const primaryColor = settingField('accent')
const themeOptions = [{ label: '跟随系统', value: 'system' }, { label: '明亮', value: 'light' }, { label: '暗黑', value: 'dark' }]
const themeColors = [
  {value:'blue',label:'海蓝',hex:'#0284c7'}, {value:'violet',label:'紫罗兰',hex:'#7c3aed'},
  {value:'rose',label:'玫瑰',hex:'#e11d48'}, {value:'orange',label:'琥珀',hex:'#ea580c'},
  {value:'green',label:'松绿',hex:'#059669'}, {value:'teal',label:'青碧',hex:'#0d9488'}
] as const
// 主题色仍由宿主主题插件持久化并广播。
function handlePrimaryColorChange(value: Settings['accent']) { if (!desktop.busy) void desktop.update({ accent: value }) }
</script>
<template><div v-if="desktop.snapshot" class="content-panel" :aria-busy="desktop.busy"><div class="setting-group"><h3 class="setting-group-title">基础</h3>      <div class="setting-item">
        <div class="setting-label">
          <span>呼出快捷键</span>
          <span class="setting-desc">设置全局快捷键来呼出应用</span>
        </div>
        <div class="setting-control">
          <HotkeyInput v-model="hotkey" :disabled="desktop.busy" @update:model-value="handleHotkeyChange" />
        </div>
      </div>      <div class="setting-item">
        <div class="setting-label">
          <span>开机自动启动</span>
          <span class="setting-desc">登录系统时自动启动应用</span>
        </div>
        <div class="setting-control">
          <label class="toggle">
            <input v-model="launchAtLogin" type="checkbox" :disabled="desktop.busy" />
            <span class="toggle-slider"></span>
          </label>
        </div>
      </div></div>    <!-- ==================== 外观 ==================== -->
    <div class="setting-group">
      <h3 class="setting-group-title">外观</h3>

      <div class="setting-item">
        <div class="setting-label">
          <span>主题设置</span>
          <span class="setting-desc">选择应用的主题外观</span>
        </div>
        <div class="setting-control">
          <Dropdown v-model="theme" :options="themeOptions" />
        </div>
      </div>

      <div class="setting-item">
        <div class="setting-label">
          <span>紧凑顶部栏</span>
          <span class="setting-desc">缩小主搜索框和插件顶部栏，显示更多内容</span>
        </div>
        <div class="setting-control">
          <label class="toggle">
            <input
              v-model="compactMainWindowHeader"
              type="checkbox"
              aria-label="紧凑顶部栏"
              :disabled="desktop.busy"
            />
            <span class="toggle-slider"></span>
          </label>
        </div>
      </div>
      <div class="setting-item">
        <div class="setting-label">
          <span>主题色</span>
          <span class="setting-desc">自定义应用的主色调</span>
        </div>
        <div class="setting-control color-control">
          <div
            v-for="color in themeColors"
            :key="color.value"
            class="color-option"
            :class="{ active: primaryColor === color.value }"
            :style="{ backgroundColor: color.hex }"
            :title="color.label"
            @click="handlePrimaryColorChange(color.value)"
          ></div>
</div></div></div><div class="setting-group"><h3 class="setting-group-title">兼容范围</h3><p class="setting-desc">Esc 不隐藏窗口。自定义颜色、托盘显隐、透明度/材质、头像/壁纸、终端、搜索行为、超级面板、悬浮球、代理与开发者配置未提供对应 Cordis 服务，不会写入伪设置。</p></div></div></template>
<style scoped>
.content-panel {
  height: 100%;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 20px;
  background: var(--bg-color);
}

/* 设置分组 */
.setting-group {
  margin-bottom: 28px;
}

.setting-group:last-child {
  margin-bottom: 0;
}

.setting-group-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--primary-color);
  margin: 0 0 4px 0;
  line-height: 1.4;
}

/* 设置项 */
.setting-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 20px 0;
  border-bottom: 1px solid var(--divider-color);
}

.setting-group .setting-item:last-child {
  border-bottom: none;
}

.setting-label {
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.setting-label > span:first-child {
  font-size: 14px;
  font-weight: 500;
  color: var(--text-color);
}

.setting-desc {
  font-size: 12px;
  color: var(--text-secondary);
}

.setting-control {
  display: flex;
  align-items: center;
  gap: 10px;
}

.quick-actions-wrapper {
  position: relative;
}

.quick-actions-trigger {
  color: var(--text-secondary);
}

.quick-actions-trigger:hover {
  background: var(--hover-bg);
  color: var(--primary-color);
}

.quick-actions-trigger.active {
  background: var(--hover-bg);
  color: var(--primary-color);
}

.quick-actions-dropdown {
  position: absolute;
  top: calc(100% + 8px);
  right: 0;
  width: 240px;
  background: var(--dialog-bg, var(--bg-color));
  border: 1px solid var(--divider-color);
  border-radius: 10px;
  box-shadow: 0 8px 24px var(--shadow-color);
  z-index: 100;
  overflow: hidden;
}

.quick-actions-item {
  width: 100%;
  display: flex;
  align-items: center;
  padding: 10px 14px;
  gap: 12px;
  border: none;
  border-radius: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  cursor: pointer;
  text-align: left;
  transition: background 0.15s ease;
}

.quick-actions-item + .quick-actions-item {
  border-top: 1px solid var(--divider-color);
}

.quick-actions-item:hover {
  background: var(--hover-bg);
}

.quick-actions-item.active {
  background: var(--primary-light-bg);
}

.quick-actions-item-reset:hover .quick-actions-item-label {
  color: var(--primary-color);
}

.quick-actions-item-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.quick-actions-item-label {
  font-size: 13px;
  font-weight: 500;
  color: var(--text-color);
}

.quick-actions-item-desc {
  font-size: 11px;
  line-height: 1.3;
  color: var(--text-secondary);
}

.dropdown-enter-active {
  transition:
    opacity 0.15s ease,
    transform 0.15s ease;
}

.dropdown-leave-active {
  transition:
    opacity 0.1s ease,
    transform 0.1s ease;
}

.dropdown-enter-from,
.dropdown-leave-to {
  opacity: 0;
  transform: translateY(-4px) scale(0.98);
}

/* 不透明度控制 */
.opacity-control {
  min-width: 250px;
  gap: 12px;
}

.wallpaper-setting-item {
  align-items: flex-start;
}

.wallpaper-control {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 12px;
  min-width: 360px;
}

.wallpaper-preview-wrapper {
  width: 96px;
  height: 60px;
  flex: 0 0 auto;
  overflow: hidden;
  border: 1px solid var(--control-border);
  border-radius: 6px;
  background: var(--control-bg);
}

.wallpaper-preview {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.wallpaper-preview-error {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 6px;
  color: var(--text-secondary);
  font-size: 11px;
  text-align: center;
}

.wallpaper-actions {
  display: flex;
  min-width: 0;
  flex-direction: column;
  align-items: flex-end;
  gap: 8px;
}

.wallpaper-file-name {
  max-width: 230px;
  overflow: hidden;
  color: var(--text-secondary);
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.wallpaper-buttons {
  display: flex;
  gap: 8px;
}

/* 文本输入框 - 只设置布局，颜色由 global.css 控制 */
:deep(.input) {
  min-width: 250px;
}

/* 头像控制 */
.avatar-control {
  display: flex;
  align-items: center;
  gap: 10px;
}

.avatar-preview {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  object-fit: cover;
  border: 2px solid var(--control-border);
}

/* 颜色选择器 */
/* 组合控件（如：开关+按钮） */
.combined-control {
  gap: 16px;
}

.color-control {
  display: flex;
  gap: 12px;
}

.color-option {
  width: 24px;
  height: 24px;
  border-radius: 50%;
  cursor: pointer;
  transition: all 0.2s;
  position: relative;
  border: 2px solid transparent;
  box-shadow:
    0 0 0 1px rgba(0, 0, 0, 0.1),
    0 1px 3px rgba(0, 0, 0, 0.15);
}

.color-option:hover {
  transform: scale(1.1);
}

.color-option.active {
  border-color: var(--text-color);
  transform: scale(1.1);
}

.color-option.active::after {
  content: '';
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  width: 8px;
  height: 8px;
  background: white;
  border-radius: 50%;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.2);
}

/* 自定义颜色选择器 */
.custom-color-option {
  position: relative;
  overflow: hidden;
}

/* 隐藏的颜色选择器 */
.color-picker-hidden {
  position: absolute;
  width: 0;
  height: 0;
  opacity: 0;
  pointer-events: none;
}

/* 自定义按钮 */

/* Tab 目标设置项 */
.tab-target-setting-item {
  align-items: flex-start;
}

.setting-control-column {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 8px;
}

.hotkey-presets {
  display: flex;
  gap: 6px;
}

.hotkey-preset-btn {
  padding: 3px 10px;
  font-size: 12px;
  color: var(--text-secondary);
  background: var(--control-bg);
  border: 1px solid var(--control-border);
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.2s;
  white-space: nowrap;
}

.hotkey-preset-btn:hover {
  color: var(--primary-color);
  background: var(--primary-light-bg);
  border-color: var(--primary-color);
}

.hotkey-preset-btn.active {
  color: var(--primary-color);
  background: var(--primary-light-bg);
  border-color: var(--primary-color);
  font-weight: 500;
}

.blocked-apps-content {
  width: 100%;
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.internal-api-content {
  width: 100%;
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.blocked-apps-header {
  display: flex;
  justify-content: space-between;
}

.internal-api-header {
  display: flex;
  justify-content: space-between;
  gap: 16px;
}

.internal-api-input {
  min-width: 180px;
  width: 220px;
}

.internal-api-add-btn {
  min-width: 56px;
  white-space: nowrap;
  flex-shrink: 0;
}

.blocked-apps-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  padding: 12px 16px;
  background-color: var(--control-bg);
  border-radius: 4px;
  border: 2px solid var(--control-border);
}

.blocked-app-tag {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 8px;
  font-size: 12px;
  background: var(--control-bg);
  border: 1px solid var(--control-border);
  border-radius: 6px;
  color: var(--text-color);
  transition: border-color 0.2s;
}

.blocked-app-tag:hover {
  border-color: var(--danger-color);
}

.blocked-app-remove {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  padding: 0;
  border: none;
  background: none;
  color: var(--text-secondary);
  font-size: 14px;
  line-height: 1;
  cursor: pointer;
  border-radius: 50%;
  transition:
    color 0.2s,
    background 0.2s;
}

.blocked-app-remove:hover {
  color: var(--danger-color);
  background: var(--danger-light-bg);
}
</style>
