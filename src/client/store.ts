import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import type { Command, DesktopAPI, DesktopEvent, Settings, Snapshot } from '../shared/contracts'

declare global {
  interface Window { desktop: DesktopAPI }
}

export const useDesktopStore = defineStore('desktop', () => {
  const snapshot = ref<Snapshot | null>(null)
  const commands = ref<Command[]>([])
  const page = ref<'launcher' | 'settings' | 'plugins' | 'theme'>('launcher')
  const loading = ref(true)
  const busy = ref(false)
  const error = ref('')
  const query = ref('')
  const focusRequest = ref(0)
  let unsubscribe: (() => void) | undefined
  let disposed = false
  let commandRevision = 0
  let revision = 0

  const results = computed(() => {
    const terms = query.value.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean)
    const pinned = new Set(snapshot.value?.pinned ?? [])
    return commands.value.filter(command => {
      const text = [command.title, command.description, ...command.keywords].join(' ').toLocaleLowerCase()
      return terms.every(term => text.includes(term))
    }).sort((a, b) => Number(pinned.has(b.id)) - Number(pinned.has(a.id)))
  })
  const pinned = computed(() => (snapshot.value?.pinned ?? []).flatMap(id => commands.value.filter(command => command.id === id)))
  const recent = computed(() => (snapshot.value?.recent ?? []).flatMap(id => commands.value.filter(command => command.id === id)))

  function message(cause: unknown) {
    error.value = cause instanceof Error ? cause.message : String(cause)
  }
  function navigate(target: typeof page.value) {
    page.value = target
    query.value = ''
  }
  function receive(event: DesktopEvent) {
    if (disposed) return
    if (event.type === 'snapshot') {
      const previousPlugins = snapshot.value?.plugins ?? []
      const pluginsChanged = event.snapshot.plugins.length !== previousPlugins.length || event.snapshot.plugins.some(plugin =>
        previousPlugins.find(previous => previous.id === plugin.id)?.enabled !== plugin.enabled,
      )
      revision++
      snapshot.value = event.snapshot
      if (pluginsChanged) void refreshCommands()
    }
    if (event.type === 'navigate') navigate(event.page)
    if (event.type === 'shown') { navigate('launcher'); focusRequest.value++ }
  }
  async function refreshCommands() {
    const current = ++commandRevision
    try {
      const registered = await window.desktop.listCommands()
      if (!disposed && current === commandRevision) commands.value = registered
    } catch (cause) { if (!disposed) message(cause) }
  }
  async function initialize() {
    loading.value = true
    error.value = ''
    try {
      if (!window.desktop) throw new Error('桌面连接不可用，请在 NextLeek 桌面应用中打开。')
      unsubscribe?.()
      unsubscribe = window.desktop.subscribe(receive)
      const startRevision = revision
      const startCommandRevision = commandRevision
      const [next, registered] = await Promise.all([window.desktop.getSnapshot(), window.desktop.listCommands()])
      if (disposed) return
      if (revision === startRevision) snapshot.value = next
      if (commandRevision === startCommandRevision) commands.value = registered
    } catch (cause) { message(cause) }
    finally { if (!disposed) loading.value = false }
  }
  async function perform(action: () => Promise<unknown>) {
    if (busy.value) return
    busy.value = true
    error.value = ''
    try { await action() } catch (cause) { message(cause) }
    finally { busy.value = false }
  }
  async function run(command: Command) {
    await perform(async () => {
      const result = await window.desktop.runCommand(command.id)
      if (result.navigate) navigate(result.navigate)
    })
  }
  async function update(patch: Partial<Settings>) {
    await perform(async () => { snapshot.value = await window.desktop.updateSettings(patch) })
  }
  async function pin(command: Command) {
    await perform(async () => { snapshot.value = await window.desktop.setPinned(command.id, !snapshot.value?.pinned.includes(command.id)) })
  }
  async function togglePlugin(id: string, enabled: boolean) {
    await perform(async () => { snapshot.value = await window.desktop.setPluginEnabled(id, enabled) })
  }
  async function hide() { await perform(() => window.desktop.hide()) }
  async function quit() { await perform(() => window.desktop.quit()) }
  function dispose() { disposed = true; unsubscribe?.(); unsubscribe = undefined }
  return { snapshot, commands, page, loading, busy, error, query, focusRequest, results, pinned, recent, navigate, initialize, run, update, pin, togglePlugin, hide, quit, dispose }
})
