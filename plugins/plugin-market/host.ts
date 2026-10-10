import type { Context } from '@deepseek-ai/cordis'
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { CATALOG_URL, MAX_PACKAGE_BYTES, marketEntry, object, parseCatalog, pluginId, renderPackage, verifyPackage } from './package'
import type { InstalledPlugin, MarketEntry, MarketRuntimeSummary, OpenPlugin } from './shared'

export interface MarketOptions {
  directory: string
  version: string
  /** Deterministic network seam; production always uses the pinned public repository. */
  fetch?: typeof globalThis.fetch
}
interface StoredPlugin { catalog: MarketEntry; enabled: boolean; file: string }
interface StoredState { schemaVersion: 1; plugins: StoredPlugin[] }
function installed(record: StoredPlugin): InstalledPlugin {
  const { id, name, version, description, author } = record.catalog
  return { id, name, version, description, author, enabled: record.enabled }
}
function notFound(error: unknown): boolean { return (error as NodeJS.ErrnoException).code === 'ENOENT' }

export function marketPlugin(options: MarketOptions) {
  return {
    name: 'plugin-market', inject: ['pluginEndpoints', 'commands'],
    apply(ctx: Context) {
      // All lifecycle and mutable state belong to this Cordis plugin instance.
      const lifetime = new AbortController()
      let queue: Promise<unknown> = Promise.resolve()
      let state: StoredState | undefined
      const statePath = join(options.directory, 'market-state.json')
      const network = options.fetch ?? globalThis.fetch
      ctx.effect(() => () => { lifetime.abort(new Error('Plugin market disposed')) }, 'plugin market requests')
      function active(): void { if (lifetime.signal.aborted) throw new Error('Plugin market disposed') }
      async function load(): Promise<StoredState> {
        active()
        if (state) return state
        let saved: unknown
        try {
          const bytes = await readFile(statePath)
          if (bytes.length > 2 * 1024 * 1024) throw new Error('Installed plugin state is too large')
          saved = JSON.parse(bytes.toString('utf8'))
        } catch (error) { if (!notFound(error)) throw new Error('Unable to read installed plugin state', { cause: error }); saved = { schemaVersion: 1, plugins: [] } }
        const data = object(saved)
        if (data.schemaVersion !== 1 || !Array.isArray(data.plugins) || data.plugins.length > 500) throw new Error('Invalid installed plugin state')
        const records = data.plugins.map(value => {
          const record = object(value)
          if (typeof record.enabled !== 'boolean' || typeof record.file !== 'string' || !/^package-[a-f0-9-]{36}\.nlplugin$/.test(record.file)) throw new Error('Invalid installed plugin record')
          return { catalog: marketEntry(record.catalog), enabled: record.enabled, file: record.file }
        })
        if (new Set(records.map(record => record.catalog.id)).size !== records.length) throw new Error('Duplicate installed plugin id')
        state = { schemaVersion: 1, plugins: records }
        return state
      }
      async function atomicFile(path: string, contents: string | Uint8Array): Promise<void> {
        active()
        await mkdir(options.directory, { recursive: true })
        const temporary = join(options.directory, `market-tmp-${randomUUID()}`)
        try {
          await writeFile(temporary, contents, { flag: 'wx', mode: 0o600 })
          active()
          await rename(temporary, path)
        } finally { await rm(temporary, { force: true }) }
      }
      async function save(records: StoredPlugin[]): Promise<void> {
        const next: StoredState = { schemaVersion: 1, plugins: records }
        await atomicFile(statePath, JSON.stringify(next))
        state = next
      }
      async function fetchBytes(url: string, maximum: number): Promise<Uint8Array> {
        active()
        const timeout = AbortSignal.timeout(20_000)
        const signal = AbortSignal.any([lifetime.signal, timeout])
        const response = await network(url, { signal, redirect: 'error', headers: { Accept: 'application/octet-stream' } })
        if (!response.ok) throw new Error(`Marketplace request failed: HTTP ${response.status}`)
        if (response.url && response.url !== url) throw new Error('Marketplace redirects are forbidden')
        const length = response.headers.get('content-length')
        if (length && (!/^\d+$/.test(length) || Number(length) > maximum)) { await response.body?.cancel(); throw new Error('Marketplace response exceeds size limit') }
        if (!response.body) throw new Error('Marketplace response has no body')
        const reader = response.body.getReader()
        const chunks: Uint8Array[] = []; let total = 0
        try {
          while (true) {
            if (signal.aborted) throw signal.reason
            const { done, value } = await reader.read()
            if (done) break
            total += value.byteLength
            if (total > maximum) throw new Error('Marketplace response exceeds size limit')
            chunks.push(value)
          }
        } catch (error) { await reader.cancel().catch(() => {}); throw error } finally { reader.releaseLock() }
        const bytes = new Uint8Array(total); let offset = 0
        for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length }
        return bytes
      }
      async function catalog(): Promise<MarketEntry[]> {
        const entries = parseCatalog(await fetchBytes(CATALOG_URL, 1024 * 1024))
        await atomicFile(join(options.directory, 'market-catalog.json'), JSON.stringify({ schemaVersion: 1, plugins: entries }))
        return entries
      }
      async function run(method: string, args: unknown): Promise<unknown> {
        active()
        if (method === 'catalog') { if (args !== null) throw new TypeError('catalog takes null'); return catalog() }
        if (method === 'runtimeSummary') {
          if (args !== null) throw new TypeError('runtimeSummary takes null')
          const current = await load()
          return { version: options.version, platform: process.platform, mode: 'desktop', status: 'ready', installed: current.plugins.length, enabled: current.plugins.filter(record => record.enabled).length } satisfies MarketRuntimeSummary
        }
        const current = await load()
        if (method === 'installed') { if (args !== null) throw new TypeError('installed takes null'); return current.plugins.map(installed) }
        if (!['install', 'uninstall', 'setEnabled', 'open'].includes(method)) throw new Error(`Unknown plugin market method: ${method}`)
        const input = object(args); const id = pluginId(input.id)
        const old = current.plugins.find(record => record.catalog.id === id)
        if (method === 'install') {
          const entry = (await catalog()).find(item => item.id === id)
          if (!entry) throw new Error(`Plugin is absent from marketplace: ${id}`)
          const bytes = await fetchBytes(entry.packageUrl, MAX_PACKAGE_BYTES)
          const verified = verifyPackage(bytes, entry, options.version)
          renderPackage(verified) // Validate static assets before any installed state changes.
          const file = `package-${randomUUID()}.nlplugin`
          const path = join(options.directory, file)
          const replacement = { catalog: entry, enabled: old?.enabled ?? true, file }
          try {
            await atomicFile(path, bytes)
            await save([...current.plugins.filter(record => record.catalog.id !== id), replacement])
          } catch (error) { await rm(path, { force: true }); throw error }
          if (old) await rm(join(options.directory, old.file), { force: true })
          return installed(replacement)
        }
        if (!old) throw new Error(`Plugin is not installed: ${id}`)
        if (method === 'uninstall') {
          await save(current.plugins.filter(record => record.catalog.id !== id))
          await rm(join(options.directory, old.file), { force: true })
          return
        }
        if (method === 'setEnabled') {
          if (typeof input.enabled !== 'boolean') throw new TypeError('enabled must be a boolean')
          const replacement = { ...old, enabled: input.enabled }
          await save(current.plugins.map(record => record.catalog.id === id ? replacement : record))
          return installed(replacement)
        }
        if (!old.enabled) throw new Error(`Plugin is disabled: ${id}`)
        const bytes = await readFile(join(options.directory, old.file))
        const verified = verifyPackage(bytes, old.catalog, options.version)
        return { id, name: old.catalog.name, html: renderPackage(verified) } satisfies OpenPlugin
      }
      ctx.pluginEndpoints.register(ctx, 'plugin-market', (method, args) => {
        const operation = queue.then(() => run(method, args))
        queue = operation.catch(() => {})
        return operation
      })
      ctx.commands.register(ctx, {
        id: 'plugin-market.open', title: '插件市场', description: '发现、安装和管理 NextTools 插件', icon: 'store', keywords: ['plugins', 'market', '插件', '市场', 'chajian'],
      }, () => ({ navigate: 'plugin-market' }))
    },
  }
}
