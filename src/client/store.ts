import { computed, ref, watch } from 'vue'
import { defineStore } from 'pinia'
import type { Command, DesktopAPI, DesktopEvent, LauncherSearchGroup, LauncherSearchItem, Page, Settings, Snapshot, UpdateState } from '../shared/contracts'

declare global {
  interface Window { desktop: DesktopAPI }
}

export const useDesktopStore = defineStore('desktop', () => {
  const snapshot = ref<Snapshot | null>(null)
  const commands = ref<Command[]>([])
  const page = ref<Page>('launcher')
  const loading = ref(true)
  const busy = ref(false)
  const error = ref('')
  const query = ref('')
  const focusRequest = ref(0)
  const updateState = ref<UpdateState | null>(null)
  const updateBusy = ref(false)
  const updateError = ref('')
  const searchGroups = ref<LauncherSearchGroup[]>([])
  const searchLoading = ref(false)
  const searchError = ref('')
  const searchFeedback = ref('')
  const searchActionBusy = ref(false)
  const searchComposing = ref(false)
  const searchPageSize = 30
  let searchTimer: ReturnType<typeof setTimeout> | undefined
  let searchRevision = 0
  let searchActionRevision = 0
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
  const commandsById = computed(() => new Map(commands.value.map(command => [command.id, command])))
  const recentCommands = computed(() => (snapshot.value?.recent ?? [])
    .map(id => commandsById.value.get(id)).filter((command): command is Command => Boolean(command)))
  const pinnedCommands = computed(() => (snapshot.value?.pinned ?? [])
    .map(id => commandsById.value.get(id)).filter((command): command is Command => Boolean(command)))

  function cancelSearch() {
    clearTimeout(searchTimer)
    searchTimer = undefined
    searchRevision++
    searchActionRevision++
    searchLoading.value = false
    searchActionBusy.value = false
  }
  function scheduleSearch() {
    cancelSearch()
    searchGroups.value = []
    searchError.value = ''
    searchFeedback.value = ''
    if (disposed || loading.value || !snapshot.value || page.value !== 'launcher' || !query.value.trim() || searchComposing.value) return
    searchLoading.value = true
    searchTimer = setTimeout(() => { searchTimer = undefined; void searchLauncher() }, 150)
  }
  async function searchLauncher(providerId?: string) {
    if (disposed || loading.value || !snapshot.value || page.value !== 'launcher' || !query.value.trim() || searchComposing.value) return
    const previous = providerId ? searchGroups.value.find(group => group.providerId === providerId) : undefined
    if (providerId && (!previous?.hasMore || searchLoading.value)) return
    clearTimeout(searchTimer)
    searchTimer = undefined
    const current = ++searchRevision
    const searchedQuery = query.value
    const offset = previous ? previous.offset + previous.items.length : 0
    searchLoading.value = true
    searchError.value = ''
    try {
      const groups = await window.desktop.searchLauncher({ query: searchedQuery, offset, limit: searchPageSize })
      if (disposed || current !== searchRevision || query.value !== searchedQuery || page.value !== 'launcher') return
      if (!previous) searchGroups.value = groups
      else {
        const next = groups.find(group => group.providerId === providerId)
        if (next) {
          const ids = new Set(previous.items.map(item => item.id))
          searchGroups.value = searchGroups.value.map(group => group.providerId === providerId
            ? { ...next, offset: previous.offset, items: next.status === 'ready' ? [...previous.items, ...next.items.filter(item => !ids.has(item.id))] : next.items }
            : group)
        }
      }
    } catch (cause) {
      if (!disposed && current === searchRevision) searchError.value = cause instanceof Error ? cause.message : String(cause)
    } finally { if (!disposed && current === searchRevision) searchLoading.value = false }
  }
  function setSearchComposing(active: boolean) { searchComposing.value = active }
  async function performSearchAction(providerId: string, item: LauncherSearchItem, action: string) {
    if (disposed || searchActionBusy.value || page.value !== 'launcher') return
    const currentItem = searchGroups.value.find(group => group.providerId === providerId)?.items.find(result => result.id === item.id)
    const availableAction = currentItem?.actions.find(candidate => candidate.id === action)
    if (!currentItem || !availableAction) return
    const current = ++searchActionRevision
    searchActionBusy.value = true
    searchError.value = ''
    searchFeedback.value = ''
    try {
      await window.desktop.performSearchAction(providerId, currentItem.id, action)
      if (!disposed && current === searchActionRevision) searchFeedback.value = `已${availableAction.label}：${currentItem.name}`
    } catch (cause) {
      if (!disposed && current === searchActionRevision) searchError.value = cause instanceof Error ? cause.message : String(cause)
    } finally { if (!disposed && current === searchActionRevision) searchActionBusy.value = false }
  }
  const stopSearchWatch = watch([query, page, loading, searchComposing], scheduleSearch, { flush: 'sync' })

  function message(cause: unknown) {
    error.value = cause instanceof Error ? cause.message : String(cause)
  }
  function navigate(target: typeof page.value) {
    if (target === 'launcher') {
      query.value = ''
    }
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
      if (pluginsChanged) { void refreshCommands(); scheduleSearch() }
    }
    if (event.type === 'navigate') navigate(event.page)
    if (event.type === 'shown') {
      if (page.value === 'launcher') {
        query.value = ''
      }
      focusRequest.value++
    }
    if (event.type === 'close-request') {
      if (page.value === 'launcher') void hide()
      else if (snapshot.value?.settings.escHide) void hide()
      else navigate('launcher')
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
      if (!window.desktop) throw new Error('桌面连接不可用，请在 NextTools 桌面应用中打开。')
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
  async function setLauncherHeight(height: number) {
    if (!window.desktop) return
    try { await window.desktop.setLauncherHeight(height) }
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
  async function hide() {
    let hidden = false
    await perform(async () => { await window.desktop.hide(); hidden = true })
    return hidden
  }
  function dispose() { disposed = true; cancelSearch(); stopSearchWatch(); unsubscribe?.(); unsubscribe = undefined }
  return { snapshot, commands, page, loading, busy, error, query, focusRequest, results, recentCommands, pinnedCommands, searchGroups, searchLoading, searchError, searchFeedback, searchActionBusy, searchComposing, searchLauncher, setSearchComposing, performSearchAction, updateState, updateBusy, updateError, navigate, initialize, run, update, pin, togglePlugin, setHotkeyCapture, setLauncherHeight, refreshUpdateState, checkForUpdates, downloadUpdate, installUpdate, hide, dispose }
})
