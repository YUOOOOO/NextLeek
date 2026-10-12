<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { Command } from '../../shared/contracts'
import { keyboardAccelerator } from '../accelerator'
const props = defineProps<{ commands: Command[]; pluginId?: string }>()
const emit = defineEmits<{ updated: [] }>()
interface Binding { commandId: string; global: string | null; application: string | null; error?: string }
const bindings = ref<Binding[]>([])
const drafts = ref<Record<string, { global: string; application: string }>>({})
const error = ref('')
const saving = ref<string | null>(null)
const recording = ref<{ id: string; scope: 'global' | 'application' } | null>(null)
const visibleCommands = computed(() => props.commands.filter(command => !props.pluginId || command.pluginId === props.pluginId))
let disposed = false
let revision = 0
// 从快捷键内置插件读取持久绑定，并按当前指令刷新编辑草稿。
async function load() {
  const current = ++revision
  try {
    const result = await window.desktop.invokePlugin('command-shortcuts', 'list', null) as Binding[]
    if (disposed || current !== revision) return
    bindings.value = result
    drafts.value = Object.fromEntries(props.commands.map(command => {
      const binding = result.find(row => row.commandId === command.id)
      return [command.id, { global: binding?.global ?? '', application: binding?.application ?? '' }]
    }))
  } catch (cause) { if (!disposed) error.value = cause instanceof Error ? cause.message : String(cause) }
}
// 录制时暂停全部系统指令快捷键，避免按组合键切走当前页面。
async function start(id: string, scope: 'global' | 'application') {
  recording.value = { id, scope }
  try { await window.desktop.setHotkeyCapture(true) }
  catch (cause) { recording.value = null; error.value = String(cause) }
}
// 退出录制后恢复原生注册，不隐式保存草稿。
async function stop() {
  if (!recording.value) return
  recording.value = null
  try { await window.desktop.setHotkeyCapture(false) }
  catch (cause) { if (!disposed) error.value = String(cause) }
}
// 仅记录规范组合键；Esc 取消当前录制，不越级退出详情。
function capture(event: KeyboardEvent, id: string, scope: 'global' | 'application') {
  if (event.key === 'Tab') return
  event.preventDefault()
  event.stopPropagation()
  if (event.key === 'Escape') { void stop(); (event.target as HTMLInputElement).blur(); return }
  const accelerator = keyboardAccelerator(event)
  if (accelerator && drafts.value[id]) drafts.value[id]![scope] = accelerator
}
// 原生 Alt+Space 被系统截获，通过安全预加载事件送入正在录制的字段。
function receiveHotkey(value: string) {
  const active = recording.value
  if (active && drafts.value[active.id]) drafts.value[active.id]![active.scope] = value
}
// 校验和注册由插件端完成，成功后重新读取落盘结果并通知应用缓存。
async function save(id: string, clear = false) {
  if (saving.value) return
  saving.value = id
  error.value = ''
  try {
    await stop()
    const draft = drafts.value[id]!
    await window.desktop.invokePlugin('command-shortcuts', 'set', { commandId: id, global: clear ? null : draft.global || null, application: clear ? null : draft.application || null })
    await load()
    emit('updated')
  } catch (cause) { error.value = cause instanceof Error ? cause.message : String(cause) }
  finally { saving.value = null }
}
// 指令变化会撤销不可用注册并同步新增指令的可编辑字段。
watch(() => props.commands, () => { void load() })
// 挂载时获取快捷键，并监听仅用于录制的宿主组合键事件。
let unsubscribe: (() => void) | undefined
onMounted(() => {
  void load()
  unsubscribe = window.desktop.subscribe(event => { if (event.type === 'hotkey') receiveHotkey(event.value) })
})
// 卸载时释放录制状态和事件订阅，避免暂停全局快捷键残留。
onBeforeUnmount(() => { disposed = true; revision++; unsubscribe?.(); void stop() })
</script>

<template>
  <section class="command-shortcuts" data-testid="command-shortcuts" aria-label="插件指令与快捷键">
    <h3>指令与快捷键</h3>
    <p class="command-shortcuts__hint">全局快捷键在其他应用中也可唤起指令；应用快捷键仅在 NextTools 内生效。点击输入框录制，保存后生效。</p>
    <p v-if="error" role="alert" class="command-shortcuts__error">{{ error }}</p>
    <p v-if="!visibleCommands.length" class="command-shortcuts__hint">此插件当前未注册可用指令。</p>
    <div v-for="command in visibleCommands" :key="command.id" class="command-shortcuts__row" :data-command-id="command.id">
      <div class="command-shortcuts__name"><strong>{{ command.title }}</strong><small>{{ command.keywords.join(' · ') }}</small><small v-if="bindings.find(row => row.commandId === command.id)?.error" class="command-shortcuts__error">{{ bindings.find(row => row.commandId === command.id)?.error }}</small></div>
      <label>全局快捷键<input :value="drafts[command.id]?.global ?? ''" data-shortcut-capture readonly :aria-label="`${command.title} 全局快捷键`" placeholder="点击录制" @focus="start(command.id, 'global')" @blur="stop" @keydown="capture($event, command.id, 'global')"></label>
      <label>应用快捷键<input :value="drafts[command.id]?.application ?? ''" data-shortcut-capture readonly :aria-label="`${command.title} 应用快捷键`" placeholder="点击录制" @focus="start(command.id, 'application')" @blur="stop" @keydown="capture($event, command.id, 'application')"></label>
      <div class="command-shortcuts__actions"><button :disabled="!!saving" @click="save(command.id)">保存</button><button :disabled="!!saving" @click="save(command.id, true)">清除</button></div>
    </div>
  </section>
</template>

<style scoped>
.command-shortcuts { margin-top: 16px; padding-top: 16px; border-top: 1px solid var(--line); font-size: 13px; }
.command-shortcuts h3 { margin: 0 0 8px; font-size: 14px; font-weight: 600; }
.command-shortcuts__hint { color: var(--muted); line-height: 1.6; margin: 0 0 12px; }
.command-shortcuts__row { display: grid; grid-template-columns: minmax(120px, 1fr) 150px 150px auto; align-items: center; gap: 12px; padding: 12px 0; border-top: 1px solid var(--line); }
.command-shortcuts__name { min-width: 0; }
.command-shortcuts__name strong { font-weight: 500; }
.command-shortcuts__name small { display: block; color: var(--muted); margin-top: 4px; overflow-wrap: anywhere; }
.command-shortcuts label { font-size: 12px; color: var(--muted); }
.command-shortcuts input { width: 100%; margin-top: 5px; padding: 8px; color: var(--ink); background: var(--surface-raised); border: 1px solid var(--line); border-radius: 6px; font: inherit; text-align: center; cursor: pointer; box-sizing: border-box; }
.command-shortcuts input:focus { outline: 1px solid var(--accent); }
.command-shortcuts__actions { display: flex; gap: 8px; }
.command-shortcuts button { background: var(--surface-raised); color: var(--accent); border: 1px solid var(--line); border-radius: 6px; padding: 7px 10px; cursor: pointer; font: inherit; }
.command-shortcuts button:disabled { opacity: .5; cursor: not-allowed; }
.command-shortcuts .command-shortcuts__error { color: var(--rose); }
@media (max-width: 780px) { .command-shortcuts__row { grid-template-columns: 1fr 1fr; } .command-shortcuts__name { grid-column: 1 / -1; } }
</style>
