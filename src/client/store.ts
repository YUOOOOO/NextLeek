import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import type { Command, DesktopAPI, DesktopEvent, Settings, Snapshot, UpdateState } from '../shared/contracts'

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
  const launcherRevealed = ref(false)
  const updateState = ref<UpdateState | null>(null)
  const updateBusy = ref(false)
  const updateError = ref('')
  let updateRevision = 0
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
  const homeCommands = computed(() => {
    const ids = new Set([...(snapshot.value?.pinned ?? []), ...(snapshot.value?.recent ?? [])])
    const byId = new Map(commands.value.map(command => [command.id, command]))
    return [...ids].map(id => byId.get(id)).filter((command): command is Command => Boolean(command))
  })

  function message(cause: unknown) {
    error.value = cause instanceof Error ? cause.message : String(cause)
  }
  function navigate(target: typeof page.value) {
    if (target === 'launcher' && page.value !== 'launcher') launcherRevealed.value = true
    page.value = target
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
    if (event.type === 'shown') {
      page.value = 'launcher'
      launcherRevealed.value = false
      if (snapshot.value?.recent.length || snapshot.value?.pinned.length) query.value = ''
      focusRequest.value++
    }
    if (event.type === 'update') { updateRevision++; updateState.value = event.update; updateError.value = '' }
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
      await refreshUpdateState()
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
  async function setHotkeyCapture(active: boolean) {
    if (!window.desktop) return false
    try { await window.desktop.setHotkeyCapture(active); return true }
    catch (cause) { message(cause); return false }
  }
  async function setLauncherExpanded(expanded: boolean) {
    if (!window.desktop) return
    try { await window.desktop.setLauncherExpanded(expanded) }
    catch (cause) { message(cause) }
  }
  async function refreshUpdateState() {
    const current = updateRevision
    try {
      const state = await window.desktop.getUpdateState()
      if (!disposed && current === updateRevision) updateState.value = state
    } catch (cause) { if (!disposed) updateError.value = cause instanceof Error ? cause.message : String(cause) }
  }
  async function performUpdate(action: () => Promise<UpdateState>) {
    if (updateBusy.value) return
    updateBusy.value = true
    updateError.value = ''
    const current = updateRevision
    try {
      const state = await action()
      if (!disposed && current === updateRevision) updateState.value = state
    } catch (cause) { if (!disposed) updateError.value = cause instanceof Error ? cause.message : String(cause) }
    finally { updateBusy.value = false }
  }
  async function checkForUpdates() { await performUpdate(() => window.desktop.checkForUpdates()) }
  async function downloadUpdate() { await performUpdate(() => window.desktop.downloadUpdate()) }
  async function installUpdate() { await performUpdate(() => window.desktop.installUpdate()) }
  async function hide() { await perform(() => window.desktop.hide()) }
  function dispose() { disposed = true; unsubscribe?.(); unsubscribe = undefined }
  return { snapshot, commands, page, loading, busy, error, query, focusRequest, launcherRevealed, results, homeCommands, updateState, updateBusy, updateError, navigate, initialize, run, update, pin, togglePlugin, setHotkeyCapture, setLauncherExpanded, refreshUpdateState, checkForUpdates, downloadUpdate, installUpdate, hide, dispose }
})
