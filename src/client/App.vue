<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, watch } from 'vue'
import { router } from '../../plugins/settings/src/router'
import { useDesktopStore } from './store'
import Launcher from '../../plugins/launcher/renderer/src/App.vue'
import SettingsPage from '../../plugins/settings/src/App.vue'

const desktop = useDesktopStore()
// 原版设置路由与启动器保留同一活实例，隐藏窗口不卸载页面。
const settingsVisible = computed(() => desktop.page !== 'launcher')
// 宿主只映射导航命令，市场内容由原版设置路由展示。
watch(() => desktop.page, async page => {
  if (page === 'launcher') return
  const name = page === 'plugins' ? 'Plugins' : page === 'plugin-market' ? 'Market' : 'GeneralSetting'
  try {
    await router.push({ name })
    await nextTick()
    // 设置路由与内嵌属性完成回填后才恢复窗口，过期导航不能覆盖新页面。
    if (desktop.page === page) await desktop.setLauncherHeight(690)
  } catch (error) { desktop.error = String(error) }
})
// 原版页面先处理层级返回，宿主仅处理尚未消费的设置退出。
function keydown(event: KeyboardEvent) {
  if (event.defaultPrevented || event.isComposing || event.key !== 'Escape' || !settingsVisible.value) return
  if (event.target instanceof Element && event.target.closest('[data-shortcut-capture], [data-hotkey]')) return
  event.preventDefault()
  desktop.navigate('launcher')
}
// 单一桌面订阅承接宿主状态与命令，不再使用重写的市场页面。
onMounted(() => {
  window.addEventListener('keydown', desktop.handleApplicationShortcut, true)
  window.addEventListener('keydown', keydown)
  void desktop.initialize()
})
// 渲染器销毁时撤销监听；窗口 hide 不触发此清理。
onUnmounted(() => {
  window.removeEventListener('keydown', desktop.handleApplicationShortcut, true)
  window.removeEventListener('keydown', keydown)
  desktop.dispose()
})
</script>

<template>
  <div class="source-shell">
    <Launcher :embedded-settings="settingsVisible">
      <template #plugin-content>
        <SettingsPage v-show="settingsVisible" />
      </template>
    </Launcher>
    <p v-if="desktop.error" class="source-error" role="alert">{{ desktop.error }}</p>
  </div>
</template>

<style scoped>
.source-shell { height: 100dvh; overflow: hidden; background: transparent; color: var(--text-color); }
.source-shell :deep(.app-container__plugin) { height: 100%; }
.source-shell :deep(.plugin-placeholder) { min-height: 0; }
.source-error { position: fixed; bottom: 0; left: 0; right: 0; padding: 8px 12px; margin: 0; background: var(--dialog-bg, var(--bg-color)); color: var(--danger-color, #ef4444); z-index: 100; }
</style>
