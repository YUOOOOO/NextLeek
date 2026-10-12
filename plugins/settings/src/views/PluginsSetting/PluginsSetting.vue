<!-- MIT Copyright (c) 2025 lzx8589561; adapted to the NextTools Cordis desktop contract. -->
<script setup lang="ts">
import { computed, ref } from 'vue'
import { useDesktopStore } from '../../../../../src/client/store'
import DetailPanel from '../../components/common/DetailPanel/DetailPanel.vue'
const desktop = useDesktopStore()
const emit = defineEmits<{ navigate: [page: 'plugin-market'] }>()
const activeTab = ref('all')
const selectedId = ref<string | null>(null)
const pluginLabels = { pending:'等待加载', loading:'加载中', active:'已启用', failed:'加载失败', disposed:'已停止', unloading:'停止中', disabled:'已禁用' }
// 运行列表只统计运行时 active 状态，不把 enabled 当运行成功。
const allPlugins = computed(() => desktop.snapshot?.plugins ?? [])
const filteredPlugins = computed(() => allPlugins.value.filter(plugin => activeTab.value === 'all' || plugin.status === 'active'))
const selectedPlugin = computed(() => allPlugins.value.find(plugin => plugin.id === selectedId.value))
// 受保护核心插件不允许启停，失败由共享 store 显示真实错误。
function handleTogglePlugin(id: string) { const plugin = allPlugins.value.find(item => item.id === id); if (plugin && !plugin.protected && !desktop.busy) void desktop.togglePlugin(id, !plugin.enabled) }
</script>
<template><div class="content-panel" :aria-busy="desktop.busy">
<Transition name="slide"><DetailPanel v-if="selectedPlugin" :title="selectedPlugin.name" @back="selectedId = null"><div class="scrollable-content"><div class="plugin-info"><h2 class="plugin-name">{{ selectedPlugin.name }}</h2><p class="plugin-version">v{{ selectedPlugin.version }} · {{ selectedPlugin.id }}</p><p>{{ pluginLabels[selectedPlugin.status] }}</p><p v-if="selectedPlugin.protected">内置核心插件，不可停用</p><button class="btn" :disabled="desktop.busy || selectedPlugin.protected" @click="handleTogglePlugin(selectedPlugin.id)">{{ selectedPlugin.enabled ? '停用' : '启用' }}</button><button class="btn" @click="emit('navigate', 'plugin-market')">在插件市场管理安装/更新/卸载</button><h3>插件指令</h3><p v-for="command in desktop.commands.filter(item => item.pluginId === selectedPlugin?.id)" :key="command.id">{{ command.title }} · {{ command.description }}</p></div></div></DetailPanel></Transition>
<Transition name="list-slide"><div v-if="!selectedPlugin" class="scrollable-content"><div class="panel-header"><div class="tab-group"><button class="tab-btn" :class="{ active: activeTab === 'all' }" @click="activeTab = 'all'">全部 ({{ allPlugins.length }})</button><button class="tab-btn" :class="{ active: activeTab === 'running' }" @click="activeTab = 'running'">运行中 ({{ allPlugins.filter(item => item.status === 'active').length }})</button></div><button class="btn" @click="emit('navigate', 'plugin-market')">插件市场</button></div><div class="plugin-list"><div v-for="plugin in filteredPlugins" :key="plugin.id" class="card plugin-item" @click="selectedId = plugin.id"><div class="plugin-icon-wrapper"><div class="i-z-plugin plugin-icon" /></div><div class="plugin-info"><div class="plugin-name"><span>{{ plugin.name }}</span><span class="plugin-version">v{{ plugin.version }}</span><span v-if="!plugin.enabled" class="disabled-badge">已禁用</span><span v-if="plugin.status === 'active'" class="running-badge">运行中</span></div><div class="plugin-meta">{{ plugin.id }} · {{ pluginLabels[plugin.status] }}<span v-if="plugin.protected"> · 内置核心</span></div></div><button class="btn" :disabled="desktop.busy || plugin.protected" @click.stop="handleTogglePlugin(plugin.id)">{{ plugin.enabled ? '停用' : '启用' }}</button></div></div><div v-if="!filteredPlugins.length" class="empty-state">暂无符合条件的插件</div><p>安装/更新/卸载由受限插件市场管理，仅支持 .nlplugin 和可信部署包；不开放 ZPX、npm、任意 preload 或开发插件安装。</p><p role="alert" v-if="desktop.error">{{ desktop.error }}</p></div></Transition>
</div></template>
<style scoped>
.content-panel {
  position: relative;
  /* 使详情面板能够覆盖该区域 */
  height: 100%;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  /* 防止滑动时出现滚动条 */
}

/* 可滚动内容区 */
.scrollable-content {
  position: absolute;
  inset: 0;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 20px;
  background: var(--bg-color);
}

/* 列表滑动动画 */
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

/* 插件中心样式 */
.panel-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20px;
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

.tab-count {
  font-size: 11px;
  padding: 2px 6px;
  background: var(--control-bg);
  border-radius: 10px;
  min-width: 18px;
  text-align: center;
}

.tab-btn.active .tab-count {
  background: var(--primary-light-bg);
  color: var(--primary-color);
}

.tab-count.tab-count-update,
.tab-btn.active .tab-count.tab-count-update {
  background: var(--danger-color, #ef4444);
  color: #fff;
}

.button-group {
  display: flex;
  gap: 10px;
}

.plugin-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.plugin-item {
  display: flex;
  align-items: center;
  padding: 12px 14px;
  cursor: pointer;
  transition: all 0.2s;
}

.plugin-item:hover {
  background: var(--hover-bg);
  transform: translateX(2px);
}

.plugin-icon,
.plugin-icon-placeholder {
  width: 40px;
  height: 40px;
  border-radius: 6px;
  flex-shrink: 0;
}

.plugin-icon {
  object-fit: cover;
}

.plugin-icon-placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--active-bg);
  font-size: 24px;
}

.plugin-info {
  flex: 1;
  min-width: 0;
}

.plugin-name {
  font-size: 16px;
  font-weight: 600;
  color: var(--text-color);
  margin-bottom: 4px;
  display: flex;
  align-items: center;
  gap: 8px;
}

.plugin-version {
  font-size: 11px;
  font-weight: 500;
  color: var(--text-secondary);
  padding: 2px 6px;
  background: var(--active-bg);
  border-radius: 4px;
}

.dev-badge {
  display: none;
}

.plugin-icon-wrapper {
  position: relative;
  flex-shrink: 0;
  margin-right: 12px;
  width: 40px;
  height: 40px;
}

.plugin-dev-badge {
  position: absolute;
  right: -4px;
  bottom: -4px;
  display: inline-flex;
  min-width: 18px;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--bg-color);
  border-radius: 999px;
  background: #389e0d;
  color: var(--text-on-primary);
  font-size: 8px;
  font-weight: 700;
  line-height: 1;
  padding: 2px 4px;
}

.plugin-update-dot {
  position: absolute;
  top: -3px;
  left: -3px;
  z-index: 1;
  width: 9px;
  height: 9px;
  border-radius: 50%;
  background: var(--danger-color, #ef4444);
  border: 1.5px solid var(--bg-color);
}

.disabled-badge {
  display: inline-block;
  font-size: 11px;
  font-weight: 500;
  color: var(--warning-color);
  background: color-mix(in srgb, var(--warning-color) 12%, transparent);
  padding: 2px 8px;
  border-radius: 4px;
  border: 1px solid color-mix(in srgb, var(--warning-color) 35%, transparent);
}

.running-badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  font-weight: 500;
  color: var(--success-color);
  background: var(--success-light-bg);
  padding: 2px 8px;
  border-radius: 4px;
  border: 1px solid var(--success-color);
}

.status-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--success-color);
  animation: pulse-dot 2s infinite;
}

@keyframes pulse-dot {
  0%,
  100% {
    opacity: 1;
  }

  50% {
    opacity: 0.5;
  }
}

.plugin-desc {
  font-size: 13px;
  color: var(--text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.plugin-meta {
  display: flex;
  align-items: center;
  gap: 6px;
}

/* 图标按钮颜色样式 */
.open-btn {
  color: var(--primary-color);
}

.open-btn:hover {
  background: var(--primary-light-bg);
}

.kill-btn {
  color: var(--warning-color);
}

.kill-btn:hover:not(:disabled) {
  background: var(--warning-light-bg);
}

.folder-btn {
  color: var(--primary-color);
}

.folder-btn:hover {
  background: var(--primary-light-bg);
}

.pin-btn {
  color: var(--text-secondary);
}

.pin-btn:hover {
  background: var(--hover-bg);
  color: var(--primary-color);
}

.pin-btn.is-pinned {
  color: var(--primary-color);
}

.pin-btn.is-pinned:hover {
  background: var(--primary-light-bg);
}

/* 空状态 */
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 60px 20px;
  text-align: center;
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

.empty-feature {
  font-size: 13px;
  color: var(--text-secondary);
}

/* 更多菜单样式 */
.more-menu-wrapper {
  position: relative;
  z-index: 10000;
}

.more-menu-wrapper .btn-more {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.more-menu-wrapper .btn-more svg {
  flex-shrink: 0;
}

.more-menu {
  position: absolute;
  top: calc(100% + 4px);
  right: 0;
  background: #ffffff;
  border: 1px solid var(--divider-color);
  border-radius: 6px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  min-width: 180px;
  padding: 4px;
  z-index: 10001;
}

@media (prefers-color-scheme: dark) {
  .more-menu {
    background: #1e1e1e;
  }
}

.more-menu-item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 8px 12px;
  border: none;
  background: transparent;
  color: var(--text-color);
  font-size: 14px;
  text-align: left;
  border-radius: 4px;
  cursor: pointer;
  transition: background 0.2s;
}

.more-menu-item:hover:not(:disabled) {
  background: var(--hover-bg);
}

.more-menu-item:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.more-menu-item svg {
  flex-shrink: 0;
}

.more-menu-item.kill-all-item:not(:disabled) {
  color: var(--warning-color);
}

.more-menu-item.kill-all-item:hover:not(:disabled) {
  background: var(--warning-light-bg);
}
</style>
