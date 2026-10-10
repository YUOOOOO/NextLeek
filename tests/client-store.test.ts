import { strict as assert } from 'node:assert'
import { test, type TestContext } from 'node:test'
import { createPinia, setActivePinia } from 'pinia'
import { useDesktopStore } from '../src/client/store'
import { defaultSettings } from '../src/shared/validation'
import type { DesktopAPI, DesktopEvent, LauncherSearchGroup, LauncherSearchItem, LauncherSearchRequest, Snapshot } from '../src/shared/contracts'

test('search show clears query, plugin show preserves page, and native close exits plugin by default', async () => {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
  let receive: ((event: DesktopEvent) => void) | undefined
  let hideFails = false
  const snapshot: Snapshot = { settings: { ...defaultSettings }, plugins: [], recent: ['settings.open'], pinned: ['settings.open'] }
  const api: Partial<DesktopAPI> = {
    subscribe(callback) { receive = callback; return () => { receive = undefined } },
    async getSnapshot() { return snapshot },
    async listCommands() { return [{ id: 'settings.open', title: '设置', description: '', icon: 'gear', keywords: [] }] },
    async getUpdateState() { return { status: 'unsupported', currentVersion: '4.0.7', supported: false, message: '' } },
    async hide() { if (hideFails) throw new Error('Window hide failed') },
  }
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { desktop: api } })
  setActivePinia(createPinia())
  const store = useDesktopStore()
  try {
    await store.initialize()
    store.query = '设置'
    store.navigate('settings')
    receive!({ type: 'shown' })
    assert.equal(store.page, 'settings')
    assert.equal(store.query, '设置')
    assert.equal(store.focusRequest, 1)
    store.navigate('launcher')
    store.query = '设置'
    receive!({ type: 'shown' })
    assert.equal(store.query, '')
    assert.equal(store.launcherRevealed, false)
    assert.equal(store.focusRequest, 2)
    store.navigate('theme')
    store.query = '设置'
    hideFails = true
    await store.hide()
    assert.equal(store.page, 'theme')
    assert.equal(store.query, '设置')
    hideFails = false
    await store.hide()
    assert.equal(store.page, 'theme')
    assert.equal(store.query, '设置')
    receive!({ type: 'close-request' })
    assert.equal(store.page, 'launcher')
    assert.equal(store.query, '')
    receive!({ type: 'shown' })
    assert.equal(store.page, 'launcher')
    assert.deepEqual(store.homeCommands.map(command => command.id), ['settings.open'])
  } finally {
    store.dispose()
    if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow)
    else Reflect.deleteProperty(globalThis, 'window')
  }
})

function searchGroup(name: string, offset = 0, hasMore = false): LauncherSearchGroup {
  const item: LauncherSearchItem = { id: name, name, path: `C:\\资料\\${name}`, isDirectory: false, size: 42, modifiedAt: null, actions: [{ id: 'open', label: '打开' }, { id: 'reveal', label: '打开所在文件夹' }, { id: 'copy-path', label: '复制路径' }] }
  return { providerId: 'files', title: '本地文件', status: 'ready', items: [item], total: 2, offset, hasMore }
}
async function searchHarness(t: TestContext, overrides: Partial<DesktopAPI> = {}) {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
  const calls: LauncherSearchRequest[] = []
  const pending: Array<{ resolve: (groups: LauncherSearchGroup[]) => void; reject: (cause: Error) => void }> = []
  let receive: ((event: DesktopEvent) => void) | undefined
  const api: Partial<DesktopAPI> = {
    subscribe(callback) { receive = callback; return () => { receive = undefined } },
    async getSnapshot() { return { settings: { ...defaultSettings }, plugins: [], recent: [], pinned: [] } },
    async listCommands() { return [] },
    async getUpdateState() { return { status: 'unsupported', currentVersion: '4.0.7', supported: false, message: '' } },
    searchLauncher(request) { calls.push(request); return new Promise((resolve, reject) => { pending.push({ resolve, reject }) }) },
    ...overrides,
  }
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { desktop: api } })
  setActivePinia(createPinia())
  const store = useDesktopStore()
  t.after(() => {
    store.dispose()
    if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow)
    else Reflect.deleteProperty(globalThis, 'window')
  })
  await store.initialize()
  return { store, calls, pending, receive: (event: DesktopEvent) => receive?.(event) }
}
async function settle() { await Promise.resolve(); await Promise.resolve() }

test('launcher search debounces exact queries and excludes empty, composing, and disposed requests', async t => {
  const { store, calls, pending } = await searchHarness(t)
  t.mock.timers.tick(500)
  assert.equal(calls.length, 0)
  store.query = '  '
  t.mock.timers.tick(500)
  assert.equal(calls.length, 0)
  store.query = 'first'
  t.mock.timers.tick(100)
  store.query = 'ext:txt "报告 2026"'
  t.mock.timers.tick(149)
  assert.equal(calls.length, 0)
  t.mock.timers.tick(1)
  assert.deepEqual(calls, [{ query: 'ext:txt "报告 2026"', offset: 0, limit: 30 }])
  store.setSearchComposing(true)
  store.query = '中文'
  pending[0]!.resolve([searchGroup('stale')])
  await settle()
  t.mock.timers.tick(500)
  assert.equal(calls.length, 1)
  assert.deepEqual(store.searchGroups, [])
  store.setSearchComposing(false)
  t.mock.timers.tick(150)
  assert.equal(calls[1]!.query, '中文')
  store.query = ''
  pending[1]!.resolve([searchGroup('cleared')])
  await settle()
  assert.deepEqual(store.searchGroups, [])
  store.query = 'disposed'
  store.dispose()
  t.mock.timers.tick(500)
  assert.equal(calls.length, 2)
})

test('launcher search ignores superseded replies and resets on show and navigation', async t => {
  const { store, pending, receive } = await searchHarness(t)
  store.query = 'first'
  t.mock.timers.tick(150)
  store.query = 'second'
  t.mock.timers.tick(150)
  pending[1]!.resolve([searchGroup('current')])
  await settle()
  pending[0]!.reject(new Error('obsolete failure'))
  await settle()
  assert.equal(store.searchGroups[0]!.items[0]!.name, 'current')
  assert.equal(store.searchError, '')
  receive({ type: 'shown' })
  assert.equal(store.query, '')
  assert.deepEqual(store.searchGroups, [])
  store.query = 'third'
  t.mock.timers.tick(150)
  store.navigate('settings')
  pending[2]!.resolve([searchGroup('inactive')])
  await settle()
  assert.deepEqual(store.searchGroups, [])
  assert.equal(store.searchLoading, false)
})

test('generic provider statuses, pagination, host-authorized result actions and feedback remain scoped to current query', async t => {
  const actions: string[][] = []
  let completeAction: (() => void) | undefined
  const { store, calls, pending } = await searchHarness(t, {
    performSearchAction(providerId, itemId, action) { actions.push([providerId, itemId, action]); return new Promise(resolve => { completeAction = resolve }) },
  })
  store.query = 'report'
  t.mock.timers.tick(150)
  pending[0]!.resolve([{ providerId: 'offline', title: '其他搜索', status: 'unavailable', message: '提供者尚未就绪', items: [], total: 0, offset: 0, hasMore: false }, searchGroup('one', 0, true)])
  await settle()
  assert.equal(store.searchGroups[0]!.message, '提供者尚未就绪')
  const more = store.searchLauncher('files')
  assert.deepEqual(calls[1], { query: 'report', offset: 1, limit: 30 })
  pending[1]!.resolve([searchGroup('two', 1)])
  await more
  assert.deepEqual(store.searchGroups[1]!.items.map(item => item.id), ['one', 'two'])
  assert.equal(store.searchGroups[0]!.status, 'unavailable')
  const item = store.searchGroups[1]!.items[0]!
  await store.performSearchAction('files', item, 'delete')
  assert.deepEqual(actions, [])
  for (const action of ['open', 'reveal', 'copy-path']) {
    const work = store.performSearchAction('files', item, action)
    completeAction!()
    await work
    assert.equal(actions.at(-1)![2], action)
    assert.match(store.searchFeedback, /one/)
  }
  const staleAction = store.performSearchAction('files', item, 'open')
  store.query = ''
  completeAction!()
  await staleAction
  assert.equal(store.searchFeedback, '')
  assert.equal(store.searchActionBusy, false)
})
