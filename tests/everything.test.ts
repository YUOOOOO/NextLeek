import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import { createEverythingService, type EverythingEnvironment, type EverythingPorts, type NativeEverythingAddon, type NativeEverythingResult } from '../src/host/services/everything'
import type { LauncherSearchRequest } from '../src/shared/contracts'

const request: LauncherSearchRequest = { query: 'ext:txt', offset: 0, limit: 2 }
function row(filename = '报告.txt', isFolder = false) {
  return { filename, path: 'C:\\资料', isFolder, size: 123, dateModified: '2026-10-10 12:34:56', ext: 'txt', hfilename: filename }
}
function harness() {
  const ctx = new Context()
  const calls: Array<[string, number, number, number]> = []
  const starts: string[] = []
  const loads: string[] = []
  const actions: Array<[string, string]> = []
  let output: NativeEverythingResult = { list: [], total: 0 }
  let running = true, ready = true, missing = false, now = 0, openError = ''
  let afterSleep: (() => void) | undefined
  let loadError: Error | undefined, startError: Error | undefined
  const addon: NativeEverythingAddon = {
    everythingIsRuning: () => running, everythingIsDBLoaded: () => ready,
    getEverythingVersion: () => '1.4.1',
    everythingSearch(query, sort, limit, offset) { calls.push([query, sort, limit, offset]); return output },
  }
  const environment: EverythingEnvironment = {
    addonPath: 'C:\\NextLeek\\everything\\addon-x64.node', executable: 'C:\\NextLeek\\everything\\Everything.exe', platform: 'win32',
    async openPath(path) { actions.push(['open', path]); return openError },
    revealPath(path) { actions.push(['reveal', path]) }, copyPath(path) { actions.push(['copy-path', path]) },
  }
  const ports: EverythingPorts = {
    loadAddon(path) { loads.push(path); if (loadError) throw loadError; return addon },
    startEngine(path, failed) { starts.push(path); if (startError) failed(startError) },
    async stat() { if (missing) throw Object.assign(new Error('gone'), { code: 'ENOENT' }); return { isDirectory: () => false } },
    async sleep(milliseconds) { now += milliseconds; afterSleep?.() }, now: () => now,
  }
  return {
    ctx, calls, starts, loads, actions, addon, environment, ports, service: createEverythingService(ctx, environment, ports),
    output(value: NativeEverythingResult) { output = value }, running(value: boolean) { running = value }, ready(value: boolean) { ready = value },
    missing(value: boolean) { missing = value }, openError(value: string) { openError = value },
    loadError(value: Error) { loadError = value }, startError(value: Error) { startError = value },
    afterSleep(value: () => void) { afterSleep = value }, elapsed: () => now,
  }
}

test('native search passes raw Unicode, quoted and switch-like queries with exact sort/limit/offset positions', async () => {
  const h = harness()
  try {
    for (const query of ['ext:txt "中文, 文件" | folder:', 'C:\\资料\\', '"C:\\Program Files\\"', '-exit', 'report']) {
      await h.service.search({ query, offset: 15, limit: 30 })
      assert.deepEqual(h.calls.at(-1), [query, 1, 30, 15])
    }
    assert.deepEqual(h.loads, [h.environment.addonPath]); assert.deepEqual(h.starts, [])
  } finally { await h.ctx.fiber.dispose() }
})

test('native metadata maps full paths, folders, display dates and total-based pagination', async () => {
  const h = harness()
  try {
    h.output({ list: [row(), row('子目录', true)], total: 42 })
    const result = await h.service.search(request)
    assert.equal(result.total, 42); assert.equal(result.hasMore, true)
    assert.equal(result.items[0].path, 'C:\\资料\\报告.txt'); assert.equal(result.items[0].name, '报告.txt')
    assert.equal(result.items[0].size, 123); assert.equal(result.items[0].modifiedAt, '2026-10-10 12:34:56')
    assert.equal(result.items[1].isDirectory, true); assert.equal(result.items[1].size, null)
    assert.match(result.items[0].id, /^[a-f0-9-]{36}$/); assert.notEqual(result.items[0].id, result.items[1].id)
    h.output({ list: [{ ...row(), size: -1, dateModified: '' }], total: 1 })
    const nullable = await h.service.search(request)
    assert.equal(nullable.items[0].size, null); assert.equal(nullable.items[0].modifiedAt, null); assert.equal(nullable.hasMore, false)
    h.output({ list: [{ ...row('C:', true), path: '' }], total: 1 })
    assert.equal((await h.service.search(request)).items[0].path, 'C:\\')
  } finally { await h.ctx.fiber.dispose() }
})

test('absent engine starts once and awaits database readiness before queries', async () => {
  const h = harness()
  try {
    h.running(false); h.ready(false); h.afterSleep(() => { h.running(true); h.ready(true) })
    const results = await Promise.all([h.service.search(request), h.service.getStatus()])
    assert.deepEqual(h.starts, [h.environment.executable]); assert.equal(h.elapsed(), 200)
    assert.equal(results[1].status, 'ready'); assert.equal(results[1].version, '1.4.1')
    await h.service.search(request); assert.equal(h.starts.length, 1)
  } finally { await h.ctx.fiber.dispose() }
})

test('running engine is not ready until database loads and wait has a bounded timeout', async () => {
  const h = harness()
  try {
    h.ready(false)
    const status = await h.service.getStatus()
    assert.equal(status.status, 'unavailable'); assert.match(status.message, /索引尚未就绪.*超时/)
    assert.equal(h.elapsed(), 8000); assert.deepEqual(h.starts, []); assert.deepEqual(h.calls, [])
    h.ready(true); assert.equal((await h.service.getStatus()).status, 'ready')
  } finally { await h.ctx.fiber.dispose() }
})

test('missing addon, bad exports, relative paths, launch errors and unsupported hosts report real errors', async () => {
  const h = harness()
  try {
    h.loadError(new Error('missing addon')); assert.match((await h.service.getStatus()).message, /原生模块.*重新安装/)
    for (const environment of [undefined, { ...h.environment, platform: 'darwin' as const }]) {
      const service = createEverythingService(h.ctx, environment, h.ports)
      assert.equal((await service.getStatus()).status, 'unsupported'); await assert.rejects(service.search(request), /仅支持 Windows/)
    }
    const bad = createEverythingService(h.ctx, h.environment, { ...h.ports, loadAddon: () => ({}) as NativeEverythingAddon })
    await assert.rejects(bad.search(request), /缺少原生接口/)
    const relative = createEverythingService(h.ctx, { ...h.environment, addonPath: './addon-x64.node' }, h.ports)
    await assert.rejects(relative.search(request), /绝对路径/)
    const startup = harness()
    try {
      startup.running(false); startup.startError(new Error('engine missing'))
      await assert.rejects(startup.service.search(request), /无法启动.*engine missing/)
    } finally { await startup.ctx.fiber.dispose() }
  } finally { await h.ctx.fiber.dispose() }
})

test('native query errors and malformed metadata never become fabricated results', async () => {
  const h = harness()
  try {
    h.output({ error: 'IPC failed', list: [], total: 0 }); await assert.rejects(h.service.search(request), /IPC failed/)
    const invalid = [
      { list: {}, total: 0 }, { list: [], total: -1 }, { list: [], total: 0.5 }, { list: [row(), row(), row()], total: 3 },
      { list: [{ ...row(), path: 'relative' }], total: 1 }, { list: [{ ...row(), filename: '..' }], total: 1 },
      { list: [{ ...row(), filename: 'evil\\path' }], total: 1 }, { list: [{ ...row(), isFolder: 1 }], total: 1 },
      { list: [{ ...row(), size: Number.NaN }], total: 1 }, { list: [{ ...row(), dateModified: 123 }], total: 1 },
    ]
    for (const result of invalid) { h.output(result as NativeEverythingResult); await assert.rejects(h.service.search(request)) }
  } finally { await h.ctx.fiber.dispose() }
})

test('actions accept host-authorized result IDs only, recheck existence, and await reveal errors', async () => {
  const h = harness()
  try {
    h.output({ list: [row()], total: 1 }); const item = (await h.service.search(request)).items[0]
    await assert.rejects(h.service.performAction(item.path, 'open'), /result ID/)
    await assert.rejects(h.service.performAction('unknown', 'copy-path'), /失效/)
    await assert.rejects(h.service.performAction(item.id, 'delete' as never), /action/)
    for (const action of ['open', 'reveal', 'copy-path'] as const) await h.service.performAction(item.id, action)
    assert.deepEqual(h.actions, [['open', item.path], ['reveal', item.path], ['copy-path', item.path]])
    h.environment.revealPath = async () => { await Promise.resolve(); throw new Error('SHOpenFolderAndSelectItems failed (0x80004005)') }
    await assert.rejects(h.service.performAction(item.id, 'reveal'), /SHOpenFolderAndSelectItems/)
    h.openError('No associated application'); await assert.rejects(h.service.performAction(item.id, 'open'), /No associated application/)
    h.missing(true); await assert.rejects(h.service.performAction(item.id, 'copy-path'), /已不存在/)
    h.missing(false); await assert.rejects(h.service.performAction(item.id, 'open'), /失效/)
  } finally { await h.ctx.fiber.dispose() }
})

test('Cordis disposal cancels readiness and revokes IDs without terminating an engine', async () => {
  const h = harness()
  h.output({ list: [row()], total: 1 }); const item = (await h.service.search(request)).items[0]
  h.ready(false); h.ports.sleep = () => new Promise(() => {})
  const rejected = assert.rejects(h.service.search(request), /已关闭/)
  await h.ctx.fiber.dispose(); await rejected
  assert.deepEqual(h.starts, []); await assert.rejects(h.service.performAction(item.id, 'open'), /已关闭/)
})

test('old IDs expire at the authorization cache bound', async () => {
  const h = harness()
  try {
    h.output({ list: [row()], total: 1 }); const oldest = (await h.service.search(request)).items[0].id
    h.output({ list: Array.from({ length: 100 }, (_, index) => row(`${index}.txt`)), total: 100 })
    for (let page = 0; page < 10; page++) await h.service.search({ ...request, limit: 100 })
    await assert.rejects(h.service.performAction(oldest, 'open'), /失效/)
  } finally { await h.ctx.fiber.dispose() }
})
