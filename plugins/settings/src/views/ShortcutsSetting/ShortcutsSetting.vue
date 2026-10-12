<!-- MIT Copyright (c) 2025 lzx8589561; adapted to the NextTools Cordis desktop contract. -->
<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useDesktopStore } from '../../../../../src/client/store'
import ShortcutEditor from '../../components/common/ShortcutEditor/ShortcutEditor.vue'
const desktop=useDesktopStore()
type Binding={ commandId:string; global:string|null; application:string|null; error?:string }
const bindings=ref<Binding[]>([])
const activeTab=ref<'global'|'app'>('global')
const showEditor=ref(false)
const editingId=ref<string|null>(null)
const loading=ref(false)
const saving=ref(false)
const error=ref('')
let revision=0
let disposed=false
let unsubscribe:(()=>void)|undefined
const scope=computed(()=>activeTab.value==='global'?'global':'application')
const targetOptions=computed(()=>desktop.commands.map(command=>({commandId:command.id,value:command.id,pluginName:command.pluginId??'desktop',groupTitle:desktop.snapshot?.plugins.find(plugin=>plugin.id===command.pluginId)?.name??'桌面指令',cmdName:command.title,label:command.title,subtitle:command.description})))
const visibleBindings=computed(()=>bindings.value.filter(binding=>binding[scope.value]))
const editingShortcut=computed(()=>{const binding=bindings.value.find(item=>item.commandId===editingId.value);return binding?{id:binding.commandId,target:binding.commandId,shortcut:binding[scope.value]??''}:null})
// 刷新版本号阻止离开或后续保存时旧回包覆盖新状态。
async function refresh(){const current=++revision;loading.value=true;try{const result=await window.desktop.invokePlugin('command-shortcuts','list',null);if(!disposed&&current===revision)bindings.value=result as Binding[]}catch(reason){if(!disposed&&current===revision)error.value=reason instanceof Error?reason.message:String(reason)}finally{if(!disposed&&current===revision)loading.value=false}}
// 保留另一作用域；编辑时固定目标，迁移到别的指令需先删除旧绑定。
async function save(shortcut:string, commandId:string){if(saving.value)return;if(editingId.value&&editingId.value!==commandId){error.value='编辑时不能更换目标指令，请先删除原绑定再添加';return}const binding=bindings.value.find(item=>item.commandId===commandId);saving.value=true;error.value='';revision++;try{await window.desktop.invokePlugin('command-shortcuts','set',{commandId,global:scope.value==='global'?shortcut||null:binding?.global??null,application:scope.value==='application'?shortcut||null:binding?.application??null});showEditor.value=false;await refresh();await desktop.refreshShortcutBindings()}catch(reason){error.value=reason instanceof Error?reason.message:String(reason)}finally{saving.value=false}}
// 删除仅清除当前作用域，不影响另一类快捷键。
async function remove(commandId:string){editingId.value=commandId;await save('',commandId);editingId.value=null}
// 新增/编辑沿用上游编辑器与目标分组选择器。
function openEditor(commandId:string|null=null){editingId.value=commandId;error.value='';showEditor.value=true}
// 指令列表变化后重新读取插件实际绑定和注册错误。
onMounted(()=>{void refresh();unsubscribe=window.desktop.subscribe(event=>{if(event.type==='commands-changed'&&!saving.value)void refresh()})})
onUnmounted(()=>{disposed=true;revision++;unsubscribe?.()})
</script>
<template><div class="content-panel"><p v-if="error" role="alert">{{error}}</p><ShortcutEditor v-if="showEditor" :editing-shortcut="editingShortcut" :target-options="targetOptions" :is-app-shortcut="activeTab==='app'" :saving="saving" @back="showEditor=false" @save="save" /><div v-else class="scrollable-content"><div class="panel-header"><div class="tab-group"><button class="tab-btn" :class="{active:activeTab==='global'}" @click="activeTab='global'">全局快捷键</button><button class="tab-btn" :class="{active:activeTab==='app'}" @click="activeTab='app'">应用快捷键</button></div><button class="btn" :disabled="loading||saving" @click="openEditor()">添加</button></div><div class="shortcut-list"><div v-for="binding in visibleBindings" :key="binding.commandId" class="card shortcut-card"><div class="shortcut-main"><div class="shortcut-title">{{desktop.commands.find(command=>command.id===binding.commandId)?.title??binding.commandId}}</div><div class="shortcut-target">{{binding.commandId}}</div><p v-if="binding.error" role="alert">{{binding.error}}</p></div><div class="shortcut-actions"><span class="shortcut-key">{{binding[scope]}}</span><button class="icon-btn" title="编辑" :disabled="saving" @click="openEditor(binding.commandId)"><div class="i-z-edit" /></button><button class="icon-btn" title="删除" :disabled="saving" @click="remove(binding.commandId)"><div class="i-z-trash" /></button></div></div></div><p v-if="loading">正在读取快捷键…</p><p v-else-if="!visibleBindings.length">暂无快捷键</p><p>别名、自动复制、预截图优化、修饰键双击暂未提供对应 Cordis 能力。全局注册失败会显示插件返回的错误。</p></div></div></template>
<style lang="less" scoped>
.alias-slide-enter-active {
  transition:
    transform 0.2s ease-out,
    opacity 0.15s ease;
}

.alias-slide-leave-active {
  transition:
    transform 0.2s ease-in,
    opacity 0.15s ease;
}

.alias-slide-enter-from {
  transform: translateX(100%);
  opacity: 0;
}

.alias-slide-enter-to {
  transform: translateX(0);
  opacity: 1;
}

.alias-slide-leave-from {
  transform: translateX(0);
  opacity: 1;
}

.alias-slide-leave-to {
  transform: translateX(100%);
  opacity: 1;
}

.content-panel {
  position: relative;
  height: 100%;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--bg-color);
}

.scrollable-content {
  position: absolute;
  inset: 0;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 20px;
}

.tabs-container {
  position: sticky;
  top: 0;
  z-index: 10;
  padding-bottom: 16px;
}

.tab-group {
  display: flex;
  gap: 6px;
  background: var(--control-bg);
  padding: 3px;
  border-radius: 8px;
}

.tab-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  flex: 1;
  justify-content: center;
  padding: 6px 14px;
  font-size: 13px;
  border: none;
  background: transparent;
  color: var(--text-secondary);
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.2s;
  font-weight: 500;
}

.tab-btn:hover {
  background: var(--hover-bg);
  color: var(--text-color);
}

.tab-btn.active {
  background: var(--active-bg);
  color: var(--primary-color);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
}

.list-slide-enter-active {
  transition:
    transform 0.2s ease-out,
    opacity 0.15s ease;
}

.list-slide-leave-active {
  transition:
    transform 0.2s ease-in,
    opacity 0.15s ease;
}

.list-slide-enter-from {
  transform: translateX(-100%);
  opacity: 0;
}

.list-slide-enter-to {
  transform: translateX(0);
  opacity: 1;
}

.list-slide-leave-from {
  transform: translateX(0);
  opacity: 1;
}

.list-slide-leave-to {
  transform: translateX(-100%);
  opacity: 0;
}

.panel-header {
  display: flex;
  justify-content: flex-end;
  margin-bottom: 20px;
}

.shortcut-list {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.shortcut-section {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.category-label {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  padding: 0 4px;
  margin-bottom: 4px;
}

.shortcut-item {
  display: flex;
  align-items: center;
  padding: 12px 14px;
  cursor: pointer;
  transition: all 0.2s;
}

.shortcut-item:hover {
  background: var(--hover-bg);
  transform: translateX(2px);
}

.shortcut-item.built-in {
  cursor: default;
  opacity: 0.85;
}

.shortcut-item.built-in:hover {
  transform: none;
}

.shortcut-info {
  flex: 1;
  min-width: 0;
}

.shortcut-key-display {
  font-size: 16px;
  font-weight: 600;
  color: var(--text-color);
  margin-bottom: 4px;
  font-family: monospace;
}

.shortcut-desc {
  font-size: 13px;
  color: var(--text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.shortcut-meta {
  display: flex;
  align-items: center;
  gap: 6px;
}

.auto-copy-control {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-right: 8px;
  flex-shrink: 0;
}

.auto-copy-label {
  font-size: 12px;
  color: var(--text-secondary);
  white-space: nowrap;
}

.built-in-toggle {
  transform: scale(0.85);
  transform-origin: center;
}

.alias-table {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.alias-table-header,
.alias-table-row {
  display: grid;
  grid-template-columns: 56px minmax(180px, 1.2fr) minmax(180px, 2fr) 56px;
  gap: 12px;
  align-items: center;
  padding: 12px 14px;
}

.alias-table-header {
  background: var(--control-bg);
  color: var(--text-secondary);
  font-size: 12px;
  font-weight: 600;
}

.alias-header-cell {
  white-space: nowrap;
}

.alias-table-row {
  transition: all 0.2s;
}

.alias-table-row:hover {
  background: var(--hover-bg);
  transform: translateX(2px);
}

.alias-icon-cell {
  display: flex;
  align-items: center;
  justify-content: center;
}

.alias-command-icon,
.alias-icon-placeholder,
.alias-target-option-icon {
  width: 36px;
  height: 36px;
  border-radius: 8px;
  flex-shrink: 0;
}

.alias-command-icon,
.alias-target-option-icon {
  object-fit: contain;
}

.alias-icon-placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--active-bg);
  color: var(--text-secondary);
}

.alias-value-cell,
.alias-target-cell {
  min-width: 0;
}

.alias-display-text {
  font-size: 15px;
  font-weight: 600;
  color: var(--text-color);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.alias-input,
.alias-target-search {
  width: 100%;
}

.alias-target-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-color);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.alias-target-title.invalid {
  color: var(--danger-color);
}

.alias-target-subtitle {
  margin-top: 4px;
  font-size: 12px;
  color: var(--text-secondary);
  display: flex;
  align-items: center;
  gap: 8px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.alias-target-change-btn {
  padding: 0;
  border: none;
  background: transparent;
  color: var(--primary-color);
  cursor: pointer;
  font-size: 12px;
}

.alias-target-change-btn:hover {
  text-decoration: underline;
}

.alias-target-options {
  margin-top: 10px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  max-height: 220px;
  overflow-y: auto;
}

.alias-target-option {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 8px 10px;
  border: 1px solid var(--divider-color);
  border-radius: 8px;
  background: var(--card-bg);
  cursor: pointer;
  text-align: left;
  transition: all 0.2s;
}

.alias-target-option:hover {
  border-color: var(--primary-color);
  background: var(--primary-light-bg);
}

.alias-target-option-texts {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.alias-target-option-name {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-color);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.alias-target-option-plugin {
  font-size: 12px;
  color: var(--text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.alias-target-empty {
  padding: 8px 10px;
  font-size: 12px;
  color: var(--text-secondary);
  text-align: center;
  background: var(--card-bg);
  border-radius: 8px;
}

.alias-actions-cell {
  display: flex;
  align-items: center;
  justify-content: center;
}

.auto-copy-toggle {
  margin-right: 8px;
  transform: scale(0.85);
  transform-origin: center;
}

.edit-btn {
  color: var(--primary-color);
}

.edit-btn:hover:not(:disabled) {
  background: var(--primary-light-bg);
}

.delete-btn {
  color: var(--danger-color);
}

.delete-btn:hover:not(:disabled) {
  background: var(--danger-light-bg);
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 60px 20px;
  text-align: center;
}

.alias-empty-state {
  border: 2px dashed var(--divider-color);
  border-radius: 12px;
  background: var(--card-bg);
}

.empty-icon {
  margin-bottom: 16px;
  opacity: 0.3;
  color: var(--text-secondary);
}

.empty-text {
  font-size: 18px;
  font-weight: 600;
  color: var(--text-color);
  margin-bottom: 8px;
}

.empty-hint {
  font-size: 14px;
  color: var(--text-secondary);
}

.empty-state-inline {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 20px;
  text-align: center;
}

.empty-text-inline {
  font-size: 13px;
  font-weight: 500;
  color: var(--text-secondary);
  margin-bottom: 4px;
}

.empty-hint-inline {
  font-size: 12px;
  color: var(--text-secondary);
  opacity: 0.7;
}
</style>
