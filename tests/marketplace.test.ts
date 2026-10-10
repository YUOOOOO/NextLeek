import { strict as assert } from 'node:assert'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import { strToU8, zipSync } from 'fflate'
import { commandsPlugin } from '../src/host/services/commands'
import { marketPlugin } from '../plugins/plugin-market/host'
import { CATALOG_URL, parseCatalog, renderPackage, verifyPackage } from '../plugins/plugin-market/package'
import type { InstalledPlugin, MarketEntry, OpenPlugin } from '../plugins/plugin-market/shared'

const id = 'com.nextleek.dashboard'
function fixture(version = '1.0.0', extra: Record<string, Uint8Array> = {}, override: Record<string, unknown> = {}) {
  const manifest = { id, name: 'Dashboard', version, description: 'Static dashboard', author: 'NextLeek', minCreatorVersion: '0.1.0', permissions: [], capabilities: [], entry: 'ui/index.html', ...override }
  const bytes = zipSync({
    'manifest.json': strToU8(JSON.stringify(manifest)),
    'ui/index.html': strToU8('<!doctype html><html><head><link rel="stylesheet" href="style.css"></head><body><img src="assets/logo.png"><script src="main.js"></script></body></html>'),
    'ui/style.css': strToU8('body { background-image: url("assets/logo.png"); }'),
    'ui/main.js': strToU8('window.nextleek.runtimeSummary().then(summary => { document.body.dataset.version = summary.version })'),
    'ui/assets/logo.png': new Uint8Array([137, 80, 78, 71]),
    ...extra,
  })
  const entry: MarketEntry = { id, name: 'Dashboard', version, description: 'Static dashboard', author: 'NextLeek', minCreatorVersion: '0.1.0', permissions: [], packageUrl: `https://raw.githubusercontent.com/YUOOOOO/NextLeek-Plugins/main/packages/${id}-${version}.nlplugin`, sha256: createHash('sha256').update(bytes).digest('hex') }
  return { bytes, entry }
}
function index(entries: MarketEntry[]) { return JSON.stringify({ schemaVersion: 1, plugins: entries }) }
async function harness(directory: string, fetch: typeof globalThis.fetch) {
  const ctx = new Context()
  const handlers = new Map<string, (method: string, args: unknown) => unknown>()
  const provider = ctx.plugin({ name: 'market-test-endpoints', apply(scope: Context) {
    scope.provide('pluginEndpoints', {
      register(owner: Context, pluginId: string, handler: (method: string, args: unknown) => unknown) { owner.effect(() => { handlers.set(pluginId, handler); return () => { handlers.delete(pluginId) } }) },
      async invoke(pluginId: string, method: string, args: unknown) { const handler = handlers.get(pluginId); if (!handler) throw new Error('Endpoint unavailable'); return handler(method, args) },
    })
  } })
  await provider.await()
  const commands = ctx.plugin(commandsPlugin); await commands.await()
  const market = ctx.plugin(marketPlugin({ directory, version: '4.0.14', fetch })); await market.await()
  return { ctx, market, invoke: (method: string, args: unknown = null) => ctx.pluginEndpoints.invoke('plugin-market', method, args), dispose: () => ctx.fiber.dispose() }
}
function server(get: () => ReturnType<typeof fixture>): typeof globalThis.fetch {
  return async input => {
    const value = get()
    if (String(input) === CATALOG_URL) return new Response(index([value.entry]))
    if (String(input) === value.entry.packageUrl) return new Response(new Uint8Array(value.bytes))
    return new Response('Not found', { status: 404 })
  }
}

test('static package installs, opens bundled assets, toggles, survives restart, upgrades and uninstalls', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'nextleek-market-'))
  let value = fixture(); let runtime = await harness(directory, server(() => value))
  try {
    assert.deepEqual(await runtime.ctx.commands.run('plugin-market.open'), { navigate: 'plugin-market' })
    assert.equal((await runtime.invoke('catalog') as MarketEntry[])[0]!.id, id)
    assert.equal((await runtime.invoke('install', { id }) as InstalledPlugin).version, '1.0.0')
    const opened = await runtime.invoke('open', { id }) as OpenPlugin
    assert.match(opened.html, /Content-Security-Policy/)
    assert.match(opened.html, /connect-src 'none'/)
    assert.match(opened.html, /data:image\/png;base64/)
    assert.match(opened.html, /document.body.dataset.version/)
    assert(opened.html.indexOf('nextleek:runtime-request') < opened.html.indexOf('document.body.dataset.version'))
    assert.doesNotMatch(opened.html, /src="main.js"|href="style.css"/)
    const summary = await runtime.invoke('runtimeSummary') as { version: string; platform: string; mode: string; status: string; installed: number; enabled: number }
    assert.equal(summary.version, '4.0.14'); assert.equal(summary.platform, process.platform); assert.equal(summary.mode, 'desktop')
    assert.equal(summary.status, 'ready'); assert.equal(summary.installed, 1); assert.equal(summary.enabled, 1)
    await runtime.invoke('setEnabled', { id, enabled: false })
    await assert.rejects(runtime.invoke('open', { id }), /disabled/)
    await runtime.dispose(); runtime = await harness(directory, server(() => value))
    assert.equal((await runtime.invoke('installed') as InstalledPlugin[])[0]!.enabled, false)
    value = fixture('2.0.0')
    const upgraded = await runtime.invoke('install', { id }) as InstalledPlugin
    assert.equal(upgraded.version, '2.0.0'); assert.equal(upgraded.enabled, false)
    assert.equal((await readdir(directory)).filter(name => name.endsWith('.nlplugin')).length, 1)
    await runtime.invoke('setEnabled', { id, enabled: true })
    assert.equal((await runtime.invoke('open', { id }) as OpenPlugin).id, id)
    await runtime.invoke('uninstall', { id }); assert.deepEqual(await runtime.invoke('installed'), [])
    await assert.rejects(runtime.invoke('open', { id }), /not installed/)
    assert.equal((await readdir(directory)).filter(name => name.endsWith('.nlplugin')).length, 0)
  } finally { await runtime.dispose(); await rm(directory, { recursive: true, force: true }) }
})

test('failed hash and manifest upgrades leave the previous verified installation runnable', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'nextleek-market-'))
  let value = fixture(); const runtime = await harness(directory, server(() => value))
  try {
    await runtime.invoke('install', { id }); const saved = await readFile(join(directory, 'market-state.json'), 'utf8')
    value = fixture('2.0.0'); value.entry.sha256 = '0'.repeat(64)
    await assert.rejects(runtime.invoke('install', { id }), /SHA-256/)
    value = fixture('2.0.0', {}, { version: '9.0.0' })
    await assert.rejects(runtime.invoke('install', { id }), /manifest version/)
    assert.equal(await readFile(join(directory, 'market-state.json'), 'utf8'), saved)
    assert.equal((await runtime.invoke('installed') as InstalledPlugin[])[0]!.version, '1.0.0')
    assert.equal((await runtime.invoke('open', { id }) as OpenPlugin).id, id)
    assert.equal((await readdir(directory)).filter(name => name.startsWith('market-tmp-')).length, 0)
  } finally { await runtime.dispose(); await rm(directory, { recursive: true, force: true }) }
})

test('persistent packages are reverified before opening, not trusted by filename', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'nextleek-market-'))
  const value = fixture(); const runtime = await harness(directory, server(() => value))
  try {
    await runtime.invoke('install', { id })
    const saved = JSON.parse(await readFile(join(directory, 'market-state.json'), 'utf8'))
    await writeFile(join(directory, saved.plugins[0].file), 'tampered')
    await assert.rejects(runtime.invoke('open', { id }), /SHA-256/)
  } finally { await runtime.dispose(); await rm(directory, { recursive: true, force: true }) }
})

test('catalog rejects duplicate ids, unsupported permissions and unpinned or credentialed URLs', () => {
  const value = fixture()
  assert.throws(() => parseCatalog(strToU8(index([value.entry, value.entry]))), /Duplicate/)
  for (const packageUrl of ['http://raw.githubusercontent.com/YUOOOOO/NextLeek-Plugins/main/packages/plugin.nlplugin', 'https://raw.githubusercontent.com/attacker/repo/main/packages/plugin.nlplugin', 'https://user@raw.githubusercontent.com/YUOOOOO/NextLeek-Plugins/main/packages/plugin.nlplugin', 'https://raw.githubusercontent.com/YUOOOOO/NextLeek-Plugins/main/packages/%2e%2e/plugin.nlplugin']) {
    assert.throws(() => parseCatalog(strToU8(index([{ ...value.entry, packageUrl }]))), /pinned/)
  }
  assert.throws(() => parseCatalog(strToU8(index([{ ...value.entry, permissions: ['filesystem'] }]))), /Unsupported plugin permissions/)
})

test('verification rejects traversal, symlinks, expansion bombs, Node entries and unsupported manifests', () => {
  const traversal = fixture('1.0.0', { '../escape.js': strToU8('bad') })
  assert.throws(() => verifyPackage(traversal.bytes, traversal.entry, '4.0.14'), /Unsafe package path/)
  for (const [field, number, message] of [[38, 0xa1ff0000, /symlinks/], [24, 0xffffffff, /expansion limit/]] as const) {
    const value = fixture(); const view = new DataView(value.bytes.buffer, value.bytes.byteOffset, value.bytes.byteLength)
    for (let offset = 0; offset + 46 <= value.bytes.length; offset++) {
      if (view.getUint32(offset, true) === 0x02014b50) { view.setUint32(offset + field, number, true); break }
    }
    value.entry.sha256 = createHash('sha256').update(value.bytes).digest('hex')
    assert.throws(() => verifyPackage(value.bytes, value.entry, '4.0.14'), message)
  }
  for (const [override, message] of [[{ capabilities: ['node'] }, /Unsupported plugin capabilities/], [{ entry: 'ui/main.js' }, /static HTML/], [{ permissions: ['network'] }, /Unsupported plugin permissions/]] as const) {
    const value = fixture('1.0.0', {}, override)
    assert.throws(() => verifyPackage(value.bytes, value.entry, '4.0.14'), message)
  }
  const minimum = fixture('1.0.0', {}, { minCreatorVersion: '99.0.0' }); minimum.entry.minCreatorVersion = '99.0.0'
  assert.throws(() => verifyPackage(minimum.bytes, minimum.entry, '4.0.14'), /requires NextTools/)
})

test('renderer refuses remote scripts, traversal and missing resources instead of enabling network', () => {
  for (const source of ['https://evil.invalid/code.js', '../../../escape.js', 'missing.js']) {
    const value = fixture('1.0.0', { 'ui/index.html': strToU8(`<html><head></head><body><script src="${source}"></script></body></html>`) })
    assert.throws(() => renderPackage(verifyPackage(value.bytes, value.entry, '4.0.14')), /local package assets|Unsafe package path|asset is missing/)
  }
})

test('serialized operations apply enable then uninstall, and Cordis disposal removes command and endpoint', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'nextleek-market-'))
  const value = fixture(); const runtime = await harness(directory, server(() => value))
  try {
    await runtime.invoke('install', { id })
    const [disabled] = await Promise.all([runtime.invoke('setEnabled', { id, enabled: false }), runtime.invoke('uninstall', { id })])
    assert.equal((disabled as InstalledPlugin).enabled, false); assert.deepEqual(await runtime.invoke('installed'), [])
    await runtime.market.dispose()
    await assert.rejects(runtime.invoke('installed'), /unavailable/)
    await assert.rejects(runtime.ctx.commands.run('plugin-market.open'), /unavailable/)
  } finally { await runtime.dispose(); await rm(directory, { recursive: true, force: true }) }
})

test('catalog HTTP errors are explicit and plugin disposal aborts active fetches', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'nextleek-market-'))
  let failure = true; let started!: () => void
  const ready = new Promise<void>(resolve => { started = resolve })
  const fetch: typeof globalThis.fetch = async (_input, init) => {
    if (failure) return new Response('unavailable', { status: 503 })
    return new Promise<Response>((_resolve, reject) => {
      const signal = init!.signal!
      signal.addEventListener('abort', () => { reject(signal.reason) }, { once: true }); started()
    })
  }
  const runtime = await harness(directory, fetch)
  try {
    await assert.rejects(runtime.invoke('catalog'), /HTTP 503/)
    failure = false
    const pending = runtime.invoke('catalog'); const rejected = assert.rejects(pending, /disposed/)
    await ready; await runtime.market.dispose(); await rejected
    assert.equal((await readdir(directory)).length, 0)
  } finally { await runtime.dispose(); await rm(directory, { recursive: true, force: true }) }
})
