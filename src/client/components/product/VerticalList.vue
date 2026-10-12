<script setup lang="ts">
import AppIcon from '../AppIcon.vue'
import type { PluginInfo } from '../../../shared/contracts'
withDefaults(defineProps<{apps:PluginInfo[];selectedIndex?:number;disabled?:boolean}>(),{selectedIndex:-1})
defineEmits<{select:[app:PluginInfo]}>()
const statusLabels = { pending:'等待加载', loading:'加载中', active:'已启用', failed:'加载失败', disposed:'已停止', unloading:'停止中', disabled:'已禁用' } as const
</script>
<template>
  <div v-if="apps.length" class="vertical-list plugin-list">
    <div v-for="(app,index) in apps" :key="app.id" class="list-item plugin-item" :class="{selected:index===selectedIndex}" tabindex="0" role="button" :aria-label="`查看${app.name}详情`" :data-plugin-detail="app.id" @click="!disabled && $emit('select',app)" @keydown.enter.self="!disabled && $emit('select',app)">
      <div class="item-icon plugin-icon-wrapper"><AppIcon name="puzzle" /></div>
      <div class="plugin-info"><div class="plugin-name">{{app.name}}<span class="plugin-version">v{{app.version}}</span><span v-if="!app.enabled" class="disabled-badge">已禁用</span></div><div class="plugin-desc">{{app.id}} · {{statusLabels[app.status]}}</div></div>
      <div class="item-actions plugin-meta" @click.stop @keydown.stop><slot name="actions" :app="app" /></div>
    </div>
  </div>
</template>
<style scoped>
/* ZTools VerticalList 与 PluginsSetting 的真实列表/信息/动作布局。 */
.vertical-list{display:flex;flex-direction:column;gap:8px}.list-item{display:flex;align-items:center;padding:12px 14px;border-radius:8px;cursor:pointer;transition:background .2s,transform .2s}.list-item:hover{background:var(--hover-bg);transform:translateX(2px)}.list-item.selected{background:var(--active-bg)}.item-icon{display:flex;align-items:center;justify-content:center;width:40px;height:40px;flex-shrink:0;margin-right:12px;border-radius:6px;background:var(--active-bg)}.item-icon :deep(.icon){width:32px;height:32px}.plugin-info{flex:1;min-width:0}.plugin-name{display:flex;align-items:center;gap:8px;margin-bottom:4px;font-size:16px;font-weight:600;color:var(--text-color)}.plugin-version{font-size:11px;font-weight:500;color:var(--text-secondary);padding:2px 6px;background:var(--active-bg);border-radius:4px}.plugin-desc{font-size:13px;color:var(--text-secondary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.disabled-badge{font-size:11px;color:var(--text-secondary)}.plugin-meta{display:flex;align-items:center;gap:12px}
</style>
