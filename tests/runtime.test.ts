import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Context } from '@deepseek-ai/cordis'
import { createRuntime } from '../src/host/runtime'
import type { DesktopService } from '../src/host/services/contracts'
import type { DesktopEvent } from '../src/shared/contracts'
import { searchPlugin } from '../src/host/services/search'
import { everythingSearchPlugin } from '../src/host/plugins/builtins'
import { storagePlugin } from '../src/host/services/storage'

function desktop(events: DesktopEvent[]): DesktopService {
  return { emit: event => events.push(event), applySettings: async () => {}, hide() {}, quit() {}, openDataDirectory: async () => {} }
}

test('LMDB settings, command history, pins and plugin state survive runtime disposal', async () => {
  const path = await mkdtemp(join(tmpdir(), 'nextleek-runtime-'))
  const events: DesktopEvent[] = []
  let runtime = await createRuntime(join(path, 'lmdb'), desktop(events))
  try {
    assert(runtime.getSnapshot().plugins.every(plugin => plugin.status === 'active'))
    assert.deepEqual(await runtime.runCommand('settings.open'), { navigate: 'settings' })
    await runtime.runCommand('theme.open')
    await runtime.runCommand('settings.open')
    assert.deepEqual(runtime.getSnapshot().recent, ['settings.open', 'theme.open'])
    await runtime.setPinned('settings.open', true)
    await runtime.setPinned('settings.open', true)
    assert.deepEqual(runtime.getSnapshot().pinned, ['settings.open'])
    await runtime.updateSettings({ theme: 'dark', accent: 'green', compact: true })
    await runtime.setPluginEnabled('builtin-search', false)
    assert(!runtime.getSnapshot().plugins.some(plugin => plugin.id === 'quick-launch'))
    await assert.rejects(runtime.runCommand('launcher.open'), /unavailable/)
    await assert.rejects(runtime.setPluginEnabled('settings', false), /Core plugins/)
    await assert.rejects(runtime.setPinned('missing.command', true), /unavailable/)
    await runtime.dispose()
    runtime = await createRuntime(join(path, 'lmdb'), desktop(events))
    const saved = runtime.getSnapshot()
    assert.equal(saved.settings.theme, 'dark')
    assert.equal(saved.settings.accent, 'green')
    assert.equal(saved.settings.compact, true)
    assert.deepEqual(saved.pinned, ['settings.open'])
    assert.deepEqual(saved.recent, ['settings.open', 'theme.open'])
    assert.equal(saved.plugins.find(plugin => plugin.id === 'builtin-search')?.status, 'disabled')
    await runtime.setPluginEnabled('builtin-search', true)
    assert.equal(runtime.getSnapshot().plugins.find(plugin => plugin.id === 'builtin-search')?.status, 'active')
    assert(events.some(event => event.type === 'navigate' && event.page === 'settings'))
  } finally { await runtime.dispose(); await rm(path, { recursive: true, force: true }) }
})

test('failed desktop settings application does not persist requested preferences', async () => {
  const path = await mkdtemp(join(tmpdir(), 'nextleek-settings-'))
  const service = desktop([])
  service.applySettings = async settings => { if (settings.hotkey === 'Alt+K') throw new Error('Shortcut occupied') }
  const runtime = await createRuntime(join(path, 'lmdb'), service)
  try {
    await assert.rejects(runtime.updateSettings({ hotkey: 'Alt+K', compact: true }), /occupied/)
    assert.equal(runtime.getSnapshot().settings.hotkey, 'Alt+Z')
    assert.equal(runtime.getSnapshot().settings.compact, false)
    await Promise.all([runtime.updateSettings({ compact: true }), runtime.updateSettings({ accent: 'rose' })])
    assert.equal(runtime.getSnapshot().settings.compact, true)
    assert.equal(runtime.getSnapshot().settings.accent, 'rose')
  } finally { await runtime.dispose(); await rm(path, { recursive: true, force: true }) }
})

test('Cordis inject waits for provider and command effects roll back on plugin disposal', async () => {
  const ctx = new Context()
  let active = false
  let disposed = false
  const consumer = ctx.plugin({ name: 'consumer', inject: ['testService'], apply(scope) {
    scope.effect(() => { active = true; return () => { active = false; disposed = true } })
  } })
  await consumer.await()
  assert.equal(consumer.state, 0)
  const provider = ctx.plugin({ name: 'provider', apply(scope) { scope.provide('testService', {}) } })
  await provider.await(); await consumer.await()
  assert.equal(active, true)
  await provider.dispose(); await consumer.await()
  assert.equal(active, false)
  assert.equal(disposed, true)
  await consumer.dispose(); await ctx.fiber.dispose()
})

test('main search contributions dispatch host-authorized result actions and disappear when the consumer is disabled', async () => {
  const ctx = new Context()
  const calls: string[][] = []
  const registry = ctx.plugin(searchPlugin)
  await registry.await()
  const backend = ctx.plugin({ name: 'fake-everything', apply(scope: Context) {
    scope.provide('everything', {
      getStatus: async () => ({ status: 'ready' as const, message: 'ready' }),
      search: async () => ({ items: [{ id: 'capability-result', name: 'note.txt', path: 'C:\\note.txt', isDirectory: false, size: 10, modifiedAt: null }], total: 2, offset: 0, hasMore: true }),
      performAction: async (id: string, action: string) => { calls.push([id, action]) },
    })
  } })
  await backend.await()
  const consumer = ctx.plugin(everythingSearchPlugin)
  await consumer.await()
  try {
    const groups = await ctx.search.search({ query: 'note', offset: 0, limit: 1 })
    assert.equal(groups[0]?.providerId, 'everything')
    assert.equal(groups[0]?.total, 2)
    assert.equal(groups[0]?.hasMore, true)
    assert.deepEqual(groups[0]?.items[0]?.actions.map(action => action.id), ['open', 'reveal', 'copy-path'])
    await ctx.search.performAction('everything', 'capability-result', 'copy-path')
    assert.deepEqual(calls, [['capability-result', 'copy-path']])
    await consumer.dispose()
    assert.deepEqual(await ctx.search.search({ query: 'note', offset: 0, limit: 1 }), [])
    await assert.rejects(ctx.search.performAction('everything', 'capability-result', 'open'), /provider unavailable/)
  } finally { await ctx.fiber.dispose() }
})

test('one builtin search toggle disposes both contributors, releases Everything, and restores fresh authorization', async () => {
  const path = await mkdtemp(join(tmpdir(), 'nextleek-search-'))
  const addonPath = join(path, 'everything.cjs')
  const applicationsDirectory = join(path, 'Applications')
  const windows = process.platform === 'win32'
  const applicationPath = join(applicationsDirectory, windows ? 'Fixture.lnk' : 'Fixture.app')
  await mkdir(applicationsDirectory)
  if (windows) await writeFile(applicationPath, '')
  else await mkdir(applicationPath)
  await writeFile(addonPath, `module.exports = {
    everythingIsRuning: () => true,
    everythingIsDBLoaded: () => true,
    getEverythingVersion: () => 'fixture',
    everythingSearch: () => ({ list: [{ filename: 'Fixture.txt', path: 'C:\\\\Fixture', isFolder: false }], total: 1 }),
  }`)
  const opened: string[] = []
  const runtime = await createRuntime(join(path, 'lmdb'), desktop([]), {
    addonPath, executable: join(path, 'unused-engine'), platform: 'win32',
    openPath: async () => '', revealPath() {}, copyPath() {},
  }, {
    platform: windows ? 'win32' : 'darwin', directories: [applicationsDirectory],
    preferredLanguages: [], getFileIcon: async () => 'data:image/png;base64,AA==',
    openPath: async value => { opened.push(value); return '' },
  })
  const request = { query: 'Fixture', offset: 0, limit: 10 }
  try {
    assert.deepEqual(runtime.getSnapshot().plugins.filter(plugin => !plugin.protected).map(plugin => ({ id: plugin.id, name: plugin.name })), [{ id: 'builtin-search', name: '搜索' }])
    assert(!runtime.getSnapshot().plugins.some(plugin => ['everything-provider', 'everything', 'applications'].includes(plugin.id)))
    assert.equal(runtime.getSnapshot().plugins.find(plugin => plugin.id === 'search')?.protected, true)
    const service = runtime.ctx.get('everything')!
    const groups = await runtime.searchLauncher(request)
    assert.deepEqual(groups.map(group => group.providerId).sort(), ['applications', 'everything'])
    assert(groups.every(group => group.status === 'ready' && group.items.length === 1))
    const applicationId = groups.find(group => group.providerId === 'applications')!.items[0].id
    const fileId = groups.find(group => group.providerId === 'everything')!.items[0].id
    await runtime.performSearchAction('applications', applicationId, 'open')
    assert.deepEqual(opened, [applicationPath])
    await runtime.setPluginEnabled('builtin-search', false)
    assert.equal(runtime.getSnapshot().plugins.find(plugin => plugin.id === 'builtin-search')?.status, 'disabled')
    assert.equal(runtime.ctx.get('everything'), undefined)
    assert.deepEqual(await runtime.searchLauncher(request), [])
    await assert.rejects(service.search(request), /服务已关闭/)
    await assert.rejects(service.performAction(fileId, 'open'), /服务已关闭/)
    await assert.rejects(runtime.performSearchAction('applications', applicationId, 'open'), /provider unavailable/)
    await runtime.setPluginEnabled('builtin-search', true)
    assert.equal(runtime.getSnapshot().plugins.find(plugin => plugin.id === 'builtin-search')?.status, 'active')
    assert.notEqual(runtime.ctx.get('everything'), service)
    const restored = await runtime.searchLauncher(request)
    assert.deepEqual(restored.map(group => group.providerId).sort(), ['applications', 'everything'])
    assert(restored.every(group => group.status === 'ready' && group.items.length === 1))
    await assert.rejects(runtime.performSearchAction('applications', applicationId, 'open'), /结果已失效/)
    await assert.rejects(runtime.performSearchAction('everything', fileId, 'open'), /结果已失效/)
    await runtime.performSearchAction('applications', restored.find(group => group.providerId === 'applications')!.items[0].id, 'open')
    assert.deepEqual(opened, [applicationPath, applicationPath])
  } finally { await runtime.dispose(); await rm(path, { recursive: true, force: true }) }
})

test('legacy search toggles migrate conservatively once and obsolete plugin IDs are rejected', async () => {
  const cases: Array<{ enabled: Record<string, boolean>; expected: boolean }> = [
    { enabled: {}, expected: true },
    { enabled: { everything: false }, expected: true },
    { enabled: { applications: false }, expected: true },
    { enabled: { everything: false, applications: false, 'everything-provider': true }, expected: false },
    { enabled: { everything: false, applications: true }, expected: true },
    { enabled: { everything: true, applications: false }, expected: true },
    { enabled: { 'builtin-search': false, everything: true, applications: true }, expected: false },
    { enabled: { 'builtin-search': true, everything: false, applications: false }, expected: true },
  ]
  for (const { enabled, expected } of cases) {
    const path = await mkdtemp(join(tmpdir(), 'nextleek-search-migration-'))
    const databasePath = join(path, 'lmdb')
    const seed = new Context()
    await seed.plugin(storagePlugin(databasePath)).await()
    const state = seed.storage.read()
    seed.storage.write({ ...state, enabled: { ...enabled, 'other-plugin': false } })
    await seed.fiber.dispose()
    let runtime = await createRuntime(databasePath, desktop([]))
    try {
      assert.deepEqual(runtime.ctx.storage.read().enabled, { 'builtin-search': expected, 'other-plugin': false })
      assert.equal(runtime.getSnapshot().plugins.find(plugin => plugin.id === 'builtin-search')?.status, expected ? 'active' : 'disabled')
      for (const id of ['everything-provider', 'everything', 'applications']) {
        await assert.rejects(runtime.setPluginEnabled(id, true), /Unknown plugin/)
      }
      await runtime.setPluginEnabled('builtin-search', !expected)
      await runtime.dispose()
      runtime = await createRuntime(databasePath, desktop([]))
      assert.deepEqual(runtime.ctx.storage.read().enabled, { 'builtin-search': !expected, 'other-plugin': false })
      assert.equal(runtime.getSnapshot().plugins.find(plugin => plugin.id === 'builtin-search')?.enabled, !expected)
    } finally { await runtime.dispose(); await rm(path, { recursive: true, force: true }) }
  }
})

test('search composition keeps unsupported and unavailable providers honest without starting an engine', async () => {
  const path = await mkdtemp(join(tmpdir(), 'nextleek-search-status-'))
  const runtime = await createRuntime(join(path, 'lmdb'), desktop([]), {
    addonPath: join(path, 'missing-addon.node'), executable: join(path, 'missing-engine'), platform: 'win32',
    openPath: async () => '', revealPath() {}, copyPath() {},
  }, {
    platform: 'freebsd', getFileIcon: async () => { throw new Error('Must not extract icons') },
    openPath: async () => { throw new Error('Must not launch applications') },
  })
  try {
    assert.equal(runtime.getSnapshot().plugins.find(plugin => plugin.id === 'builtin-search')?.status, 'active')
    const groups = await runtime.searchLauncher({ query: 'Fixture', offset: 0, limit: 10 })
    const everything = groups.find(group => group.providerId === 'everything')!
    assert.equal(everything.status, 'unavailable')
    assert.match(everything.message!, /无法加载/)
    assert.deepEqual(everything.items, [])
    assert.equal(groups.find(group => group.providerId === 'applications')?.status, 'unsupported')
  } finally { await runtime.dispose(); await rm(path, { recursive: true, force: true }) }
})

test('search provider IDs are unique and stale in-flight contributions do not leak after disposal', async () => {
  const ctx = new Context()
  await ctx.plugin(searchPlugin).await()
  let resolve!: (value: { status: 'ready'; items: []; total: number }) => void
  const result = new Promise<{ status: 'ready'; items: []; total: number }>(done => { resolve = done })
  const owner = ctx.plugin({ name: 'search-owner', inject: ['search'], apply(scope: Context) {
    scope.search.register(scope, { id: 'sample', title: 'Sample', search: () => result, performAction: async () => {} })
  } })
  await owner.await()
  try {
    assert.throws(() => ctx.search.register(ctx, { id: 'sample', title: 'Duplicate', search: () => result, performAction: async () => {} }), /Duplicate search provider/)
    const searching = ctx.search.search({ query: 'test', offset: 0, limit: 30 })
    await owner.dispose()
    resolve({ status: 'ready', items: [], total: 0 })
    assert.deepEqual(await searching, [])
  } finally { await ctx.fiber.dispose() }
})
