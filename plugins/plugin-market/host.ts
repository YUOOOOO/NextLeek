import type { Context, Fiber } from '@deepseek-ai/cordis'
import type { KeyboardInputEvent } from 'electron'
import { createHash, randomUUID } from 'node:crypto'
import { lstat, mkdir, open, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { zipSync } from 'fflate'
import { authenticateSource, dependencyErrors, executeSource } from './capabilities'
import { CATALOG_URL, MAX_PACKAGE_BYTES, marketEntry, object, parseCatalog, pluginId, renderPackage, verifyPackage } from './package'
import type { VerifiedPackage } from './package'
import type { InstalledPlugin, MarketDownloadProgress, MarketEntry, MarketExportResult, MarketManifest, MarketRuntimeSummary, OpenPlugin, RunningPlugin, SourceAuthentication } from './shared'
import type { PluginViewHandle, PluginViewBounds } from '../../src/host/services/contracts'

export interface MarketOptions {
  directory: string
  version: string
  /** Deterministic network seam; production always uses the pinned public repository. */
  fetch?: typeof globalThis.fetch
  /** Native save dialog only; the market owns bundle creation and atomic file writing. */
  chooseExportPath?: (suggestedName: string) => Promise<string | null>
  revealPath?: (installedPackagePath: string) => Promise<void>
  onDownloadProgress?: (payload: MarketDownloadProgress) => void
}
interface StoredPlugin { catalog: MarketEntry; enabled: boolean; file: string }
interface StoredState { schemaVersion: 1; plugins: StoredPlugin[] }
function installed(record: StoredPlugin, declarations: Pick<MarketManifest, 'dataSources' | 'requires' | 'commands'>, errors: string[], authenticatedSources: string[]): InstalledPlugin {
  const { id, name, version, description, author } = record.catalog
  return { id, name, version, description, author, enabled: record.enabled, commands: declarations.commands, dataSources: declarations.dataSources, requires: declarations.requires, dependencyErrors: errors, authenticatedSources }
}
function notFound(error: unknown): boolean { return (error as NodeJS.ErrnoException).code === 'ENOENT' }

export function marketPlugin(options: MarketOptions) {
  return {
    name: 'plugin-market', inject: ['pluginEndpoints', 'commands'],
    async apply(ctx: Context) {
      // All lifecycle and mutable state belong to this Cordis plugin instance.
      const lifetime = new AbortController()
      let queue: Promise<unknown> = Promise.resolve()
      let state: StoredState | undefined
      const controllers = new Map<string, AbortController>()
      const downloads = new Map<string, { id: string; controller: AbortController; installing: boolean }>()
      const cookies = new Map<string, Map<string, SourceAuthentication>>()
      const sessions = new Map<string, { consumerId: string; providers: Set<string>; controller: AbortController; fiber: Fiber; view?: PluginViewHandle }>()
      const commandOwners = new Map<string, { file: string; fiber: Fiber }>()
      const statePath = join(options.directory, 'market-state.json')
      const network = options.fetch ?? globalThis.fetch
      ctx.effect(() => () => {
        const reason = new Error('Plugin market disposed')
        lifetime.abort(reason)
        for (const controller of controllers.values()) controller.abort(reason)
        for (const download of downloads.values()) download.controller.abort(reason)
        downloads.clear()
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
      async function revoke(id: string): Promise<void> {
        const reason = new Error(`Plugin capability access revoked: ${id}`)
        controllers.get(id)?.abort(reason)
        controllers.delete(id)
        cookies.delete(id)
        const owner = commandOwners.get(id)
        if (owner) { await owner.fiber.dispose(); commandOwners.delete(id) }
        for (const session of sessions.values()) {
          if (session.consumerId !== id && !session.providers.has(id)) continue
          session.controller.abort(reason)
          await session.fiber.dispose()
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
        const directory = dirname(path)
        await mkdir(directory, { recursive: true })
        const temporary = join(directory, `market-tmp-${randomUUID()}`)
        try {
          await writeFile(temporary, contents, { flag: 'wx', mode: 0o600 })
          // Windows 索引器等短暂占用目标时仍保留旧文件；不可退化为先删后写。
          for (let attempt = 0; ; attempt++) {
            active()
            try { await rename(temporary, path); break }
            catch (error) {
              const code = (error as NodeJS.ErrnoException).code
              if (process.platform !== 'win32' || !['EPERM', 'EACCES', 'EBUSY'].includes(code ?? '') || attempt === 5) throw error
              await delay(25 * 2 ** attempt, undefined, { signal: lifetime.signal })
            }
          }
        } finally { await rm(temporary, { force: true }) }
      }
      async function save(records: StoredPlugin[]): Promise<void> {
        const next: StoredState = { schemaVersion: 1, plugins: records }
        await atomicFile(statePath, JSON.stringify(next))
        state = next
      }
      async function fetchBytes(url: string, maximum: number, request?: { signal: AbortSignal; progress?: (receivedBytes: number, totalBytes?: number) => void }): Promise<Uint8Array> {
        active()
        const timeout = AbortSignal.timeout(20_000)
        const signal = AbortSignal.any([lifetime.signal, timeout, ...(request ? [request.signal] : [])])
        const response = await network(url, { signal, redirect: 'error', headers: { Accept: 'application/octet-stream' } })
        if (!response.ok) throw new Error(`Marketplace request failed: HTTP ${response.status}`)
        if (response.url && response.url !== url) throw new Error('Marketplace redirects are forbidden')
        const length = response.headers.get('content-length')
        if (length && (!/^\d+$/.test(length) || Number(length) > maximum)) { await response.body?.cancel(); throw new Error('Marketplace response exceeds size limit') }
        if (!response.body) throw new Error('Marketplace response has no body')
        const reader = response.body.getReader()
        const chunks: Uint8Array[] = []; let total = 0
        request?.progress?.(0, length ? Number(length) : undefined)
        try {
          while (true) {
            if (signal.aborted) throw signal.reason
            const { done, value } = await reader.read()
            if (done) break
            total += value.byteLength
            if (total > maximum) throw new Error('Marketplace response exceeds size limit')
            chunks.push(value)
            request?.progress?.(total, length ? Number(length) : undefined)
          }
        } catch (error) { await reader.cancel().catch(() => {}); throw error } finally { reader.releaseLock() }
        signal.throwIfAborted()
        const bytes = new Uint8Array(total); let offset = 0
        for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length }
        return bytes
      }
      async function catalog(signal?: AbortSignal): Promise<MarketEntry[]> {
        const entries = parseCatalog(await fetchBytes(CATALOG_URL, 1024 * 1024, signal ? { signal } : undefined))
        await atomicFile(join(options.directory, 'market-catalog.json'), JSON.stringify({ schemaVersion: 1, plugins: entries }))
        return entries
      }
      async function verifyInstalled(record: StoredPlugin): Promise<VerifiedPackage> {
        active()
        const bytes = await readPackageFile(join(options.directory, record.file))
        active()
        return verifyPackage(bytes, record.catalog, options.version)
      }
      // 用文件句柄限制读取大小并拒绝链接，防止读取期间路径替换或无界分配。
      async function readPackageFile(path: string): Promise<Uint8Array> {
        const initial = await lstat(path)
        if (!initial.isFile()) throw new Error('Package must be a regular file, not a symlink')
        const handle = await open(path, 'r')
        let bytes: Uint8Array
        try {
          const stats = await handle.stat()
          if (stats.dev !== initial.dev || stats.ino !== initial.ino) throw new Error('Package path changed while opening')
          if (!stats.isFile() || stats.size < 22 || stats.size > MAX_PACKAGE_BYTES) throw new Error('Invalid or oversized plugin package')
          bytes = new Uint8Array(stats.size)
          let offset = 0
          while (offset < bytes.length) {
            const result = await handle.read(bytes, offset, bytes.length - offset, offset)
            if (!result.bytesRead) throw new Error('Local package changed while reading')
            offset += result.bytesRead
          }
          const extra = new Uint8Array(1)
          if ((await handle.read(extra, 0, 1, offset)).bytesRead) throw new Error('Local package changed while reading')
        } finally { await handle.close() }
        active()
        return bytes
      }
      // 本地文件只按官方目录的摘要匹配，不能从包内声明推导信任或权限。
      async function localPackage(args: unknown): Promise<{ entry: MarketEntry; bytes: Uint8Array }> {
        const path = object(args).path
        if (typeof path !== 'string' || !isAbsolute(path) || path.includes('\0') || !/\.nlplugin$/i.test(path)) throw new TypeError('An absolute .nlplugin file path is required')
        const bytes = await readPackageFile(path)
        const digest = createHash('sha256').update(bytes).digest('hex')
        const entry = (await catalog()).find(item => item.sha256 === digest)
        if (!entry) throw new Error('Local package is not approved by the pinned marketplace catalogue')
        return { entry, bytes }
      }
      // 网络与本地安装共用同一验证和原子提交路径，更新先释放旧命令和会话。
      async function installPackage(entry: MarketEntry, bytes: Uint8Array): Promise<InstalledPlugin | undefined> {
        renderPackage(verifyPackage(bytes, entry, options.version))
        return serialize(async () => {
          const current = await load()
          const id = entry.id
          const old = current.plugins.find(record => record.catalog.id === id)
          if (!old && current.plugins.length >= 500) throw new Error('Installed plugin limit exceeded')
          const file = `package-${randomUUID()}.nlplugin`
          const path = join(options.directory, file)
          const replacement = { catalog: entry, enabled: old?.enabled ?? true, file }
          try {
            await atomicFile(path, bytes)
            if (old) await revoke(id)
            await save([...current.plugins.filter(record => record.catalog.id !== id), replacement])
          } catch (error) {
            await rm(path, { force: true })
            await syncCommands(await load())
            throw error
          }
          await syncCommands(await load())
          if (old) await rm(join(options.directory, old.file), { force: true })
          return (await listInstalled(await load())).find(record => record.id === id)
        })
      }
      // 超长插件编码使用稳定摘要，保持宿主命令标识符的长度约束。
      function commandId(id: string, localId: string): string {
        const full = `market.${id}..${localId}`
        return full.length <= 80 ? full : `market.${createHash('sha256').update(full).digest('hex')}`
      }
      // 每个安装包单独持有 Cordis 子作用域，更新/禁用时释放全部命令效果。
      async function syncCommands(current: StoredState): Promise<void> {
        for (const [id, owner] of commandOwners) {
          if (current.plugins.some(record => record.enabled && record.catalog.id === id && record.file === owner.file)) continue
          await owner.fiber.dispose()
          commandOwners.delete(id)
        }
        for (const record of current.plugins) {
          if (!record.enabled || commandOwners.has(record.catalog.id)) continue
          let verified: VerifiedPackage
          try { verified = await verifyInstalled(record) } catch { continue }
          const declaration = verified.manifest
          const fiber = ctx.plugin({
            name: `market-commands-${record.catalog.id}`, inject: ['commands'],
            apply(owner: Context) {
              const declared = declaration.commands?.length ? declaration.commands : [{ id: 'open', title: declaration.name, description: declaration.description, keywords: [declaration.id, declaration.name, '插件'] }]
              for (const command of declared) {
                const id = commandId(declaration.id, command.id)
                owner.commands.register(owner, { id, title: command.title, description: command.description ?? declaration.description, keywords: command.keywords, icon: 'blocks', pluginId: declaration.id }, async () => {
                  active()
                  if (!state?.plugins.some(item => item.enabled && item.catalog.id === declaration.id && item.file === record.file)) throw new Error(`Plugin command unavailable: ${id}`)
                  await verifyInstalled(record)
                  return { pluginId: declaration.id, commandId: id }
                })
              }
            },
          })
          try { await fiber.await() } catch (error) { await fiber.dispose(); throw error }
          commandOwners.set(declaration.id, { file: record.file, fiber })
        }
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
        if (method === 'getPluginMemoryInfo') {
          const input = object(args)
          if (Object.keys(input).some(key => key !== 'id')) throw new TypeError('Unexpected plugin memory input field')
          const id = pluginId(input.id)
          for (const entry of sessions.values()) if (entry.consumerId === id && !entry.controller.signal.aborted) return { success: true, data: entry.view?.memoryInfo() ?? null }
          return { success: true, data: null }
        }
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
        if (method === 'previewLocal' || method === 'installLocal') {
          const local = await localPackage(args)
          if (method === 'installLocal') return installPackage(local.entry, local.bytes)
          renderPackage(verifyPackage(local.bytes, local.entry, options.version))
          return local.entry
        }
        if (method === 'running') {
          if (args !== null) throw new TypeError('running takes null')
          return serialize(async () => {
            const current = await load()
            return [...sessions].flatMap(([session, runtime]) => {
              const record = current.plugins.find(item => item.catalog.id === runtime.consumerId && item.enabled)
              return record && !runtime.controller.signal.aborted ? [{ id: record.catalog.id, name: record.catalog.name, session } satisfies RunningPlugin] : []
            })
          })
        }
        if (method === 'exportAll') {
          if (args !== null) throw new TypeError('exportAll takes null')
          if (!options.chooseExportPath) throw new Error('Native plugin export save dialog is not configured')
          const path = await options.chooseExportPath('NextTools-plugins.zip')
          if (path === null) return null
          if (typeof path !== 'string' || !isAbsolute(path) || path.includes('\0') || !/\.zip$/i.test(path)) throw new TypeError('An absolute .zip export path is required')
          return serialize(async () => {
            const current = await load()
            const files: Record<string, Uint8Array> = Object.create(null)
            let total = 0
            for (const record of current.plugins) {
              const bytes = await readPackageFile(join(options.directory, record.file))
              verifyPackage(bytes, record.catalog, options.version)
              total += bytes.length
              if (total > 128 * 1024 * 1024) throw new Error('Plugin export bundle exceeds 128 MiB')
              files[`packages/${record.catalog.id}.nlplugin`] = bytes
            }
            // 保存真实安装包及其目录元数据；不导出认证 cookie，不生成可执行 ZPX。
            files['index.json'] = new TextEncoder().encode(JSON.stringify({ schemaVersion: 1, plugins: current.plugins.map(record => ({ ...record.catalog, enabled: record.enabled, bundlePath: `packages/${record.catalog.id}.nlplugin` })) }))
            const bytes = zipSync(files, { level: 0 })
            await atomicFile(path, bytes)
            return { path, count: current.plugins.length } satisfies MarketExportResult
          })
        }
        if (method === 'close') {
          const token = sessionToken(object(args).session)
          const session = sessions.get(token)
          await session?.fiber.dispose()
          return
        }
        if (method === 'focus' || method === 'sendInputEvent' || method === 'detach' || method === 'openDevTools') {
          const input = object(args)
          if (Object.keys(input).some(key => key !== 'session' && !(method === 'sendInputEvent' && key === 'event'))) throw new TypeError('Unexpected plugin view input field')
          const session = sessions.get(sessionToken(input.session))
          if (!session || session.controller.signal.aborted) throw new Error('Plugin session is closed or revoked')
          if (!session.view) throw new Error('Native plugin view is unavailable')
          if (method === 'focus') return session.view.focus()
          if (method === 'detach') { session.view.detach(); return { success: true } }
          if (method === 'openDevTools') { session.view.openDevTools(); return { success: true } }
          const event = object(input.event)
          if (Object.keys(event).some(key => !['type', 'keyCode', 'modifiers'].includes(key))) throw new TypeError('Unexpected keyboard event field')
          if (event.type !== 'keyDown' && event.type !== 'keyUp' && event.type !== 'char') throw new TypeError('Only keyboard input events are allowed')
          if (typeof event.keyCode !== 'string' || !event.keyCode || event.keyCode.length > 64 || /[\x00-\x1f]/.test(event.keyCode)) throw new TypeError('Invalid keyboard keyCode')
          const modifiers = event.modifiers
          const allowed = ['shift', 'control', 'ctrl', 'alt', 'meta', 'command', 'cmd', 'isKeypad', 'isAutoRepeat', 'capsLock', 'numLock'] as const
          if (modifiers !== undefined && (!Array.isArray(modifiers) || modifiers.length > allowed.length || !modifiers.every((value): value is typeof allowed[number] => typeof value === 'string' && allowed.some(allowedValue => allowedValue === value)) || new Set(modifiers).size !== modifiers.length)) throw new TypeError('Invalid keyboard modifiers')
          const keyboardEvent: KeyboardInputEvent = { type: event.type, keyCode: event.keyCode }
          if (modifiers !== undefined) keyboardEvent.modifiers = modifiers.map(value => value === 'isKeypad' ? 'iskeypad' : value === 'isAutoRepeat' ? 'isautorepeat' : value === 'capsLock' ? 'capslock' : value === 'numLock' ? 'numlock' : value)
          return session.view.sendInputEvent(keyboardEvent)
        }
        if (method === 'viewBounds' || method === 'viewVisible') {
          const input = object(args)
          const session = sessions.get(sessionToken(input.session))
          if (!session) throw new Error('Plugin session is closed or revoked')
          if (method === 'viewVisible') {
            if (typeof input.visible !== 'boolean') throw new TypeError('visible must be a boolean')
            session.view?.visible(input.visible)
          } else {
            for (const key of ['x', 'y', 'width', 'height'] as const) if (typeof input[key] !== 'number' || !Number.isFinite(input[key]) || Math.abs(input[key] as number) > 100000 || ((key === 'width' || key === 'height') && (input[key] as number) < 0)) throw new TypeError('Invalid plugin view bounds')
            session.view?.bounds(input as unknown as PluginViewBounds)
          }
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
        if (method === 'cancelDownload') {
          const taskId = pluginId(object(args).taskId)
          const task = downloads.get(taskId)
          if (!task) throw new Error('Plugin download is not active')
          if (task.installing) throw new Error('Plugin installation has already started')
          task.controller.abort(new Error('Plugin download cancelled'))
          return { success: true }
        }
        if (method === 'reveal') {
          const id = pluginId(object(args).id)
          if (!options.revealPath) throw new Error('Native installed package reveal is not configured')
          return serialize(async () => {
            const record = (await load()).plugins.find(item => item.catalog.id === id)
            if (!record) throw new Error(`Plugin is not installed: ${id}`)
            await verifyInstalled(record)
            await options.revealPath!(join(options.directory, record.file))
          })
        }
        if (!['install', 'uninstall', 'setEnabled', 'stop', 'open'].includes(method)) throw new Error(`Unknown plugin market method: ${method}`)
        const input = object(args); const id = pluginId(input.id)
        if (method === 'install') {
          const taskId = input.taskId === undefined ? id : pluginId(input.taskId)
          if (downloads.has(taskId) || [...downloads.values()].some(task => task.id === id)) throw new Error('Plugin download is already active')
          const task = { id, controller: new AbortController(), installing: false }
          downloads.set(taskId, task)
          const emit = (status: MarketDownloadProgress['status'], receivedBytes?: number, totalBytes?: number, error?: string) => options.onDownloadProgress?.({ pluginName: id, taskId, status, progress: status === 'success' ? 100 : totalBytes ? Math.min(100, (receivedBytes ?? 0) / totalBytes * 100) : null, receivedBytes, totalBytes, error })
          try {
            emit('downloading', 0)
            const entry = (await catalog(task.controller.signal)).find(item => item.id === id)
            if (!entry) throw new Error(`Plugin is absent from marketplace: ${id}`)
            const bytes = await fetchBytes(entry.packageUrl, MAX_PACKAGE_BYTES, { signal: task.controller.signal, progress: (received, total) => emit('downloading', received, total) })
            task.controller.signal.throwIfAborted()
            task.installing = true
            emit('installing', bytes.length, bytes.length)
            const result = await installPackage(entry, bytes)
            emit('success', bytes.length, bytes.length)
            return result
          } catch (error) {
            emit(task.controller.signal.aborted ? 'cancelled' : 'error', undefined, undefined, error instanceof Error ? error.message : 'Plugin download failed')
            throw error
          } finally { downloads.delete(taskId) }
        }
        return serialize(async () => {
          const current = await load()
          const old = current.plugins.find(record => record.catalog.id === id)
          if (!old) throw new Error(`Plugin is not installed: ${id}`)
          if (method === 'stop') {
            await revoke(id)
            // 停止释放当前运行效果，保留启用状态并重新注册可再次启动的命令。
            await syncCommands(current)
            return (await listInstalled(current)).find(record => record.id === id)
          }
          if (method === 'uninstall') {
            await revoke(id)
            await save(current.plugins.filter(record => record.catalog.id !== id))
            await syncCommands(await load())
            await rm(join(options.directory, old.file), { force: true })
            return
          }
          if (method === 'setEnabled') {
            if (typeof input.enabled !== 'boolean') throw new TypeError('enabled must be a boolean')
            if (!input.enabled) await revoke(id)
            const replacement = { ...old, enabled: input.enabled }
            await save(current.plugins.map(record => record.catalog.id === id ? replacement : record))
            await syncCommands(await load())
            return (await listInstalled(await load())).find(record => record.id === id)
          }
          if (!old.enabled) throw new Error(`Plugin is disabled: ${id}`)
          const verified = await verifyInstalled(old)
          const providers = await requiredProviders(verified.manifest, current)
          const requestedCommand = input.commandId
          if (requestedCommand !== undefined && (typeof requestedCommand !== 'string' || !(verified.manifest.commands?.length ? verified.manifest.commands : [{ id: 'open' }]).some(command => commandId(id, command.id) === requestedCommand))) throw new Error('Plugin command is not declared by this package')
          const session = randomUUID()
          const html = renderPackage(verified, { session, commandId: requestedCommand as string | undefined })
          active()
          const errors = authenticationErrors(verified.manifest, providers)
          if (errors.length) throw new Error(`Plugin dependencies are unavailable: ${errors.join('; ')}`)
          const controller = new AbortController()
          const fiber = ctx.plugin({
            name: `market-session-${session}`,
            async apply(owner: Context) {
              owner.effect(() => () => {
                controller.abort(new Error('Plugin capability session closed'))
                sessions.delete(session)
              }, 'plugin capability session')
              const view = await ctx.get('desktop')?.openPluginView?.(owner, {
                session, html,
                // 能力会话由宿主绑定，包内参数不能覆盖 session 或选择任意端点。
                invoke: async (method, args) => {
                  if (controller.signal.aborted) throw new Error('Plugin capability session closed')
                  const result = await run(method, method === 'runtimeSummary' ? null : { ...object(args), session })
                  controller.signal.throwIfAborted()
                  return result
                },
                closed: () => { void fiber.dispose() },
              })
              const current = sessions.get(session)
              if (current) current.view = view
            },
          })
          sessions.set(session, { consumerId: id, providers: new Set(providers.map(provider => provider.id)), controller, fiber })
          try { await fiber.await() } catch (error) { await fiber.dispose(); throw error }
          return { id, name: old.catalog.name, html, session, commandId: requestedCommand as string | undefined } satisfies OpenPlugin
        })
      }
      ctx.pluginEndpoints.register(ctx, 'plugin-market', run)
      await syncCommands(await load())
      ctx.commands.register(ctx, {
        id: 'plugin-market.open', pluginId: 'plugin-market', title: '插件市场', description: '发现、安装和管理 NextTools 插件', icon: 'store', keywords: ['plugins', 'market', '插件', '市场', 'chajian'],
      }, () => ({ navigate: 'plugin-market' }))
    },
  }
}
