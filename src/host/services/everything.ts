import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { stat } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { isAbsolute, win32 } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { LauncherSearchRequest } from '../../shared/contracts'
import { launcherSearchRequest, everythingAction, everythingResultId } from '../../shared/validation'
import type { EverythingAction, EverythingItem, EverythingService } from './contracts'

export interface EverythingEnvironment {
  addonPath: string
  executable: string
  platform?: NodeJS.Platform
  openPath(path: string): Promise<string>
  revealPath(path: string): void | Promise<void>
  copyPath(path: string): void
}
export interface NativeEverythingItem {
  filename: string
  path: string
  isFolder: boolean
  size?: number | null
  dateModified?: string | null
  ext?: string
  hfilename?: string
}
export interface NativeEverythingResult {
  error?: string | number
  list: NativeEverythingItem[]
  total: number
}
export interface NativeEverythingAddon {
  everythingIsRuning(): boolean
  everythingIsDBLoaded(): boolean
  getEverythingVersion(): string
  everythingSearch(query: string, sort: number, limit: number, offset: number): NativeEverythingResult
}
export interface EverythingPorts {
  loadAddon(path: string): NativeEverythingAddon
  startEngine(executable: string, failed: (error: Error) => void, ctx: Context): void
  stat(path: string): Promise<{ isDirectory(): boolean }>
  sleep(milliseconds: number, ctx: Context): Promise<void>
  now(): number
}

const requireNative = createRequire(import.meta.url)
const defaultPorts: EverythingPorts = {
  loadAddon: path => requireNative(path) as NativeEverythingAddon,
  startEngine(executable, failed, ctx) {
    // The engine owns its index and may already be running. Never terminate it,
    // including when Cordis disposes this provider or a readiness wait times out.
    const child = spawn(executable, ['-startup'], { windowsHide: true, detached: true, stdio: 'ignore', shell: false })
    const onExit = (code: number | null) => { if (code !== null && code !== 0) failed(new Error(`Everything 启动退出码：${code}`)) }
    ctx.effect(() => {
      child.once('error', failed)
      child.once('exit', onExit)
      return () => { child.off('error', failed); child.off('exit', onExit) }
    }, 'Everything engine startup listeners')
    child.unref()
  },
  stat,
  async sleep(milliseconds, ctx) {
    let resolve!: () => void
    const promise = new Promise<void>(done => { resolve = done })
    const cleanup = ctx.effect(() => {
      const timer = setTimeout(resolve, milliseconds)
      return () => { clearTimeout(timer); resolve() }
    }, 'Everything readiness timer')
    try { await promise }
    finally { await cleanup() }
  },
  now: Date.now,
}

function parseResults(result: NativeEverythingResult, request: LauncherSearchRequest): EverythingItem[] {
  if (!result || typeof result !== 'object') throw new Error('Everything 返回了无效的结果数据。')
  if (result.error) throw new Error(`Everything 查询失败：${result.error}`)
  if (!Array.isArray(result.list) || !Number.isSafeInteger(result.total) || result.total < 0) throw new Error('Everything 返回了无效的结果数据。')
  if (result.list.length > request.limit) throw new Error('Everything 返回了超出请求范围的结果。')
  return result.list.map(record => {
    if (!record || typeof record !== 'object') throw new Error('Everything 返回了无效的结果数据。')
    const { filename, path: directory, isFolder, size, dateModified } = record
    // The SDK assembles an empty path directly from its filename IPC field.
    const rawFilename = typeof filename === 'string' ? filename.replaceAll('/', '\\') : ''
    const rawDirectory = typeof directory === 'string' ? directory.replaceAll('/', '\\') : ''
    const driveRoot = isFolder === true && rawDirectory === '' && /^[a-z]:$/i.test(rawFilename)
    const basenameFilename = rawDirectory !== '' && !/[\\/]/.test(rawFilename)
    const fullPath = driveRoot ? `${rawFilename}\\` : rawDirectory ? win32.join(rawDirectory, rawFilename) : rawFilename
    const normalizedPath = win32.normalize(fullPath)
    const root = win32.parse(normalizedPath).root
    const path = normalizedPath === root ? root : normalizedPath.replace(/[\\]+$/, '')
    if (typeof filename !== 'string' || typeof directory !== 'string' || !rawFilename || rawFilename === '.' || rawFilename === '..' || /[\u0000-\u001f]/.test(rawFilename) || /[\u0000-\u001f]/.test(rawDirectory) || (!driveRoot && !win32.isAbsolute(path)) || (rawDirectory !== '' && (!basenameFilename || !win32.isAbsolute(rawDirectory))) || path === '.') throw new Error(`Everything 返回了无效的文件路径：${JSON.stringify({ filename, path: directory, isFolder })}`)
    if (typeof isFolder !== 'boolean') throw new Error('Everything 返回了无效的文件类型。')
    if (size != null && (typeof size !== 'number' || !Number.isFinite(size) || size < -1)) throw new Error('Everything 返回了无效的文件大小。')
    if (dateModified != null && typeof dateModified !== 'string') throw new Error('Everything 返回了无效的修改时间。')
    return {
      id: randomUUID(), name: win32.basename(path) || root.replace(/[\\]+$/, ''), path, isDirectory: isFolder,
      size: isFolder || size == null || size < 0 ? null : size,
      // The native addon returns a formatted display string, not an ISO date.
      modifiedAt: dateModified || null,
    }
  })
}

export function createEverythingService(ctx: Context, environment?: EverythingEnvironment, ports: EverythingPorts = defaultPorts): EverythingService {
  const authorized = new Map<string, string>()
  let disposed = false
  let addon: NativeEverythingAddon | undefined
  let preparing: Promise<NativeEverythingAddon> | undefined
  let cancel!: () => void
  const cancelled = new Promise<void>(resolve => { cancel = resolve })
  ctx.effect(() => () => { disposed = true; authorized.clear(); cancel() }, 'Everything native provider')
  function supported() {
    if (disposed) throw new Error('Everything 服务已关闭。')
    if (!environment || (environment.platform ?? process.platform) !== 'win32') throw new Error('Everything 文件搜索仅支持 Windows。')
    return environment
  }
  function load(): NativeEverythingAddon {
    const env = supported()
    if (addon) return addon
    if (!(isAbsolute(env.addonPath) || win32.isAbsolute(env.addonPath))) throw new Error('Everything 原生模块路径必须是绝对路径。')
    try {
      const loaded = ports.loadAddon(env.addonPath)
      for (const method of ['everythingSearch', 'everythingIsRuning', 'everythingIsDBLoaded', 'getEverythingVersion'] as const) {
        if (!loaded || typeof loaded[method] !== 'function') throw new Error(`缺少原生接口 ${method}`)
      }
      addon = loaded
      return loaded
    } catch (error) { throw new Error(`无法加载随 NextTools 安装的 Everything 原生模块，请重新安装 NextTools：${error instanceof Error ? error.message : String(error)}`) }
  }
  async function prepare(): Promise<NativeEverythingAddon> {
    const env = supported()
    const native = load()
    if (native.everythingIsRuning() && native.everythingIsDBLoaded()) return native
    if (preparing) return preparing
    preparing = (async () => {
      let startupError: Error | undefined
      if (!native.everythingIsRuning()) {
        if (!(isAbsolute(env.executable) || win32.isAbsolute(env.executable))) throw new Error('Everything 引擎路径必须是绝对路径。')
        try { ports.startEngine(env.executable, error => { startupError = error }, ctx) }
        catch (error) { startupError = error instanceof Error ? error : new Error(String(error)) }
      }
      const deadline = ports.now() + 8000
      while (true) {
        supported()
        if (startupError) throw new Error(`无法启动随 NextTools 安装的 Everything 引擎：${startupError.message}`)
        if (native.everythingIsRuning() && native.everythingIsDBLoaded()) return native
        if (ports.now() >= deadline) throw new Error('Everything 索引尚未就绪，等待超时。请确认服务正常运行并等待索引完成后重试。')
        await Promise.race([ports.sleep(Math.min(200, deadline - ports.now()), ctx), cancelled])
      }
    })()
    try { return await preparing }
    finally { preparing = undefined }
  }
  return {
    async getStatus() {
      if (!environment || (environment.platform ?? process.platform) !== 'win32') return { status: 'unsupported', message: 'Everything 文件搜索仅支持 Windows。' }
      try {
        const native = await prepare()
        const version = native.getEverythingVersion()
        return { status: 'ready', message: '已连接正在运行的 Everything 索引。', ...(typeof version === 'string' && version ? { version } : {}) }
      } catch (error) { return { status: 'unavailable', message: error instanceof Error ? error.message : String(error) } }
    },
    async search(request) {
      const validated = launcherSearchRequest(request)
      const native = await prepare()
      supported()
      // Apply full-path matching to the whole expression without changing engine settings.
      // ZTools' positional contract is SORT, LIMIT, OFFSET; launcher uses name ascending (1).
      const result = native.everythingSearch(`path:<${validated.query}>`, 1, validated.limit, validated.offset)
      const items = parseResults(result, validated)
      for (const item of items) {
        authorized.set(item.id, item.path)
        while (authorized.size > 1000) authorized.delete(authorized.keys().next().value!)
      }
      return { items, total: result.total, hasMore: result.total > validated.offset + items.length, offset: validated.offset }
    },
    async performAction(id: string, action: EverythingAction) {
      const env = supported()
      everythingResultId(id)
      everythingAction(action)
      const path = authorized.get(id)
      if (!path) throw new Error('该搜索结果已失效，请重新搜索。')
      try { await ports.stat(path) }
      catch (error) {
        authorized.delete(id)
        if (['ENOENT', 'ENOTDIR'].includes((error as NodeJS.ErrnoException).code ?? '')) throw new Error('文件已不存在，请刷新 Everything 搜索结果。')
        throw new Error(`无法访问文件：${error instanceof Error ? error.message : String(error)}`)
      }
      supported()
      if (action === 'open') {
        const message = await env.openPath(path)
        if (message) throw new Error(`无法打开文件：${message}`)
      } else if (action === 'reveal') await env.revealPath(path)
      else env.copyPath(path)
    },
  }
}

export function everythingPlugin(environment?: EverythingEnvironment) {
  return {
    name: 'everything-provider',
    apply(ctx: Context) { ctx.provide('everything', createEverythingService(ctx, environment)) },
  }
}
