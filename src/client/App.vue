<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useDesktopStore } from './store'
import Launcher from '../../plugins/launcher/renderer/src/App.vue'
import SettingsPage from '../../plugins/settings/src/components/SettingHone/SettingHone.vue'
import PluginMarket from '../../plugins/plugin-market/client.vue'
import type { Page } from '../shared/contracts'

const desktop = useDesktopStore()
const market = ref<InstanceType<typeof PluginMarket> | null>(null)
const marketReturnPage = ref<Page>('settings')
// 页面只共享一个活状态，隐藏窗口与切换页面不卸载业务视图。
const settingsVisible = computed(() => desktop.page === 'settings' || desktop.page === 'plugins')
// 记录市场入口，关闭会话与离开市场仍由市场组件逐层执行。
watch(() => desktop.page, (page, previous) => {
  if (page === 'plugin-market' && previous !== 'plugin-market') marketReturnPage.value = previous
  if (page !== 'launcher') void desktop.setLauncherHeight(690)
})
// 原生主题跟随设置；根节点仅映射原版主题色类。
watch(() => desktop.snapshot?.settings.accent, accent => {
  for (const color of ['blue', 'purple', 'green', 'orange', 'red', 'pink']) document.documentElement.classList.remove(`theme-${color}`)
  const mapped = accent === 'violet' ? 'purple' : accent === 'rose' ? 'pink' : accent === 'teal' ? 'green' : accent ?? 'green'
  document.documentElement.classList.add(`theme-${mapped}`)
  if (accent === 'teal') document.documentElement.style.setProperty('--primary-color', '#087f85')
  else document.documentElement.style.removeProperty('--primary-color')
}, { immediate: true })
// 非启动器页面的 Escape 返回上层，启动器内部选择由原版页面处理。
function keydown(event: KeyboardEvent) {
  if (event.defaultPrevented || event.isComposing || event.key !== 'Escape' || desktop.page === 'launcher') return
  if (event.target instanceof Element && event.target.closest('[data-shortcut-capture], [data-hotkey]')) return
  event.preventDefault()
  if (desktop.page === 'plugin-market') market.value?.back()
  else desktop.navigate('launcher')
}
// 页面入口复用安全桥导航，不创建第二套业务状态。
function navigate(page: Page) { desktop.navigate(page) }
// 统一初始化桥接监听与应用快捷键，页面本身只消费共享状态。
onMounted(() => {
  document.documentElement.classList.add(navigator.platform.startsWith('Win') ? 'os-windows' : navigator.platform.startsWith('Mac') ? 'os-mac' : 'os-linux')
  window.addEventListener('keydown', desktop.handleApplicationShortcut, true)
  window.addEventListener('keydown', keydown)
  void desktop.initialize()
})
// 退出渲染器时释放唯一桥接订阅，不将窗口隐藏当作卸载。
onUnmounted(() => {
  window.removeEventListener('keydown', desktop.handleApplicationShortcut, true)
  window.removeEventListener('keydown', keydown)
  desktop.dispose()
})
</script>

<template>
  <div class="source-shell">
    <Launcher v-show="desktop.page === 'launcher'" @navigate="navigate" />
    <SettingsPage v-show="settingsVisible" :page="desktop.page === 'plugins' ? 'plugins' : 'settings'" @navigate="navigate" />
    <PluginMarket ref="market" v-show="desktop.page === 'plugin-market'" :active="desktop.page === 'plugin-market'" :open-request="desktop.openPluginRequest" @back="desktop.navigate(marketReturnPage)" @command-result="desktop.applyCommandResult" @shortcuts-updated="desktop.refreshShortcutBindings" />
    <p v-if="desktop.error" class="source-error" role="alert">{{ desktop.error }}</p>
  </div>
</template>

<style scoped>
.source-shell { height: 100dvh; overflow: hidden; background: var(--bg-color); color: var(--text-color); }
.source-error { position: fixed; bottom: 0; left: 0; right: 0; padding: 8px 12px; margin: 0; background: var(--dialog-bg, var(--bg-color)); color: var(--danger-color, #ef4444); z-index: 100; }
</style>
