import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { readdir, realpath, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { posix, win32 } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { launcherSearchRequest, searchItemId } from '../../shared/validation'
import type { LauncherSearchItem } from '../../shared/contracts'
import type { SearchProvider } from './contracts'

export interface ApplicationsEnvironment {
  platform?: NodeJS.Platform
  directories?: string[]
  desktopDirectory?: string
  preferredLanguages?: readonly string[]
  getFileIcon(path: string): Promise<string>
  openPath(path: string): Promise<string>
}
export interface ApplicationDirectoryEntry {
  name: string
  isDirectory(): boolean
  isFile(): boolean
  isSymbolicLink(): boolean
}
export interface ApplicationsPorts {
  readdir(path: string): Promise<ApplicationDirectoryEntry[]>
  realpath(path: string): Promise<string>
  stat(path: string): Promise<{ isDirectory(): boolean; isFile(): boolean; mtimeMs: number }>
  readBundleNames(path: string, languages: readonly string[], signal: AbortSignal): Promise<string[]>
  now(): number
}

function readPlist(path: string, signal: AbortSignal): Promise<Record<string, unknown>> {
  // macOS's parser handles both binary and XML plists; no shell or application code runs.
  return new Promise((resolve, reject) => {
    execFile('/usr/bin/plutil', ['-convert', 'json', '-o', '-', path], { signal, timeout: 3000, maxBuffer: 1024 * 1024 }, (error, stdout) => {
      if (error) { reject(error); return }
      try { resolve(JSON.parse(stdout) as Record<string, unknown>) }
      catch (error) { reject(error) }
    })
  })
}
function bundleNames(data: Record<string, unknown>): string[] {
  return [data.CFBundleDisplayName, data.CFBundleName, ...Object.entries(data).filter(([key]) => key.startsWith('APP_NAME_SYNONYM_')).map(([, value]) => value)]
    .filter((value): value is string => typeof value === 'string' && !!value.trim()).map(value => value.trim())
}
function localeDirectories(languages: readonly string[]): string[] {
  return [...new Set(languages.flatMap(language => {
    const locale = new Intl.Locale(language)
    const result = [locale.baseName, locale.baseName.replaceAll('-', '_')]
    if (locale.language === 'zh') result.push(locale.maximize().script === 'Hant' ? 'zh-Hant' : 'zh-Hans')
    result.push(locale.language)
    if (locale.language === 'en') result.push('English')
    return result
  }))]
}
const defaultPorts: ApplicationsPorts = {
  readdir: path => readdir(path, { withFileTypes: true }),
  realpath,
  stat,
  async readBundleNames(path, languages, signal) {
    const names: string[] = []
    for (const locale of localeDirectories(languages)) {
      if (signal.aborted) break
      try {
        const localizedPath = posix.join(path, 'Contents', 'Resources', `${locale}.lproj`, 'InfoPlist.strings')
        await stat(localizedPath)
        const localized = bundleNames(await readPlist(localizedPath, signal))
        if (localized.length) { names.push(...localized); break }
      } catch { /* Missing or invalid localization falls back to the bundle's own name. */ }
    }
    if (!signal.aborted) {
      try { names.push(...bundleNames(await readPlist(posix.join(path, 'Contents', 'Info.plist'), signal))) }
      catch { /* Some valid bundles have no readable name metadata. */ }
    }
    return [...new Set(names)]
  },
  now: Date.now,
}

const refreshTtl = 60_000
const iconCacheLimit = 128
const authorizationLimit = 1000
// ZTools also filters documentation/support shortcuts within these application directories.
const skipShortcutName = /^uninstall|^卸载|卸载$|website|网站|帮助|help|readme|read me|文档|manual|license|documentation/i
const skipFolders: Record<string, true | undefined> = { sdk: true, doc: true, docs: true, samples: true, sample: true, examples: true, example: true, demos: true, demo: true, documentation: true }
interface Application {
  name: string
  path: string
  revision: number
  aliases: string[]
}
function aliases(names: string[]): string[] {
  return [...new Set(names.flatMap(name => {
    const words = name.split(/\s+/).filter(Boolean)
    const capitals = name.match(/[A-Z]/g)
    const acronym = words.length > 1 ? words.map(word => word[0]).join('') : capitals && capitals.length > 1 ? capitals.join('') : ''
    return [name.toLowerCase(), name.toLowerCase().replace(/\s+/g, ''), acronym.toLowerCase()].filter(Boolean)
  }))]
}
function missing(error: unknown): boolean {
  return ['ENOENT', 'ENOTDIR'].includes((error as NodeJS.ErrnoException).code ?? '')
}

export function createApplicationsProvider(ctx: Context, environment: ApplicationsEnvironment, ports: ApplicationsPorts = defaultPorts): SearchProvider {
  const platform = environment.platform ?? process.platform
  const paths = platform === 'win32' ? win32 : posix
  const home = homedir()
  const sources = environment.directories ?? (platform === 'win32' ? [
    win32.join(process.env.APPDATA || win32.join(home, 'AppData', 'Roaming'), 'Microsoft', 'Windows', 'Start Menu', 'Programs'),
    win32.join(process.env.ProgramData || `${process.env.SystemDrive || 'C:'}\\ProgramData`, 'Microsoft', 'Windows', 'Start Menu', 'Programs'),
    environment.desktopDirectory ?? win32.join(home, 'Desktop'),
    win32.join(process.env.PUBLIC || `${process.env.SystemDrive || 'C:'}\\Users\\Public`, 'Desktop'),
  ] : ['/Applications', '/System/Applications', posix.join(home, 'Applications')])
  const languages = environment.preferredLanguages ?? [Intl.DateTimeFormat().resolvedOptions().locale]
  const authorized = new Map<string, Application>()
  const icons = new Map<string, { revision: number; url: string }>()
  const controller = new AbortController()
  let applications: Application[] = []
  let refreshedAt: number | undefined
  let refreshing: Promise<void> | undefined
  let iconQueue = Promise.resolve()
  let disposed = false
  ctx.effect(() => () => {
    disposed = true
    controller.abort()
    applications = []
    authorized.clear()
    icons.clear()
  }, 'installed applications provider')
  function active() { if (disposed) throw new Error('应用搜索服务已关闭。') }
  function key(path: string) { return platform === 'win32' ? path.toLowerCase() : path }

  async function refresh(): Promise<void> {
    active()
    if (refreshedAt !== undefined && ports.now() - refreshedAt < refreshTtl) return
    if (refreshing) return refreshing
    refreshing = (async () => {
      const found = new Map<string, Application>()
      const visited = new Set<string>()
      async function scan(directory: string, depth: number): Promise<void> {
        active()
        let entries: ApplicationDirectoryEntry[]
        try {
          const canonical = key(await ports.realpath(directory))
          if (visited.has(canonical)) return
          visited.add(canonical)
          entries = await ports.readdir(directory)
        } catch (error) {
          if (missing(error)) return
          throw new Error(`无法读取应用目录 ${directory}：${error instanceof Error ? error.message : String(error)}`)
        }
        for (const entry of entries) {
          active()
          if (entry.name.startsWith('.')) continue
          const path = paths.join(directory, entry.name)
          const bundle = platform === 'darwin' && entry.name.toLowerCase().endsWith('.app')
          const shortcut = platform === 'win32' && entry.name.toLowerCase().endsWith('.lnk')
          if (bundle || shortcut) {
            if (shortcut && skipShortcutName.test(entry.name)) continue
            let info: Awaited<ReturnType<ApplicationsPorts['stat']>>
            try { info = await ports.stat(path) }
            catch (error) { if (missing(error) || (error as NodeJS.ErrnoException).code === 'ELOOP') continue; throw error }
            if (bundle ? !info.isDirectory() : !info.isFile()) continue
            const canonical = key(await ports.realpath(path))
            if (found.has(canonical)) continue
            const filename = entry.name.slice(0, -4)
            const names = bundle ? [...await ports.readBundleNames(path, languages, controller.signal), filename] : [filename]
            active()
            found.set(canonical, { name: names[0], path, revision: info.mtimeMs, aliases: aliases(names) })
          } else if (entry.isDirectory() && !entry.isSymbolicLink() && depth > 0 && !Object.hasOwn(skipFolders, entry.name.toLowerCase())) {
            // Do not follow directory symlinks/junctions into arbitrary trees.
            await scan(path, depth - 1)
          }
        }
      }
      for (const source of sources) {
        if (!paths.isAbsolute(source)) throw new Error('应用目录必须是绝对路径。')
        const flat = paths.basename(source).toLowerCase() === 'desktop' || (environment.desktopDirectory !== undefined && key(source) === key(environment.desktopDirectory))
        const depth = platform === 'darwin' ? 1 : flat ? 0 : 16
        await scan(source, depth)
      }
      active()
      applications = [...found.values()].sort((a, b) => a.name.localeCompare(b.name) || a.path.localeCompare(b.path))
      const current = new Map(applications.map(application => [key(application.path), application.revision]))
      for (const [id, application] of authorized) if (current.get(key(application.path)) !== application.revision) authorized.delete(id)
      for (const [path, cached] of icons) if (current.get(path) !== cached.revision) icons.delete(path)
      refreshedAt = ports.now()
    })()
    try { await refreshing }
    finally { refreshing = undefined }
  }
  async function icon(application: Application): Promise<string | undefined> {
    const pathKey = key(application.path)
    const cached = icons.get(pathKey)
    if (cached?.revision === application.revision) {
      icons.delete(pathKey); icons.set(pathKey, cached)
      return cached.url
    }
    // Match ZTools' serial native icon extraction; failed extraction is not cached.
    const extraction = iconQueue.then(async () => {
      active()
      const existing = icons.get(pathKey)
      if (existing?.revision === application.revision) return existing.url
      const url = await environment.getFileIcon(application.path)
      active()
      if (!/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(url)) throw new Error('系统未返回有效的应用 PNG 图标。')
      icons.set(pathKey, { revision: application.revision, url })
      while (icons.size > iconCacheLimit) icons.delete(icons.keys().next().value!)
      return url
    })
    iconQueue = extraction.then(() => undefined, () => undefined)
    try { return await extraction }
    catch { active(); return undefined }
  }
  return {
    id: 'applications', title: '应用',
    async search(request) {
      const validated = launcherSearchRequest(request)
      active()
      if (platform !== 'win32' && platform !== 'darwin') return { status: 'unsupported', message: '应用搜索目前仅支持 Windows 和 macOS。', items: [], total: 0 }
      const query = validated.query.trim().toLowerCase()
      if (!query) return { status: 'ready', items: [], total: 0 }
      await refresh()
      const normalizedQuery = query.replace(/\s+/g, '')
      const matches = applications.filter(application => application.aliases.some(alias => alias.includes(query) || alias.includes(normalizedQuery)))
      const items = await Promise.all(matches.slice(validated.offset, validated.offset + validated.limit).map(async application => {
        const iconUrl = await icon(application)
        active()
        const id = randomUUID()
        authorized.set(id, application)
        while (authorized.size > authorizationLimit) authorized.delete(authorized.keys().next().value!)
        return { id, name: application.name, path: application.path, isDirectory: platform === 'darwin', size: null, modifiedAt: null,
          ...(iconUrl ? { iconUrl } : {}), actions: [{ id: 'open', label: '打开' }] } satisfies LauncherSearchItem
      }))
      return { status: 'ready', items, total: matches.length }
    },
    async performAction(itemId, action) {
      active()
      searchItemId(itemId)
      if (action !== 'open') throw new TypeError('Invalid applications action')
      const application = authorized.get(itemId)
      if (!application) throw new Error('该应用搜索结果已失效，请重新搜索。')
      let info: Awaited<ReturnType<ApplicationsPorts['stat']>>
      try { info = await ports.stat(application.path) }
      catch (error) {
        authorized.delete(itemId)
        refreshedAt = undefined
        icons.delete(key(application.path))
        if (missing(error)) throw new Error('应用已不存在，请重新搜索。')
        throw error
      }
      if (info.mtimeMs !== application.revision || (platform === 'darwin' ? !info.isDirectory() : !info.isFile())) {
        authorized.delete(itemId)
        refreshedAt = undefined
        throw new Error('应用已更改，请重新搜索。')
      }
      active()
      // Open the original shortcut/bundle, preserving arguments and working directory.
      const error = await environment.openPath(application.path)
      if (error) throw new Error(`无法打开应用：${error}`)
    },
  }
}

export function applicationsPlugin(environment: ApplicationsEnvironment) {
  return {
    name: 'applications-provider',
    inject: ['search'],
    apply(ctx: Context) { ctx.search.register(ctx, createApplicationsProvider(ctx, environment)) },
  }
}
