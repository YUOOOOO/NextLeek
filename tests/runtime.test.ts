import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Context } from '@deepseek-ai/cordis'
import { createRuntime } from '../src/host/runtime'
import type { DesktopService } from '../src/host/services/contracts'
import type { DesktopEvent } from '../src/shared/contracts'
import { searchPlugin } from '../src/host/services/search'
import { everythingSearchPlugin } from '../src/host/plugins/builtins'

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
    await runtime.setPluginEnabled('quick-launch', false)
    assert(!runtime.listCommands().some(command => command.id === 'data.open'))
    await assert.rejects(runtime.runCommand('data.open'), /unavailable/)
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
    assert.equal(saved.plugins.find(plugin => plugin.id === 'quick-launch')?.status, 'disabled')
    await runtime.setPluginEnabled('quick-launch', true)
    assert(runtime.listCommands().some(command => command.id === 'data.open'))
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
