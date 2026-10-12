import type { Context } from '@deepseek-ai/cordis'
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { authenticateSource, dependencyErrors, executeSource } from './capabilities'
import { CATALOG_URL, MAX_PACKAGE_BYTES, marketEntry, object, parseCatalog, pluginId, renderPackage, verifyPackage } from './package'
import type { VerifiedPackage } from './package'
import type { InstalledPlugin, MarketEntry, MarketManifest, MarketRuntimeSummary, OpenPlugin, SourceAuthentication } from './shared'

export interface MarketOptions {
  directory: string
  version: string
  /** Deterministic network seam; production always uses the pinned public repository. */
  fetch?: typeof globalThis.fetch
}
interface StoredPlugin { catalog: MarketEntry; enabled: boolean; file: string }
interface StoredState { schemaVersion: 1; plugins: StoredPlugin[] }
function installed(record: StoredPlugin, declarations: Pick<MarketManifest, 'dataSources' | 'requires'>, errors: string[], authenticatedSources: string[]): InstalledPlugin {
  const { id, name, version, description, author } = record.catalog
  return { id, name, version, description, author, enabled: record.enabled, dataSources: declarations.dataSources, requires: declarations.requires, dependencyErrors: errors, authenticatedSources }
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
      const controllers = new Map<string, AbortController>()
      const cookies = new Map<string, Map<string, SourceAuthentication>>()
      const sessions = new Map<string, { consumerId: string; providers: Set<string>; controller: AbortController }>()
      const statePath = join(options.directory, 'market-state.json')
      const network = options.fetch ?? globalThis.fetch
      ctx.effect(() => () => {
        const reason = new Error('Plugin market disposed')
        lifetime.abort(reason)
        for (const controller of controllers.values()) controller.abort(reason)
        for (const session of sessions.values()) session.controller.abort(reason)
        controllers.clear(); sessions.clear(); cookies.clear()
      }, 'plugin market requests')
      function active(): void { if (lifetime.signal.aborted) throw new Error('Plugin market disposed') }
      function serialize<T>(operation: () => Promise<T>): Promise<T> {
        const result = queue.then(() => { active(); return operation() })
        queue = result.catch(() => {})
        return result
      }
      function controller(id: string): AbortController {
        let current = controllers.get(id)
        if (!current) { current = new AbortController(); controllers.set(id, current) }
        return current
      }
      function revoke(id: string): void {
        const reason = new Error(`Plugin capability access revoked: ${id}`)
        controllers.get(id)?.abort(reason)
        controllers.delete(id)
        cookies.delete(id)
        for (const [token, session] of sessions) {
          if (session.consumerId !== id && !session.providers.has(id)) continue
          session.controller.abort(reason)
          sessions.delete(token)
        }
      }
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
      async function verifyInstalled(record: StoredPlugin): Promise<VerifiedPackage> {
        active()
        const bytes = await readFile(join(options.directory, record.file))
        active()
        return verifyPackage(bytes, record.catalog, options.version)
      }
      function sourceAuthentication(id: string, sourceId: string): SourceAuthentication | undefined {
        const authenticated = cookies.get(id)
        const authentication = authenticated?.get(sourceId)
        if (authentication && authentication.expiresAt !== null && authentication.expiresAt <= Date.now()) {
          authenticated?.delete(sourceId)
          if (!authenticated?.size) cookies.delete(id)
          return undefined
        }
        return authentication
      }
      function unauthenticatedSource(id: string, sourceId: string): string {
        return `Data source ${id}/${sourceId} is not authenticated. Configure its password in the marketplace; authentication must be configured again after restart.`
      }
      function authenticationErrors(consumer: MarketManifest, providers: MarketManifest[]): string[] {
        const errors: string[] = []
        for (const requirement of consumer.requires ?? []) {
          const provider = providers.find(item => item.id === requirement.sourcePluginId)
          const source = provider?.dataSources?.find(item => item.id === requirement.sourceId)
          if (source?.authentication && !sourceAuthentication(requirement.sourcePluginId, source.id)) errors.push(unauthenticatedSource(requirement.sourcePluginId, source.id))
        }
        return errors
      }
      async function listInstalled(current: StoredState): Promise<InstalledPlugin[]> {
        const declarations = new Map<string, MarketManifest>()
        const failures = new Map<string, string>()
        for (const record of current.plugins) {
          try { declarations.set(record.catalog.id, (await verifyInstalled(record)).manifest) }
          catch (error) { failures.set(record.catalog.id, `Installed package verification failed: ${error instanceof Error ? error.message : 'invalid package'}`) }
        }
        active()
        const providers = current.plugins.filter(record => record.enabled).flatMap(record => {
          const declaration = declarations.get(record.catalog.id)
          return declaration ? [declaration] : []
        })
        return current.plugins.map(record => {
          const declaration = declarations.get(record.catalog.id)
          const failure = failures.get(record.catalog.id)
          const errors = failure ? [failure] : declaration ? [...dependencyErrors(declaration, providers), ...authenticationErrors(declaration, providers)] : []
          const authenticated = declaration?.dataSources?.filter(source => source.authentication && sourceAuthentication(record.catalog.id, source.id)).map(source => source.id) ?? []
          return installed(record, declaration ?? record.catalog, errors, authenticated)
        })
      }
      async function requiredProviders(consumer: MarketManifest, current: StoredState): Promise<MarketManifest[]> {
        const providers: MarketManifest[] = []
        const ids = new Set((consumer.requires ?? []).map(requirement => requirement.sourcePluginId))
        for (const id of ids) {
          const record = current.plugins.find(item => item.catalog.id === id && item.enabled)
          if (!record) continue
          try { providers.push(id === consumer.id ? consumer : (await verifyInstalled(record)).manifest) }
          catch (error) { throw new Error(`Required data source package failed verification: ${id}`, { cause: error }) }
        }
        const errors = [...dependencyErrors(consumer, providers), ...authenticationErrors(consumer, providers)]
        if (errors.length) throw new Error(`Plugin dependencies are unavailable: ${errors.join('; ')}`)
        return providers
      }
      function sessionToken(value: unknown): string {
        if (typeof value !== 'string' || !/^[a-f0-9-]{36}$/.test(value)) throw new TypeError('Invalid capability session')
        return value
      }
      async function run(method: string, args: unknown): Promise<unknown> {
        active()
        if (method === 'catalog') { if (args !== null) throw new TypeError('catalog takes null'); return catalog() }
        if (method === 'runtimeSummary') {
          if (args !== null) throw new TypeError('runtimeSummary takes null')
          return serialize(async () => {
            const current = await load()
            return { version: options.version, platform: process.platform, mode: 'desktop', status: 'ready', installed: current.plugins.length, enabled: current.plugins.filter(record => record.enabled).length } satisfies MarketRuntimeSummary
          })
        }
        if (method === 'installed') {
          if (args !== null) throw new TypeError('installed takes null')
          return serialize(async () => listInstalled(await load()))
        }
        if (method === 'close') {
          const token = sessionToken(object(args).session)
          const session = sessions.get(token)
          session?.controller.abort(new Error('Plugin capability session closed'))
          sessions.delete(token)
          return
        }
        if (method === 'invokeCapability') {
          const input = object(args)
          const token = sessionToken(input.session)
          const sourcePluginId = pluginId(input.sourcePluginId)
          const sourceId = pluginId(input.sourceId)
          if (typeof input.method !== 'string' || !input.method || input.method.length > 128) throw new TypeError('Invalid capability method')
          const name = input.method
          const parameters = object(input.args)
          const request = await serialize(async () => {
            const session = sessions.get(token)
            if (!session) throw new Error('Capability session is closed or revoked')
            const current = await load()
            const consumer = current.plugins.find(record => record.catalog.id === session.consumerId && record.enabled)
            if (!consumer) throw new Error('Consumer plugin is not installed or enabled')
            const verified = await verifyInstalled(consumer)
            if (!verified.manifest.requires?.some(requirement => requirement.sourcePluginId === sourcePluginId && requirement.sourceId === sourceId && requirement.methods.includes(name))) throw new Error('Consumer plugin has not declared access to this data source method')
            const providers = await requiredProviders(verified.manifest, current)
            const provider = providers.find(item => item.id === sourcePluginId)
            const source = provider?.dataSources?.find(item => item.id === sourceId)
            const declaredMethod = source?.methods.find(item => item.name === name)
            if (!source || !declaredMethod) throw new Error('Declared data source method is unavailable')
            const signal = AbortSignal.any([lifetime.signal, session.controller.signal, controller(consumer.catalog.id).signal, controller(sourcePluginId).signal])
            signal.throwIfAborted()
            return { source, signal }
          })
          request.signal.throwIfAborted()
          const authentication = sourceAuthentication(sourcePluginId, sourceId)
          if (request.source.authentication && !authentication) throw new Error(`Plugin dependencies are unavailable: ${unauthenticatedSource(sourcePluginId, sourceId)}`)
          const result = await executeSource(request.source, name, parameters, { fetch: network, signal: request.signal, cookie: authentication?.cookie })
          request.signal.throwIfAborted()
          sourceAuthentication(sourcePluginId, sourceId)
          return result
        }
        if (method === 'configureSource') {
          const input = object(args)
          if ('session' in input) throw new Error('Capability sessions cannot configure data source credentials')
          const id = pluginId(input.id)
          const sourceId = pluginId(input.sourceId)
          if (typeof input.password !== 'string' || !input.password || input.password.length > 4096) throw new TypeError('A data source password is required')
          const password = input.password
          const request = await serialize(async () => {
            const current = await load()
            const record = current.plugins.find(item => item.catalog.id === id && item.enabled)
            if (!record) throw new Error('Data source plugin is not installed or enabled')
            const verified = await verifyInstalled(record)
            const source = verified.manifest.dataSources?.find(item => item.id === sourceId)
            if (!source?.authentication) throw new Error('Data source does not declare password authentication')
            const signal = AbortSignal.any([lifetime.signal, controller(id).signal])
            signal.throwIfAborted()
            return { record, source, signal }
          })
          request.signal.throwIfAborted()
          const authentication = await authenticateSource(request.source, password, { fetch: network, signal: request.signal })
          return serialize(async () => {
            request.signal.throwIfAborted()
            const current = await load()
            if (!current.plugins.some(record => record.catalog.id === id && record.enabled && record.file === request.record.file)) throw new Error('Data source plugin changed during authentication')
            sourceAuthentication(id, sourceId)
            if (authentication.expiresAt !== null && authentication.expiresAt <= Date.now()) throw new Error(unauthenticatedSource(id, sourceId))
            let authenticated = cookies.get(id)
            if (!authenticated) { authenticated = new Map(); cookies.set(id, authenticated) }
            authenticated.set(sourceId, authentication)
            return { id, sourceId, authenticated: true }
          })
        }
        if (!['install', 'uninstall', 'setEnabled', 'open'].includes(method)) throw new Error(`Unknown plugin market method: ${method}`)
        const input = object(args); const id = pluginId(input.id)
        if (method === 'install') {
          const entry = (await catalog()).find(item => item.id === id)
          if (!entry) throw new Error(`Plugin is absent from marketplace: ${id}`)
          const bytes = await fetchBytes(entry.packageUrl, MAX_PACKAGE_BYTES)
          const verified = verifyPackage(bytes, entry, options.version)
          renderPackage(verified) // Validate static assets before any installed state changes.
          return serialize(async () => {
            const current = await load()
            const old = current.plugins.find(record => record.catalog.id === id)
            const file = `package-${randomUUID()}.nlplugin`
            const path = join(options.directory, file)
            const replacement = { catalog: entry, enabled: old?.enabled ?? true, file }
            try {
              await atomicFile(path, bytes)
              if (old) revoke(id)
              await save([...current.plugins.filter(record => record.catalog.id !== id), replacement])
            } catch (error) { await rm(path, { force: true }); throw error }
            if (old) await rm(join(options.directory, old.file), { force: true })
            return (await listInstalled(await load())).find(record => record.id === id)
          })
        }
        return serialize(async () => {
          const current = await load()
          const old = current.plugins.find(record => record.catalog.id === id)
          if (!old) throw new Error(`Plugin is not installed: ${id}`)
          if (method === 'uninstall') {
            revoke(id)
            await save(current.plugins.filter(record => record.catalog.id !== id))
            await rm(join(options.directory, old.file), { force: true })
            return
          }
          if (method === 'setEnabled') {
            if (typeof input.enabled !== 'boolean') throw new TypeError('enabled must be a boolean')
            if (!input.enabled) revoke(id)
            const replacement = { ...old, enabled: input.enabled }
            await save(current.plugins.map(record => record.catalog.id === id ? replacement : record))
            return (await listInstalled(await load())).find(record => record.id === id)
          }
          if (!old.enabled) throw new Error(`Plugin is disabled: ${id}`)
          const verified = await verifyInstalled(old)
          const providers = await requiredProviders(verified.manifest, current)
          const html = renderPackage(verified)
          active()
          const errors = authenticationErrors(verified.manifest, providers)
          if (errors.length) throw new Error(`Plugin dependencies are unavailable: ${errors.join('; ')}`)
          const session = randomUUID()
          sessions.set(session, { consumerId: id, providers: new Set(providers.map(provider => provider.id)), controller: new AbortController() })
          return { id, name: old.catalog.name, html, session } satisfies OpenPlugin
        })
      }
      ctx.pluginEndpoints.register(ctx, 'plugin-market', run)
      ctx.commands.register(ctx, {
        id: 'plugin-market.open', title: '插件市场', description: '发现、安装和管理 NextTools 插件', icon: 'store', keywords: ['plugins', 'market', '插件', '市场', 'chajian'],
      }, () => ({ navigate: 'plugin-market' }))
    },
  }
}
