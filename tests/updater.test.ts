import { strict as assert } from 'node:assert'
import { EventEmitter } from 'node:events'
import { test } from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import { createUpdateController, updateSupport, type UpdaterPort } from '../src/host/updater'
import type { DesktopEvent } from '../src/shared/contracts'

class ReleaseUpdater extends EventEmitter implements UpdaterPort {
  checks = 0
  downloads = 0
  installs: Array<[boolean, boolean]> = []
  cancelled = false
  failure?: Error
  onInstall?: () => void
  async checkForUpdates() {
    this.checks++
    this.emit('checking-for-update')
    if (this.failure) throw this.failure
    this.emit('update-available', { version: '4.0.2' })
    return { cancellationToken: { cancel: () => { this.cancelled = true } } }
  }
  async downloadUpdate() {
    this.downloads++
    this.emit('download-progress', { percent: 40, transferred: 40, total: 100, bytesPerSecond: 20 })
    this.emit('update-downloaded', { version: '4.0.2' })
    return ['verified-setup.exe']
  }
  quitAndInstall(silent: boolean, relaunch: boolean) {
    this.onInstall?.()
    this.installs.push([silent, relaunch])
  }
}

test('only installed packaged Windows enables online installation', async () => {
  for (const environment of [
    { isPackaged: false, platform: 'win32', installed: true },
    { isPackaged: true, platform: 'darwin', installed: true },
    { isPackaged: true, platform: 'linux', installed: true },
    { isPackaged: true, platform: 'win32', installed: false },
  ]) {
    const ctx = new Context()
    let prepared = false
    const unsupportedReason = updateSupport(environment)
    assert(unsupportedReason)
    const controller = createUpdateController(ctx, { currentVersion: '4.0.1', unsupportedReason, emit() {}, async prepareInstall() { prepared = true } })
    try {
      for (const state of [await controller.check(), await controller.download(), await controller.install()]) {
        assert.equal(state.status, 'unsupported')
        assert.equal(state.supported, false)
        assert.equal(state.message, unsupportedReason)
      }
      assert.equal(prepared, false)
    } finally { await ctx.fiber.dispose() }
  }
  assert.equal(updateSupport({ isPackaged: true, platform: 'win32', installed: true }), undefined)
})

test('check never downloads automatically, progress is observable, install awaits cleanup before relaunch', async () => {
  const ctx = new Context()
  const app = new EventEmitter()
  const updater = new ReleaseUpdater()
  const events: DesktopEvent[] = []
  const order: string[] = []
  const controller = createUpdateController(ctx, {
    currentVersion: '4.0.1', updater, app, emit: event => events.push(event),
    async prepareInstall() {
      order.push('flush')
      await ctx.fiber.dispose()
      assert.equal(app.listenerCount('window-all-closed'), 1)
    },
  })
  updater.onInstall = () => {
    order.push('installer')
    assert.equal(updater.listenerCount('error'), 1)
  }
  try {
    await assert.rejects(controller.download(), /available update/)
    await assert.rejects(controller.install(), /Download an update/)
    assert.equal((await controller.check()).status, 'available')
    assert.equal(updater.downloads, 0)
    assert.equal(updater.installs.length, 0)
    assert.equal((await controller.download()).status, 'downloaded')
    assert.equal(updater.installs.length, 0)
    const progress = events.find(event => event.type === 'update' && event.update.status === 'downloading' && event.update.progress)
    assert(progress && progress.type === 'update')
    assert.deepEqual(progress.update.progress, { percent: 40, transferred: 40, total: 100, bytesPerSecond: 20 })
    assert.equal((await controller.install()).status, 'installing')
    assert.deepEqual(order, ['flush', 'installer'])
    assert.deepEqual(updater.installs, [[true, true]])
    assert.equal(updater.eventNames().length, 0)
    assert.equal(app.listenerCount('window-all-closed'), 0)
    assert.equal(updater.cancelled, true)
  } finally { await ctx.fiber.dispose() }
})

test('network errors are observable and checking can be retried', async () => {
  const ctx = new Context()
  const updater = new ReleaseUpdater()
  const controller = createUpdateController(ctx, { currentVersion: '4.0.1', updater, emit() {}, async prepareInstall() {} })
  try {
    updater.failure = new Error('GitHub unavailable')
    assert.equal((await controller.check()).status, 'error')
    assert.equal(controller.getState().message, 'GitHub unavailable')
    updater.failure = undefined
    assert.equal((await controller.check()).status, 'available')
    assert.equal(updater.checks, 2)
    await ctx.fiber.dispose()
    assert.equal(updater.eventNames().length, 0)
    await assert.rejects(controller.check(), /shutting down/)
  } finally { await ctx.fiber.dispose() }
})

test('storage cleanup failure stops installation and reports an error', async () => {
  const ctx = new Context()
  const updater = new ReleaseUpdater()
  const controller = createUpdateController(ctx, { currentVersion: '4.0.1', updater, emit() {}, async prepareInstall() { throw new Error('Cannot flush storage') } })
  try {
    await controller.check()
    await controller.download()
    assert.equal((await controller.install()).status, 'error')
    assert.equal(controller.getState().message, 'Cannot flush storage')
    assert.equal(updater.installs.length, 0)
  } finally { await ctx.fiber.dispose() }
})

test('native installer errors are reported instead of successful installation', async () => {
  const ctx = new Context()
  const updater = new ReleaseUpdater()
  const controller = createUpdateController(ctx, { currentVersion: '4.0.1', updater, emit() {}, async prepareInstall() {} })
  updater.onInstall = () => { updater.emit('error', new Error('Installer could not start')) }
  try {
    await controller.check()
    await controller.download()
    assert.equal((await controller.install()).status, 'error')
    assert.equal(controller.getState().message, 'Installer could not start')
  } finally { await ctx.fiber.dispose() }
})
