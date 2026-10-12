<!-- MIT Copyright (c) 2025 lzx8589561; 原版来源列表与指令卡接入 Cordis 指令。 -->
<script setup lang="ts">
import { computed, ref } from 'vue'
import { useDesktopStore } from '../../../../../src/client/store'
import CommandCard from '../../components/common/CommandCard/CommandCard.vue'
const desktop = useDesktopStore()
const selectedSource = ref('')
const query = ref('')
const sources = computed(() => (desktop.snapshot?.plugins ?? []).filter(plugin => desktop.commands.some(command => command.pluginId === plugin.id)))
const activeSource = computed(() => sources.value.find(source => source.id === selectedSource.value) ?? sources.value[0])
const commands = computed(() => desktop.commands.filter(command => command.pluginId === activeSource.value?.id && [command.title, command.description, ...command.keywords].join(' ').toLowerCase().includes(query.value.toLowerCase())))
// 只调用现有 Cordis 指令，不模拟原版匹配规则和别名服务。
async function execute(id: string) {
  const command = desktop.commands.find(item => item.id === id)
  if (command) await desktop.run(command)
}
</script>
<template>
  <div class="all-commands-container">
    <div class="sources-panel">
      <div class="panel-header"><h3>指令来源</h3></div>
      <div class="sources-list">
        <div class="section-divider"><span>插件</span></div>
        <div v-for="source in sources" :key="source.id" :class="['source-item', { active: activeSource?.id === source.id }]" @click="selectedSource = source.id">
          <div class="i-z-plugin source-icon source-svg-icon" />
          <span class="source-name">{{ source.name }}</span>
          <span class="source-badge">{{ desktop.commands.filter(command => command.pluginId === source.id).length }}</span>
        </div>
      </div>
    </div>
    <div class="commands-panel">
      <div class="panel-header"><input v-model="query" class="input" placeholder="搜索指令" aria-label="搜索指令" /></div>
      <div class="commands-content">
        <div v-if="!commands.length" class="empty-state"><div class="i-z-search empty-icon" /><p>暂无匹配指令</p></div>
        <div v-else class="command-list">
          <CommandCard v-for="command in commands" :key="command.id" :command="{ name: command.title }">
            <template #meta>{{ command.description }}</template>
            <template #action><button class="btn" :disabled="desktop.busy" @click="execute(command.id)">执行</button></template>
          </CommandCard>
        </div>
      </div>
    </div>
  </div>
</template>
<style lang="less" scoped>
.all-commands-container {
  display: flex;
  height: 100%;
  background: var(--bg-color);
}

/* === 加载状态 === */
.loading-overlay {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  gap: 12px;
}

.loading-spinner {
  width: 32px;
  height: 32px;
  border: 3px solid var(--divider-color);
  border-top-color: var(--primary-color);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

.loading-text {
  font-size: 13px;
  color: var(--text-color-secondary);
}

/* === 左侧面板 === */
.sources-panel {
  width: 220px;
  border-right: 1px solid var(--divider-color);
  display: flex;
  flex-direction: column;
  background: var(--bg-color);
}

.panel-header {
  padding: 16px 20px;
  border-bottom: 1px solid var(--divider-color);
  background: var(--bg-color);
  height: 56px;
  display: flex;
  align-items: center;
  box-sizing: border-box;
}

.panel-header h3 {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
  color: var(--text-color);
}

.sources-list {
  flex: 1;
  overflow-y: auto;
  padding: 8px;
}

.source-item {
  display: flex;
  align-items: center;
  padding: 10px 12px;
  margin-bottom: 4px;
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.2s;
  color: var(--text-color);
}

.source-item:hover {
  background: var(--hover-bg);
}

.source-item.active {
  background: var(--active-bg);
  color: var(--primary-color);
  font-weight: 500;
}

.source-item.active .source-svg-icon {
  color: var(--primary-color);
}

.source-icon {
  width: 20px;
  height: 20px;
  margin-right: 10px;
  font-size: 18px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.source-svg-icon {
  color: var(--text-secondary);
}

.plugin-icon {
  border-radius: 4px;
  object-fit: contain;
}

.source-name {
  flex: 1;
  font-size: 13px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.source-badge {
  padding: 2px 6px;
  font-size: 11px;
  background: var(--control-bg);
  color: var(--text-secondary);
  border-radius: 10px;
  min-width: 20px;
  text-align: center;
}

.source-item.active .source-badge {
  background: var(--primary-light-bg);
  color: var(--primary-color);
}

.section-divider {
  margin: 12px 0 8px;
  padding: 0 12px;
  font-size: 12px;
  font-weight: 600;
  color: var(--text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

/* === 右侧面板 === */
.commands-panel {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.commands-panel .panel-header {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px 20px;
  border-bottom: 1px solid var(--divider-color);
  background: var(--bg-color);
  height: 56px;
  box-sizing: border-box;
}

/* Tab 切换组 */
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

/* === 指令列表 === */
.commands-content {
  flex: 1;
  overflow-y: auto;
  padding: 16px 20px;
  position: relative;
}

.command-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.command-card {
  display: flex;
  align-items: center;
  padding: 12px 14px;
  cursor: default;
  transition: all 0.2s;
}

.command-card:hover {
  background: var(--hover-bg);
  transform: translateX(2px);
}

/* Feature 卡片 */
.feature-card {
  display: flex;
  flex-direction: column;
  padding: 12px 14px;
  cursor: default;
  transition: all 0.2s;
  gap: 8px;
}

.feature-card:hover {
  background: var(--hover-bg);
}

.feature-header {
  display: flex;
  align-items: center;
  gap: 10px;
}

.feature-icon {
  flex-shrink: 0;
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 6px;
  overflow: hidden;
}

.feature-icon img {
  width: 100%;
  height: 100%;
  object-fit: contain;
}

.feature-icon .icon-emoji {
  font-size: 16px;
  line-height: 1;
}

.feature-icon .icon-placeholder {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--control-bg);
  color: var(--text-secondary);
  font-size: 12px;
  font-weight: 600;
  border-radius: 6px;
}

.feature-title {
  flex: 1;
  font-size: 13px;
  font-weight: 500;
  color: var(--text-color);
  line-height: 1.4;
}

.feature-commands {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.command-tag {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 10px;
  background: rgba(14, 165, 233, 0.15);
  border: 1px solid rgba(14, 165, 233, 0.35);
  border-radius: 4px;
  font-size: 12px;
  color: #0ea5e9;
  font-weight: 500;
  transition: all 0.2s;
  cursor: default;
  user-select: none;
}

.command-tag:hover {
  background: #0ea5e9;
  color: white;
  border-color: #0ea5e9;
  transform: translateY(-1px);
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.15);
}

/* 暗色模式下的功能指令标签 */
@media (prefers-color-scheme: dark) {
  .command-tag {
    background: rgba(56, 189, 248, 0.15);
    border: 1px solid rgba(56, 189, 248, 0.3);
    color: #7dd3fc;
  }

  .command-tag:hover {
    background: #38bdf8;
    color: #1f2937;
    border-color: #38bdf8;
  }
}

/* 统一的标签徽章 */
.tag-badge {
  padding: 2px 6px;
  background: rgba(255, 255, 255, 0.3);
  border-radius: 3px;
  font-size: 10px;
  font-weight: 500;
  letter-spacing: 0.3px;
}

.command-tag:hover .tag-badge {
  background: rgba(255, 255, 255, 0.35);
}

/* 暗色模式下的标签徽章 */
@media (prefers-color-scheme: dark) {
  .tag-badge {
    background: rgba(255, 255, 255, 0.15);
  }

  .command-tag:hover .tag-badge {
    background: rgba(255, 255, 255, 0.25);
  }
}

.command-icon {
  width: 36px;
  height: 36px;
  margin-right: 14px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.command-icon img,
.command-icon .adaptive-icon {
  width: 100%;
  height: 100%;
  object-fit: contain;
  border-radius: 6px;
}

/* 自适应图标样式由全局 CSS 处理（style.css） */

.icon-emoji {
  font-size: 24px;
}

.icon-placeholder {
  width: 36px;
  height: 36px;
  border-radius: 6px;
  background: var(--primary-gradient);
  display: flex;
  align-items: center;
  justify-content: center;
  color: white;
  font-size: 16px;
  font-weight: 600;
}

.command-details {
  flex: 1;
  min-width: 0;
}

.command-title {
  font-size: 14px;
  font-weight: 500;
  color: var(--text-color);
  margin-bottom: 4px;
}

.command-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
}

.meta-tag {
  padding: 3px 8px;
  font-size: 11px;
  font-family: 'Consolas', 'Monaco', monospace;
  background: var(--control-bg);
  color: var(--primary-color);
  border-radius: 4px;
  font-weight: 500;
}

.meta-desc {
  font-size: 12px;
  color: var(--text-secondary);
}

.meta-path {
  font-size: 11px;
  font-family: 'Consolas', 'Monaco', monospace;
  color: var(--text-secondary);
  opacity: 0.6;
  word-break: break-all;
  line-height: 1.4;
}

.match-rule {
  font-size: 12px;
  color: var(--text-secondary);
  display: flex;
  align-items: center;
  gap: 4px;
}

.match-rule code {
  font-family: 'Consolas', 'Monaco', monospace;
  padding: 3px 8px;
  background: var(--control-bg);
  border-radius: 4px;
  font-size: 11px;
  color: var(--text-color);
  font-weight: 500;
}

.length-info {
  font-size: 11px;
  color: var(--text-secondary);
}

.type-badge {
  padding: 4px 10px;
  border-radius: 12px;
  font-size: 11px;
  font-weight: 600;
  flex-shrink: 0;
}

.badge-text {
  background: var(--primary-light-bg);
  color: var(--primary-color);
}

.badge-regex {
  background: var(--warning-light-bg);
  color: var(--warning-color);
}

.badge-over {
  background: var(--purple-light-bg);
  color: var(--purple-color);
}

.feature-command-row {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.empty-state {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 20px;
  text-align: center;
  pointer-events: none;
  color: var(--text-secondary);
}

.empty-icon {
  width: 56px;
  height: 56px;
  font-size: 56px;
  margin-bottom: 16px;
  opacity: 0.5;
  color: var(--text-secondary);
}

.empty-state p {
  margin: 0;
  font-size: 14px;
}

/* === 系统应用操作按钮 === */
.card-more-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: none;
  background: transparent;
  border-radius: 6px;
  color: var(--text-secondary);
  cursor: pointer;
  transition: all 0.15s;
}

.card-more-btn:hover {
  background: var(--control-bg);
  color: var(--text-color);
}
</style>
