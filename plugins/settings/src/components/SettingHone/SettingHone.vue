<!-- MIT Copyright (c) 2025 lzx8589561; adapted to the NextTools Cordis desktop contract. -->
<script setup lang="ts">
import { ref, watch } from 'vue'
import type { Page } from '../../../../../src/shared/contracts'
import LeftMenu from '../LeftMenu/LeftMenu.vue'
import GeneralSetting from '../../views/GeneralSetting/GeneralSetting.vue'
import PluginsSetting from '../../views/PluginsSetting/PluginsSetting.vue'
import ShortcutsSetting from '../../views/ShortcutsSetting/ShortcutsSetting.vue'
import AboutSetting from '../../views/AboutSetting/AboutSetting.vue'
import AllCommandsSetting from '../../views/AllCommandsSetting/AllCommandsSetting.vue'
const props=withDefaults(defineProps<{page?:'settings'|'plugins'}>(),{page:'settings'})
const emit=defineEmits<{navigate:[page:Page]}>()
const active=ref(props.page==='plugins'?'Plugins':'GeneralSetting')
// 宿主快捷入口更新本地菜单，窗口隐藏/重现不重置当前设置子页。
watch(()=>props.page,value=>{active.value=value==='plugins'?'Plugins':'GeneralSetting'})
// 市场使用既有受限生态；设置菜单保持原始顺序和名称。
function select(name:string){if(name==='Market'){emit('navigate','plugin-market');return}active.value=name}
</script>
<template><div class="setting-hone"><div class="setting-hone-menu"><LeftMenu :active="active" @select="select" /></div><div class="w-full setting-hone-content"><GeneralSetting v-if="active==='GeneralSetting'" /><PluginsSetting v-else-if="active==='Plugins'" @navigate="emit('navigate',$event)" /><ShortcutsSetting v-else-if="active==='Shortcuts'" /><AboutSetting v-else-if="active==='About'" /><AllCommandsSetting v-else-if="active==='AllCommands'" /></div></div></template>
<style lang="less" scoped>
.setting-hone {
  height: 100%;
  display: flex;
  &-menu {
    height: 100%;
    min-height: 0;
  }

  &-content {
    flex: 1;
    min-height: 0;
    overflow: hidden;
  }
}
</style>
