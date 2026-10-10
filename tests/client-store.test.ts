import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { createPinia, setActivePinia } from 'pinia'
import { useDesktopStore } from '../src/client/store'
import { defaultSettings } from '../src/shared/validation'
import type { DesktopAPI, DesktopEvent, Snapshot } from '../src/shared/contracts'

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
