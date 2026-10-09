<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { useDesktopStore } from './store'
import AppIcon from './components/AppIcon.vue'
import CommandTile from './components/CommandTile.vue'
import type { Settings } from '../shared/contracts'

const desktop = useDesktopStore()
const search = ref<HTMLInputElement | null>(null)
const themeControl = ref<HTMLSelectElement | null>(null)
const selected = ref(0)
const composing = ref(false)
const expanded = ref(false)
const hotkey = ref('')
const systemDark = ref(false)
const searchMode = computed(() => desktop.query.trim().length > 0)
const recentVisible = computed(() => expanded.value ? desktop.recent : desktop.recent.slice(0, 8))
const visibleCommands = computed(() => searchMode.value ? desktop.results : [...recentVisible.value, ...desktop.pinned])
const settings = computed(() => desktop.snapshot?.settings)
const dark = computed(() => settings.value?.theme === 'dark' || (settings.value?.theme === 'system' && systemDark.value))
const accents = [
  { id: 'blue', label: '海蓝' }, { id: 'violet', label: '紫罗兰' },
  { id: 'green', label: '松绿' }, { id: 'orange', label: '琥珀' },
  { id: 'rose', label: '玫瑰' }, { id: 'teal', label: '青碧' },
] as const
const navigation = [
  { id: 'settings', label: '通用设置', icon: 'gear' },
  { id: 'theme', label: '外观主题', icon: 'palette' },
  { id: 'plugins', label: '已安装插件', icon: 'puzzle' },
] as const

watch(() => settings.value?.hotkey, value => { hotkey.value = value ?? '' })
watch(() => desktop.query, () => { selected.value = 0; if (searchMode.value) desktop.page = 'launcher' })
watch(visibleCommands, commands => { selected.value = Math.min(selected.value, Math.max(0, commands.length - 1)) })
watch(() => desktop.page, async page => {
  selected.value = 0
  await nextTick()
  if (page === 'launcher') search.value?.focus()
  if (page === 'theme') themeControl.value?.focus()
})
watch(() => desktop.focusRequest, async () => { await nextTick(); search.value?.focus() })

function changeTheme(event: Event) {
  void desktop.update({ theme: (event.target as HTMLSelectElement).value as Settings['theme'] })
}
function saveHotkey() { if (hotkey.value.trim()) void desktop.update({ hotkey: hotkey.value.trim() }) }
function captureHotkey(event: KeyboardEvent) {
  if (event.key === 'Tab') return
  if (event.key === 'Escape') { event.preventDefault(); hotkey.value = settings.value?.hotkey ?? ''; return }
  if (event.key === 'Enter') { event.preventDefault(); saveHotkey(); return }
  event.preventDefault()
  if (['Control', 'Alt', 'Shift', 'Meta'].includes(event.key)) return
  if (!(event.ctrlKey || event.altKey || event.metaKey)) return
  const key = event.code === 'Space' ? 'Space' : event.key.length === 1 ? event.key.toUpperCase() : event.key
  hotkey.value = [...(event.ctrlKey ? ['Control'] : []), ...(event.altKey ? ['Alt'] : []), ...(event.shiftKey ? ['Shift'] : []), ...(event.metaKey ? ['Super'] : []), key].join('+')
}
function keydown(event: KeyboardEvent) {
  if (event.isComposing || composing.value || event.keyCode === 229 || event.defaultPrevented) return
  const target = event.target as HTMLElement
  if (target.closest('[data-hotkey]')) return
  if (event.key === 'Escape') {
    event.preventDefault()
    if (desktop.query) desktop.query = ''
    else if (desktop.page !== 'launcher' && !settings.value?.escHide) desktop.navigate('launcher')
    else { desktop.navigate('launcher'); void desktop.hide() }
    return
  }
  if (desktop.page !== 'launcher' || !visibleCommands.value.length || desktop.busy) return
  if (target.closest('.pin-action') || target.closest('.brand-button') || target.closest('.window-action')) return
  if (event.key === 'Enter' && (target === search.value || target.closest('.command-launch'))) {
    event.preventDefault()
    const command = visibleCommands.value[selected.value]
    if (command) void desktop.run(command)
    return
  }
  const movement = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].indexOf(event.key)
  if (movement === -1 || (target !== search.value && !target.closest('.command-launch'))) return
  event.preventDefault()
  const tile = document.querySelector<HTMLElement>('.command-tile')
  const grid = tile?.parentElement
  const columns = grid && tile ? Math.max(1, Math.round(grid.clientWidth / tile.getBoundingClientRect().width)) : 1
  const offsets = [-1, 1, -columns, columns]
  selected.value = Math.max(0, Math.min(visibleCommands.value.length - 1, selected.value + (offsets[movement] ?? 0)))
  if (target !== search.value) document.querySelector<HTMLButtonElement>(`[data-command-index="${selected.value}"]`)?.focus()
  else document.querySelector<HTMLElement>(`[data-command-index="${selected.value}"]`)?.scrollIntoView({ block: 'nearest' })
}
let media: MediaQueryList | undefined
function syncSystemTheme(event: MediaQueryListEvent) { systemDark.value = event.matches }
onMounted(() => {
  media = window.matchMedia('(prefers-color-scheme: dark)')
  systemDark.value = media.matches
  media.addEventListener('change', syncSystemTheme)
  window.addEventListener('keydown', keydown)
  void desktop.initialize().then(() => nextTick(() => search.value?.focus()))
})
onUnmounted(() => {
  media?.removeEventListener('change', syncSystemTheme)
  window.removeEventListener('keydown', keydown)
  desktop.dispose()
})
</script>

<template>
  <div class="app-shell" :class="{ dark, compact: settings?.compact }" :data-accent="settings?.accent ?? 'green'">
    <header class="search-header">
      <button v-if="desktop.page !== 'launcher'" class="back-button" aria-label="返回启动器" @click="desktop.navigate('launcher')"><AppIcon name="back" /></button>
      <input ref="search" v-model="desktop.query" class="search-input" type="search" aria-label="搜索应用和指令" placeholder="搜索应用和指令" autocomplete="off" spellcheck="false" :disabled="desktop.loading || !desktop.snapshot" @compositionstart="composing = true" @compositionend="composing = false" />
      <button class="window-action" aria-label="隐藏窗口" title="隐藏窗口" @click="desktop.hide()"><AppIcon name="close" /></button>
      <button class="brand-button" aria-label="打开设置" title="NextLeek · 设置" @click="desktop.navigate('settings')"><svg viewBox="0 0 32 32" aria-hidden="true"><path d="M8 24V8l16 16V8M8 8h9M15 24h9" /></svg></button>
    </header>

    <div v-if="desktop.error" class="error-strip" role="alert"><span>{{ desktop.error }}</span><button v-if="!desktop.snapshot" @click="desktop.initialize()">重新连接</button><button v-else aria-label="关闭错误提示" @click="desktop.error = ''"><AppIcon name="close" /></button></div>
    <main v-if="desktop.loading" class="state-message" role="status">正在连接桌面运行时…</main>
    <main v-else-if="!desktop.snapshot" class="state-message"><AppIcon name="command" /><h1>无法连接桌面运行时</h1><p>未读取到设置和指令。请重试连接，或重新打开应用。</p><button class="text-button" @click="desktop.initialize()">重新连接</button></main>
    <main v-else-if="desktop.page === 'launcher'" class="launcher" aria-label="启动器" :aria-busy="desktop.busy">
      <template v-if="searchMode">
        <section aria-labelledby="results-heading"><div class="section-heading"><h1 id="results-heading">搜索结果</h1><span>{{ desktop.results.length }} 项指令</span></div>
          <div v-if="desktop.results.length" class="command-grid"><CommandTile v-for="(command, index) in desktop.results" :key="command.id" :command="command" :index="index" :selected="selected === index" :pinned="desktop.snapshot.pinned.includes(command.id)" :disabled="desktop.busy" @select="selected = index" @run="desktop.run(command)" @pin="desktop.pin(command)" /></div>
          <div v-else class="empty-state"><h2>没有匹配的指令</h2><p>试试指令名称、用途或关键词。</p><button class="text-button" @click="desktop.query = ''">清除搜索</button></div>
        </section>
      </template>
      <template v-else>
        <section aria-labelledby="recent-heading"><div class="section-heading"><h1 id="recent-heading">最近使用</h1><button v-if="desktop.recent.length > 8" class="subtle-button" :aria-expanded="expanded" @click="expanded = !expanded">{{ expanded ? '收起' : `展开 (${desktop.recent.length})` }}</button></div>
          <div v-if="recentVisible.length" class="command-grid"><CommandTile v-for="(command, index) in recentVisible" :key="command.id" :command="command" :index="index" :selected="selected === index" :pinned="desktop.snapshot.pinned.includes(command.id)" :disabled="desktop.busy" @select="selected = index" @run="desktop.run(command)" @pin="desktop.pin(command)" /></div>
          <div v-else class="empty-state inline-empty"><p>输入名称开始搜索，使用过的指令会显示在这里。</p><button class="text-button" @click="desktop.navigate('settings')">打开设置</button></div>
        </section>
        <section aria-labelledby="pinned-heading"><div class="section-heading"><h2 id="pinned-heading">已固定</h2><span>右键图标固定指令</span></div>
          <div v-if="desktop.pinned.length" class="command-grid"><CommandTile v-for="(command, index) in desktop.pinned" :key="command.id" :command="command" :index="recentVisible.length + index" :selected="selected === recentVisible.length + index" :pinned="true" :disabled="desktop.busy" @select="selected = recentVisible.length + index" @run="desktop.run(command)" @pin="desktop.pin(command)" /></div>
          <p v-else class="inline-empty">搜索指令后，点击固定按钮将常用指令留在这里。</p>
        </section>
      </template>
    </main>
    <div v-else class="settings-layout">
      <nav class="settings-sidebar" aria-label="设置导航"><button v-for="item in navigation" :key="item.id" :class="{ active: desktop.page === item.id }" :aria-current="desktop.page === item.id ? 'page' : undefined" @click="desktop.navigate(item.id)"><AppIcon :name="item.icon" />{{ item.label }}</button><button class="quit-button" :disabled="desktop.busy" @click="desktop.quit()"><AppIcon name="power" />退出 NextLeek</button></nav>
      <main class="settings-content" :aria-busy="desktop.busy">
        <template v-if="desktop.page === 'settings' && settings">
          <h1 class="sr-only">通用设置</h1>
          <div class="setting-row"><div><label for="hotkey">呼出快捷键</label><p>设置全局快捷键来呼出应用</p></div><form class="hotkey-control" @submit.prevent="saveHotkey"><input id="hotkey" v-model="hotkey" data-hotkey aria-describedby="hotkey-hint" :disabled="desktop.busy" @keydown="captureHotkey" /><button type="submit" :disabled="desktop.busy || hotkey === settings.hotkey || !hotkey.trim()">保存</button><span id="hotkey-hint" class="sr-only">按下包含 Control、Alt 或 Super 的组合键，然后保存</span></form></div>
          <div class="setting-row"><div><label id="autostart-label">开机自启</label><p>登录电脑后自动运行 NextLeek</p></div><button class="switch" role="switch" aria-labelledby="autostart-label" :aria-checked="settings.autostart" :disabled="desktop.busy" @click="desktop.update({ autostart: !settings.autostart })"><span /></button></div>
          <div class="setting-row"><div><label id="compact-label">紧凑顶部栏</label><p>缩小搜索框，留出更多内容空间</p></div><button class="switch" role="switch" aria-labelledby="compact-label" :aria-checked="settings.compact" :disabled="desktop.busy" @click="desktop.update({ compact: !settings.compact })"><span /></button></div>
          <div class="setting-row"><div><label id="escape-label">ESC 隐藏</label><p>在设置中按 Esc 隐藏窗口，下次唤出返回搜索</p></div><button class="switch" role="switch" aria-labelledby="escape-label" :aria-checked="settings.escHide" :disabled="desktop.busy" @click="desktop.update({ escHide: !settings.escHide })"><span /></button></div>
        </template>
        <template v-else-if="desktop.page === 'theme' && settings">
          <h1 class="sr-only">外观主题</h1>
          <div class="setting-row"><div><label for="theme">主题设置</label><p>选择应用的主题外观</p></div><select id="theme" ref="themeControl" :value="settings.theme" :disabled="desktop.busy" @change="changeTheme"><option value="system">跟随系统</option><option value="light">亮色</option><option value="dark">暗色</option></select></div>
          <div class="setting-row"><div><h2 id="accent-label">主题色</h2><p>自定义应用的主题色调</p></div><div class="accent-options" role="group" aria-labelledby="accent-label"><button v-for="accent in accents" :key="accent.id" class="accent-swatch" :data-swatch="accent.id" :aria-label="accent.label" :aria-pressed="settings.accent === accent.id" :disabled="desktop.busy" @click="desktop.update({ accent: accent.id })"><span v-if="settings.accent === accent.id" /></button></div></div>
        </template>
        <template v-else-if="desktop.page === 'plugins'">
          <div class="plugins-heading"><h1>已安装插件</h1><span>{{ desktop.snapshot.plugins.length }} 个插件</span></div>
          <p v-if="!desktop.snapshot.plugins.length" class="inline-empty">运行时尚未注册插件。插件加载后会显示在这里。</p>
          <article v-for="plugin in desktop.snapshot.plugins" :key="plugin.id" class="plugin-row"><span class="plugin-icon"><AppIcon name="puzzle" /></span><div class="plugin-info"><h2>{{ plugin.name }} <span class="plugin-version">v{{ plugin.version }}</span></h2><p>{{ plugin.id }}</p><span class="plugin-status">{{ plugin.status }}<template v-if="plugin.protected"> · 内置核心</template></span></div><button class="switch" role="switch" :aria-label="`启用${plugin.name}`" :aria-checked="plugin.enabled" :disabled="desktop.busy || plugin.protected" @click="desktop.togglePlugin(plugin.id, !plugin.enabled)"><span /></button></article>
        </template>
      </main>
    </div>
    <footer v-if="desktop.snapshot && desktop.page === 'launcher'" class="launcher-footer"><span><kbd>↑ ↓ ← →</kbd> 选择 <kbd>Enter</kbd> 打开</span><span><kbd>Esc</kbd> 隐藏</span></footer>
  </div>
</template>
